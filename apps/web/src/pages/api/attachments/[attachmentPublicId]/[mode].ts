import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { getAttachmentForView } from "@kan/api/utils/attachment-access";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import {
  attachmentContentDisposition,
  getAttachmentObject,
  getObjectPrefix,
  hasValidInlineAttachmentSignature,
  isInlineAttachmentContentType,
  normalizeAttachmentContentType,
} from "@kan/shared/utils";

import { env } from "~/env";
import { parseAttachmentRange } from "../../../../utils/attachment-range";

function errorStatus(error: unknown): number {
  if (!(error instanceof TRPCError)) return 500;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "UNAUTHORIZED") return 401;
  if (error.code === "FORBIDDEN") return 403;
  return 500;
}

function objectBodyToReadable(body: unknown): Readable | null {
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
}

export async function attachmentHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const attachmentPublicId = req.query.attachmentPublicId;
  const mode = req.query.mode;
  if (
    typeof attachmentPublicId !== "string" ||
    !/^[a-z0-9]{12}$/.test(attachmentPublicId) ||
    (mode !== "view" && mode !== "download")
  ) {
    return res.status(400).json({ message: "Invalid attachment request" });
  }

  try {
    const { user, db } = await createNextApiContext(req);
    const attachment = await getAttachmentForView(
      db,
      attachmentPublicId,
      user?.id,
    );
    const bucket = env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
    if (!bucket) {
      return res.status(500).json({ message: "Storage not configured" });
    }

    if (mode === "view") {
      if (!isInlineAttachmentContentType(attachment.contentType)) {
        return res
          .status(415)
          .json({ message: "Attachment type cannot be viewed inline" });
      }
      const prefix = await getObjectPrefix(bucket, attachment.s3Key);
      if (!hasValidInlineAttachmentSignature(attachment.contentType, prefix)) {
        return res
          .status(415)
          .json({ message: "Attachment content cannot be viewed inline" });
      }
    }

    const requestRange = Array.isArray(req.headers.range)
      ? "invalid"
      : parseAttachmentRange(req.headers.range, attachment.size);
    if (requestRange === "invalid") {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Range", `bytes */${attachment.size}`);
      return res.status(416).end();
    }

    const object = await getAttachmentObject({
      bucket,
      key: attachment.s3Key,
      range: requestRange?.header,
    });
    const body = objectBodyToReadable(object.Body);
    if (!body) throw new Error("Attachment object body is missing");

    const contentLength =
      object.ContentLength ?? requestRange?.length ?? attachment.size;
    res.statusCode = requestRange ? 206 : 200;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(contentLength));
    res.setHeader(
      "Content-Type",
      mode === "view"
        ? normalizeAttachmentContentType(attachment.contentType)
        : "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      attachmentContentDisposition(
        mode === "view" ? "inline" : "attachment",
        attachment.originalFilename,
      ),
    );
    if (requestRange) {
      res.setHeader(
        "Content-Range",
        object.ContentRange ??
          `bytes ${requestRange.start}-${requestRange.end}/${attachment.size}`,
      );
    }
    await pipeline(body, res);
    return undefined;
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return undefined;
    }
    return res
      .status(errorStatus(error))
      .json({ message: "Unable to access attachment" });
  }
}

export default withRateLimit(
  { points: 100, duration: 60 },
  withApiLogging(attachmentHandler),
);
