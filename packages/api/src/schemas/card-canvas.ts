import { z } from "zod";

import { cardPipelineStageStatuses, cardPriorities } from "@kan/db/schema";
import { MAX_CARD_CANVAS_ELEMENTS } from "@kan/shared";

export const cardCanvasPublicIdSchema = z.string().regex(/^[a-z0-9]{12}$/);

const cardCanvasElementSchema = z
  .object({
    id: z.string(),
    type: z.string(),
  })
  .passthrough();

function hasAllowedCardCanvasElementCount(value: unknown) {
  if (typeof value !== "object" || value === null) return true;
  const elements = (value as Record<string, unknown>).elements;
  return (
    !Array.isArray(elements) || elements.length <= MAX_CARD_CANVAS_ELEMENTS
  );
}

const cardCanvasSceneElementLimitSchema = z.custom<unknown>(
  hasAllowedCardCanvasElementCount,
  { message: "TOO_MANY_ELEMENTS" },
);

export const cardCanvasSceneSchema = cardCanvasSceneElementLimitSchema.pipe(
  z.object({
    elements: z.array(cardCanvasElementSchema),
    appState: z.object({
      viewBackgroundColor: z.string().optional(),
      gridSize: z.number().nullable().optional(),
      gridStep: z.number().nullable().optional(),
      gridModeEnabled: z.boolean().optional(),
      objectsSnapModeEnabled: z.boolean().optional(),
    }),
  }),
);

export const cardCanvasSnapshotSchema = z.object({
  exists: z.boolean(),
  version: z.number().int().min(0),
  scene: cardCanvasSceneSchema.nullable(),
  hash: z.string().length(64).nullable(),
  bytes: z.number().int().nonnegative(),
  elementCount: z.number().int().nonnegative(),
  updatedAt: z.date().nullable(),
  viewModeEnabled: z.boolean(),
});

export const cardCanvasCasSuccessSchema = z.object({
  status: z.enum(["saved", "unchanged"]),
  version: z.number().int().positive(),
  hash: z.string().length(64),
  bytes: z.number().int().nonnegative(),
  elementCount: z.number().int().nonnegative(),
});

export const cardCanvasConflictSchema = z.object({
  status: z.literal("conflict"),
  code: z.literal("CANVAS_VERSION_CONFLICT"),
  remoteVersion: z.number().int().nonnegative(),
});

export const cardCanvasCasResultSchema = z.union([
  cardCanvasCasSuccessSchema,
  cardCanvasConflictSchema,
]);

export const cardCanvasRevisionSchema = z.object({
  publicId: cardCanvasPublicIdSchema,
  version: z.number().int().positive(),
  kind: z.enum(["automatic", "preRestore"]),
  bytes: z.number().int().nonnegative(),
  elementCount: z.number().int().nonnegative(),
  createdAt: z.date(),
});

export const cardCanvasFrameSchema = z.object({
  publicId: cardCanvasPublicIdSchema,
  elementId: z.string(),
  name: z.string(),
  present: z.boolean(),
  subtask: z
    .object({
      publicId: cardCanvasPublicIdSchema,
      title: z.string(),
      stageStatus: z.enum(cardPipelineStageStatuses),
      checklist: z.object({
        total: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        progressPercent: z.number().int().min(0).max(100),
      }),
    })
    .nullable(),
});

export const cardCanvasConvertFrameInputSchema = z.object({
  cardPublicId: cardCanvasPublicIdSchema,
  framePublicId: cardCanvasPublicIdSchema,
  expectedVersion: z.number().int().min(0),
  scene: cardCanvasSceneSchema.optional(),
  targetStageStatus: z.enum(cardPipelineStageStatuses),
  subtaskFields: z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(10000).nullable().optional(),
    priority: z.enum(cardPriorities).optional(),
    dueDate: z.date().nullable().optional(),
    ownerPublicId: cardCanvasPublicIdSchema.nullable().optional(),
  }),
});

export const cardCanvasConvertFrameResultSchema = z.union([
  z.object({
    status: z.literal("saved"),
    version: z.number().int().positive(),
    hash: z.string().length(64),
    bytes: z.number().int().nonnegative(),
    elementCount: z.number().int().nonnegative(),
    framePublicId: cardCanvasPublicIdSchema,
    subtaskPublicId: cardCanvasPublicIdSchema,
  }),
  cardCanvasConflictSchema,
]);
