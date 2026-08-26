import { z } from "zod";

import {
  cardCanvasCasResultSchema,
  cardCanvasPublicIdSchema,
  cardCanvasRevisionSchema,
  cardCanvasSceneSchema,
} from "./card-canvas";

export const workspaceCanvasPublicIdSchema = cardCanvasPublicIdSchema;
export const workspaceCanvasSceneSchema = cardCanvasSceneSchema;
export const workspaceCanvasCasResultSchema = cardCanvasCasResultSchema;
export const workspaceCanvasRevisionSchema = cardCanvasRevisionSchema;

export const workspaceCanvasSnapshotSchema = z.object({
  exists: z.boolean(),
  version: z.number().int().min(0),
  scene: workspaceCanvasSceneSchema.nullable(),
  hash: z.string().length(64).nullable(),
  bytes: z.number().int().nonnegative(),
  elementCount: z.number().int().nonnegative(),
  updatedAt: z.date().nullable(),
  viewModeEnabled: z.boolean(),
});
