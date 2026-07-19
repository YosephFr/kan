import type { NextApiRequest, NextApiResponse } from "next";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { isInstanceAdminEmail } from "@kan/api/utils/instanceAdmin";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import * as instanceSettingsRepo from "@kan/db/repository/instanceSettings.repo";
import { createLogger } from "@kan/logger";
import {
  createS3Client,
  deleteObject,
  generateUID,
  generateWorkspaceLogoUrl,
} from "@kan/shared/utils";

import { env } from "~/env";

const logger = createLogger("brand-logo-upload");
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
  { points: 20, duration: 60 },
  withApiLogging(async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST" && req.method !== "DELETE") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let uploadedKey: string | null = null;

    try {
      const { user, db } = await createNextApiContext(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      if (!isInstanceAdminEmail(user.email)) {
        return res.status(403).json({ error: "Permission denied" });
      }

      const bucket = env.NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME;
      if (!bucket) {
        return res.status(500).json({ error: "Logo bucket not configured" });
      }

      const current = await instanceSettingsRepo.get(db);
      const baseSettings = current ?? {
        brandName: "kan.bn",
        brandLogo: null,
        loginTitle: null,
        loginDescription: null,
      };

      if (req.method === "DELETE") {
        await instanceSettingsRepo.upsert(db, {
          ...baseSettings,
          brandLogo: null,
          updatedBy: user.id,
        });

        if (current?.brandLogo && !current.brandLogo.startsWith("http")) {
          await deleteObject(bucket, current.brandLogo).catch((error) => {
            logger.warn({ error }, "Unable to remove previous brand logo");
          });
        }

        return res.status(200).json({ brandLogo: null });
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
        return res.status(400).json({ error: "Invalid content length" });
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
      uploadedKey = `branding/${generateUID()}-${sanitizedFilename}`;

      await createS3Client().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: uploadedKey,
          Body: req,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
      );

      const brandLogoUrl = await generateWorkspaceLogoUrl(uploadedKey);

      const updated = await instanceSettingsRepo.upsert(db, {
        ...baseSettings,
        brandLogo: uploadedKey,
        updatedBy: user.id,
      });
      if (!updated) throw new Error("Unable to store brand logo");

      if (current?.brandLogo && !current.brandLogo.startsWith("http")) {
        await deleteObject(bucket, current.brandLogo).catch((error) => {
          logger.warn({ error }, "Unable to remove previous brand logo");
        });
      }

      uploadedKey = null;

      return res.status(200).json({
        brandLogo: brandLogoUrl,
      });
    } catch (error) {
      if (uploadedKey) {
        const bucket = env.NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME;
        if (bucket) {
          await deleteObject(bucket, uploadedKey).catch((cleanupError) => {
            logger.warn(
              { error: cleanupError, uploadedKey },
              "Unable to clean up brand logo upload",
            );
          });
        }
      }
      logger.error({ error }, "Brand logo upload failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  }),
);
