import { z } from "zod";

import {
  isAttachmentFilenameContentTypeCompatible,
  isValidAttachmentSha256,
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  normalizeAttachmentContentType,
} from "@kan/shared";

export const workspaceCanvasImageContentTypeSchema = z
  .string()
  .min(1)
  .max(100)
  .transform(normalizeAttachmentContentType)
  .pipe(z.enum(["image/jpeg", "image/png", "image/webp"]));

export const workspaceCanvasImageUploadFieldsSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: workspaceCanvasImageContentTypeSchema,
  size: z.number().int().positive().max(MAX_CARD_CANVAS_IMAGE_BYTES),
  sha256: z
    .string()
    .length(64)
    .refine(isValidAttachmentSha256)
    .transform((value) => value.toLowerCase()),
});

export const workspaceCanvasImageUploadRequestSchema =
  workspaceCanvasImageUploadFieldsSchema.refine(
    (input) =>
      isAttachmentFilenameContentTypeCompatible(
        input.filename,
        input.contentType,
      ),
    { message: "FILENAME_CONTENT_TYPE_MISMATCH" },
  );

export const workspaceCanvasImageUploadSessionSchema = z.object({
  url: z.string().url(),
  uploadSessionPublicId: z.string().regex(/^[a-z0-9]{12}$/),
  expiresAt: z.date(),
});

export const workspaceCanvasImageSchema = z.object({
  kind: z.literal("upload"),
  publicId: z.string().regex(/^[a-z0-9]{12}$/),
  title: z.string(),
  originalFilename: z.string(),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(MAX_CARD_CANVAS_IMAGE_BYTES),
  viewUrl: z.string().regex(/^\/(?!\/)/),
  downloadUrl: z.string().regex(/^\/(?!\/)/),
  createdAt: z.date(),
});

export const workspaceCanvasImageListSchema = z.object({
  images: z
    .array(workspaceCanvasImageSchema)
    .max(MAX_CARD_CANVAS_IMAGE_RESOURCES),
});
