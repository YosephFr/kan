import { z } from "zod";

// ─── attachment.confirm ──────────────────────────────────────
export const attachmentConfirmResponseSchema = z.object({
  publicId: z.string(),
  filename: z.string(),
  originalFilename: z.string(),
  contentType: z.string(),
  size: z.number(),
  createdAt: z.date(),
});
