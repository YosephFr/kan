import { z } from "zod";

export const visualWallPublicIdSchema = z.string().regex(/^[a-z0-9]{12}$/);

export const visualWallExpectedVersionSchema = z
  .number()
  .int()
  .min(0)
  .max(2_147_483_647);

export const visualWallPlacementSchema = z.object({
  x: z.number().int().min(0).max(1_156),
  y: z.number().int().min(0).max(999_956),
  width: z.number().int().min(44).max(1_200),
  height: z.number().int().min(44).max(1_000_000),
  zIndex: z.number().int().min(0).max(2_147_483_647).default(0),
});

export const freeformUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .transform((value, ctx) => {
    try {
      if (!value.startsWith("https://www.icloud.com/freeform/")) {
        throw new Error("invalid");
      }
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "www.icloud.com" ||
        (url.port !== "" && url.port !== "443") ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        !/^\/freeform\/[A-Za-z0-9_-]{10,128}\/?$/.test(url.pathname)
      ) {
        throw new Error("invalid");
      }
      url.port = "";
      return url.href;
    } catch {
      ctx.addIssue({ code: "custom", message: "FREEFORM_URL_INVALID" });
      return z.NEVER;
    }
  });

export const visualWallMutationResultSchema = z.union([
  z.object({
    status: z.literal("saved"),
    version: z.number().int().positive(),
    updatedAt: z.date(),
  }),
  z.object({
    status: z.literal("conflict"),
    remoteVersion: z.number().int().nonnegative(),
  }),
]);

export const cardVisualWallMutationResultSchema = z.union([
  visualWallMutationResultSchema,
  z.object({ status: z.literal("public_ack_required") }),
]);

const visualWallBaseItemSchema = visualWallPlacementSchema.extend({
  publicId: visualWallPublicIdSchema,
  title: z.string(),
  viewUrl: z.string().regex(/^\/(?!\/)/),
});

export const workspaceVisualWallItemSchema = visualWallBaseItemSchema.extend({
  imagePublicId: visualWallPublicIdSchema,
  widthPx: z.number().int().positive().nullable(),
  heightPx: z.number().int().positive().nullable(),
});

export const cardVisualWallItemSchema = visualWallBaseItemSchema.extend({
  resourcePublicId: visualWallPublicIdSchema,
});

const visualWallSnapshotBaseSchema = z.object({
  exists: z.boolean(),
  version: z.number().int().nonnegative(),
  freeformUrl: z.string().url().nullable(),
  updatedAt: z.date().nullable(),
  viewModeEnabled: z.boolean(),
});

export const workspaceVisualWallSnapshotSchema =
  visualWallSnapshotBaseSchema.extend({
    items: z.array(workspaceVisualWallItemSchema).max(5_000),
  });

export const cardVisualWallSnapshotSchema = visualWallSnapshotBaseSchema.extend(
  {
    items: z.array(cardVisualWallItemSchema).max(5_000),
  },
);
