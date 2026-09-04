import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { getCardVisualWallPreviewForView } from "@kan/api/utils/card-visual-wall-preview-access";
import {
  getRequestIpRateLimitIdentifier,
  withRateLimit,
} from "@kan/api/utils/rateLimit";
import {
  getAttachmentObject,
  getObjectPrefix,
  hasValidInlineAttachmentSignature,
} from "@kan/shared/utils";

import { env } from "~/env";
import {
  createWorkspaceCanvasImageViewRateLimitProfileResolver,
  WORKSPACE_CANVAS_IMAGE_VIEW_HTTP_RATE_LIMIT_POINTS,
} from "../../../utils/workspace-canvas-image-view-rate-limit";

const resolveRateLimitProfile =
  createWorkspaceCanvasImageViewRateLimitProfileResolver({
    getVerifiedUserId: async (req) =>
      (await createNextApiContext(req)).user?.id,
    getIpIdentifier: getRequestIpRateLimitIdentifier,
  });

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

const acceptsEtag = (value: string | string[] | undefined, etag: string) => {
  const values = Array.isArray(value) ? value : [value ?? ""];
  return values.some((header) =>
    header
      .split(",")
      .map((candidate) => candidate.trim())
      .some(
        (candidate) =>
          candidate === "*" || candidate === etag || candidate === `W/${etag}`,
      ),
  );
};

const statusForError = (error: unknown) => {
  if (!(error instanceof TRPCError)) return 500;
  if (error.code === "UNAUTHORIZED") return 401;
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  return 500;
};

export async function cardVisualWallPreviewHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
  res.setHeader("Vary", "Cookie");
  res.setHeader(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; img-src 'self' data: blob:",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  const resourcePublicId = req.query.resourcePublicId;
  if (
    typeof resourcePublicId !== "string" ||
    !/^[a-z0-9]{12}$/.test(resourcePublicId)
  ) {
    return res.status(400).json({ message: "Invalid preview request" });
  }
  try {
    const { db, user } = await createNextApiContext(req);
    const preview = await getCardVisualWallPreviewForView(
      db,
      resourcePublicId,
      user?.id ?? null,
    );
    const etag = `"${preview.sha256}"`;
    res.setHeader("ETag", etag);
    if (acceptsEtag(req.headers["if-none-match"], etag)) {
      return res.status(304).end();
    }
    const bucket = env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
    if (!bucket) {
      return res.status(500).json({ message: "Storage not configured" });
    }
    const prefix = await getObjectPrefix(bucket, preview.s3Key);
    if (!hasValidInlineAttachmentSignature(preview.contentType, prefix)) {
      return res.status(415).json({ message: "Preview cannot be viewed" });
    }
    const object = await getAttachmentObject({
      bucket,
      key: preview.s3Key,
    });
    const body = toReadable(object.Body);
    if (!body) throw new Error("VISUAL_WALL_PREVIEW_BODY_MISSING");
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/webp");
    res.setHeader(
      "Content-Length",
      String(object.ContentLength ?? preview.size),
    );
    res.setHeader("Content-Disposition", "inline");
    await pipeline(body, res);
    return undefined;
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return undefined;
    }
    return res
      .status(statusForError(error))
      .json({ message: "Unable to access preview" });
  }
}

export default withRateLimit(
  {
    points: WORKSPACE_CANVAS_IMAGE_VIEW_HTTP_RATE_LIMIT_POINTS,
    duration: 60,
    identifier: async (req) => (await resolveRateLimitProfile(req)).identifier,
    pointsToConsume: async (req) =>
      (await resolveRateLimitProfile(req)).pointsToConsume,
  },
  withApiLogging(cardVisualWallPreviewHandler, { sensitive: true }),
);
