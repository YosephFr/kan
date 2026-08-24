import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import { fetchSafePreviewImage } from "@kan/api/utils/safe-preview";
import { getWebResourcePreviewForView } from "@kan/api/utils/web-resource-preview-access";

function errorStatus(error: unknown): number {
  if (!(error instanceof TRPCError)) return 502;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "UNAUTHORIZED") return 401;
  if (error.code === "FORBIDDEN") return 403;
  return 500;
}

export async function previewImageHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
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
    const resource = await getWebResourcePreviewForView(
      db,
      resourcePublicId,
      user?.id,
    );
    if (!resource.imageUrl) {
      return res
        .status(404)
        .json({ message: "Unable to access preview image" });
    }
    const image = await fetchSafePreviewImage(resource.imageUrl);
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Content-Length", String(image.bytes.byteLength));
    res.status(200).end(Buffer.from(image.bytes));
    return undefined;
  } catch (error) {
    return res
      .status(errorStatus(error))
      .json({ message: "Unable to access preview image" });
  }
}

export default withRateLimit(
  { points: 100, duration: 60 },
  withApiLogging(previewImageHandler, { sensitive: true }),
);
