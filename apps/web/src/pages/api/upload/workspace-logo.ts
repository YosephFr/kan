import type { NextApiRequest, NextApiResponse } from "next";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { assertPermission } from "@kan/api/utils/permissions";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { createLogger } from "@kan/logger";
import {
  createS3Client,
  deleteObject,
  generateUID,
  generateWorkspaceLogoUrl,
} from "@kan/shared/utils";

import { env } from "~/env";

const logger = createLogger("workspace-logo-upload");
const maxSizeBytes = Number.parseInt(
  env.S3_AVATAR_UPLOAD_LIMIT ?? "2097152",
  10,
);
const allowedContentTypes = ["image/jpeg", "image/png", "image/webp"];

export const config = {
  api: {
    bodyParser: false,
  },
};

export default withRateLimit(
  { points: 30, duration: 60 },
  withApiLogging(async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST" && req.method !== "DELETE") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let uploadedKey: string | null = null;

    try {
      const { user, db } = await createNextApiContext(req);

      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const workspacePublicId = req.query.workspacePublicId;
      if (
        typeof workspacePublicId !== "string" ||
        workspacePublicId.length < 12
      ) {
        return res.status(400).json({ error: "Invalid workspacePublicId" });
      }

      const workspace = await workspaceRepo.getByPublicId(
        db,
        workspacePublicId,
      );
      if (!workspace || workspace.deletedAt) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      try {
        await assertPermission(db, user.id, workspace.id, "workspace:edit");
      } catch {
        return res.status(403).json({ error: "Permission denied" });
      }

      const bucket = env.NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME;
      if (!bucket) {
        return res
          .status(500)
          .json({ error: "Workspace logo bucket not configured" });
      }

      if (req.method === "DELETE") {
        await workspaceRepo.update(db, workspace.publicId, { logo: null });

        if (workspace.logo && !workspace.logo.startsWith("http")) {
          try {
            await deleteObject(bucket, workspace.logo);
          } catch (error) {
            logger.warn(
              { error, workspacePublicId },
              "Unable to remove previous workspace logo",
            );
          }
        }

        return res.status(200).json({ logo: null });
      }

      const contentType = req.headers["content-type"];
      const contentLengthHeader = req.headers["content-length"];
      const contentLength = contentLengthHeader
        ? Number.parseInt(contentLengthHeader, 10)
        : NaN;

      if (
        typeof contentType !== "string" ||
        !allowedContentTypes.includes(contentType)
      ) {
        return res.status(400).json({ error: "Invalid content type" });
      }

      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return res
          .status(400)
          .json({ error: "Missing or invalid content length" });
      }

      if (contentLength > maxSizeBytes) {
        return res.status(400).json({ error: "File too large" });
      }

      const rawFilename =
        (req.headers["x-original-filename"] as string | undefined) ?? "logo";
      const decodedFilename = (() => {
        try {
          return decodeURIComponent(rawFilename);
        } catch {
          return rawFilename;
        }
      })();
      const sanitizedFilename = decodedFilename
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .substring(0, 160);

      uploadedKey = `${workspace.publicId}/${generateUID()}-${sanitizedFilename}`;

      const client = createS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: uploadedKey,
          Body: req,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
      );

      const updatedWorkspace = await workspaceRepo.update(
        db,
        workspace.publicId,
        { logo: uploadedKey },
      );
      if (!updatedWorkspace) {
        throw new Error("Unable to update workspace logo");
      }

      if (workspace.logo && !workspace.logo.startsWith("http")) {
        try {
          await deleteObject(bucket, workspace.logo);
        } catch (error) {
          logger.warn(
            { error, workspacePublicId },
            "Unable to remove previous workspace logo",
          );
        }
      }

      return res.status(200).json({
        key: uploadedKey,
        logo: await generateWorkspaceLogoUrl(uploadedKey),
      });
    } catch (error) {
      if (uploadedKey) {
        const bucket = env.NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME;
        if (bucket) {
          try {
            await deleteObject(bucket, uploadedKey);
          } catch (cleanupError) {
            logger.warn(
              { error: cleanupError, uploadedKey },
              "Unable to clean up workspace logo upload",
            );
          }
        }
      }
      logger.error({ error }, "Workspace logo upload failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  }),
);
