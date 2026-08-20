import { z } from "zod";

import { listStatuses } from "@kan/db/schema";

// ─── list.create ─────────────────────────────────────────────
export const listCreateResponseSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  status: z.enum(listStatuses).nullable(),
  colourCode: z.string().nullable(),
});

// ─── list.update / list.reorder ──────────────────────────────
export const listUpdateResponseSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  status: z.enum(listStatuses).nullable(),
  colourCode: z.string().nullable(),
});
