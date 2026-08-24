import { z } from "zod";

import { cardResourceDriveTypes } from "@kan/db/schema";

export const resourceSummarySchema = z.object({
  total: z.number().int().min(0),
  uploads: z.number().int().min(0),
  driveLinks: z.number().int().min(0),
  webLinks: z.number().int().min(0),
});

const baseResourceSchema = z.object({
  publicId: z.string().length(12),
  title: z.string(),
  createdAt: z.date(),
});

export const uploadCardResourceSchema = baseResourceSchema.extend({
  kind: z.literal("upload"),
  contentType: z.string(),
  originalFilename: z.string(),
  size: z.number().int().nonnegative(),
  viewUrl: z.string().nullable(),
  downloadUrl: z.string(),
});

export const driveCardResourceSchema = baseResourceSchema.extend({
  kind: z.literal("drive"),
  driveType: z.enum(cardResourceDriveTypes),
  openUrl: z.string().url(),
  previewUrl: z.string().url(),
});

export const webCardResourceSchema = baseResourceSchema.extend({
  kind: z.literal("web"),
  openUrl: z.string().url(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
  previewImageUrl: z
    .string()
    .regex(/^\/(?!\/)/)
    .nullable(),
});

export const cardResourceSchema = z.discriminatedUnion("kind", [
  uploadCardResourceSchema,
  driveCardResourceSchema,
  webCardResourceSchema,
]);

export const cardResourceListSchema = z.object({
  resources: z.array(cardResourceSchema),
  summary: resourceSummarySchema,
});
