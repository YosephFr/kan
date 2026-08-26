import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import { getWorkspaceCanvasImageForView } from "@kan/api/utils/workspace-canvas-image-access";
import {
  attachmentContentDisposition,
  getAttachmentObject,
  getObjectPrefix,
  hasValidInlineAttachmentSignature,
  normalizeAttachmentContentType,
} from "@kan/shared/utils";

import { env } from "~/env";

const errorStatus = (error: unknown) => {
  if (!(error instanceof TRPCError)) return 500;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "UNAUTHORIZED") return 401;
  if (error.code === "FORBIDDEN") return 403;
  return 500;
};

const toReadable = (body: unknown): Readable | null => {
  if (body instanceof Readable) return body;
  if (
    body &&
    typeof body === "object" &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  ) {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  return null;
};

export async function workspaceCanvasImageHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; img-src 'self' data: blob:",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  const imagePublicId = req.query.imagePublicId;
  if (
    typeof imagePublicId !== "string" ||
    !/^[a-z0-9]{12}$/.test(imagePublicId)
  ) {
    return res.status(400).json({ message: "Invalid image request" });
  }
  try {
    const { user, db } = await createNextApiContext(req);
    const image = await getWorkspaceCanvasImageForView(
      db,
      imagePublicId,
      user?.id,
    );
    const bucket = env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
    if (!bucket) {
      return res.status(500).json({ message: "Storage not configured" });
    }
    const prefix = await getObjectPrefix(bucket, image.s3Key);
    if (!hasValidInlineAttachmentSignature(image.contentType, prefix)) {
      return res.status(415).json({ message: "Image cannot be viewed" });
    }
    const object = await getAttachmentObject({
      bucket,
      key: image.s3Key,
    });
    const body = toReadable(object.Body);
    if (!body) throw new Error("IMAGE_BODY_MISSING");
    res.statusCode = 200;
    res.setHeader("Content-Length", String(object.ContentLength ?? image.size));
    res.setHeader(
      "Content-Type",
      normalizeAttachmentContentType(image.contentType),
    );
    res.setHeader(
      "Content-Disposition",
      attachmentContentDisposition("inline", image.originalFilename),
    );
    await pipeline(body, res);
    return undefined;
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return undefined;
    }
    return res
      .status(errorStatus(error))
      .json({ message: "Unable to access image" });
  }
}

export default withRateLimit(
  { points: 100, duration: 60 },
  withApiLogging(workspaceCanvasImageHandler, { sensitive: true }),
);
