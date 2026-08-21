import type { NextApiRequest, NextApiResponse } from "next";

export default function retiredAttachmentProxy(
  _req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(410).json({
    message: "Use the attachment public ID view or download endpoint",
  });
}
