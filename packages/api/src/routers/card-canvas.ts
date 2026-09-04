import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardCanvasRepo from "@kan/db/repository/cardCanvas.repo";
import {
  CardCanvasConversionError,
  CardCanvasReferenceError,
} from "@kan/db/repository/cardCanvas.repo";
import * as cardSubtaskRepo from "@kan/db/repository/cardSubtask.repo";
import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";
import { createLogger } from "@kan/logger";
import { CardCanvasSceneError } from "@kan/shared";
import { stripHtml } from "@kan/shared/utils";

import {
  cardCanvasCasResultSchema,
  cardCanvasConvertFrameInputSchema,
  cardCanvasConvertFrameResultSchema,
  cardCanvasFrameSchema,
  cardCanvasPublicIdSchema,
  cardCanvasRevisionSchema,
  cardCanvasSnapshotSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { findPipelineSubtask, loadCardPipeline } from "../utils/card-pipeline";
import { assertPermission, hasPermission } from "../utils/permissions";
import {
  createSubtaskWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";

const logger = createLogger("card-canvas-router");
const expectedVersionSchema = z.number().int().min(0).max(2_147_483_647);
const requiredPlainText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => stripHtml(value).trim())
    .pipe(z.string().min(1).max(max));
const descriptionSchema = z
  .string()
  .max(10000)
  .transform(stripHtml)
  .pipe(z.string().max(10000));

type CardMeta = NonNullable<
  Awaited<ReturnType<typeof cardRepo.getWorkspaceAndCardIdByCardPublicId>>
>;

async function getCardOrThrow(db: dbClient, cardPublicId: string) {
  const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
    db,
    cardPublicId,
  );
  if (!card) {
    throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
  }
  return card;
}

async function getReadableAccess(
  db: dbClient,
  user: { id: string } | null | undefined,
  card: CardMeta,
) {
  const requirePublic = card.workspaceVisibility === "public";
  if (!requirePublic) {
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    await assertPermission(db, user.id, card.workspaceId, "card:view");
  }
  const editable = user
    ? await hasPermission(db, user.id, card.workspaceId, "card:edit")
    : false;
  return { requirePublic, viewModeEnabled: !editable };
}

function userIdOrThrow(user: { id: string } | null | undefined) {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return user.id;
}

function mapCanvasError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof WorkspaceChangedError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
  }
  if (error instanceof WorkspacePermissionChangedError) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "CARD_CANVAS_EDIT_FORBIDDEN",
    });
  }
  if (error instanceof CardCanvasSceneError) {
    const oversized =
      error.code === "SCENE_TOO_LARGE" || error.code === "TOO_MANY_ELEMENTS";
    throw new TRPCError({
      code: oversized ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
      message: error.code,
    });
  }
  if (error instanceof CardCanvasReferenceError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.code });
  }
  if (error instanceof CardCanvasConversionError) {
    if (error.code === "SUBTASK_INVALID") {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.code });
    }
    const notFound =
      error.code === "CANVAS_FRAME_NOT_FOUND" ||
      error.code === "SUBTASK_OWNER_INVALID";
    throw new TRPCError({
      code: notFound ? "NOT_FOUND" : "CONFLICT",
      message: error.code,
    });
  }
  throw error;
}

async function emitConvertedSubtaskWebhook(
  db: dbClient,
  subtaskPublicId: string,
) {
  const context = await cardSubtaskRepo.getSubtaskContextByPublicId(
    db,
    subtaskPublicId,
  );
  if (!context) throw new Error("Converted subtask context not found");
  const pipeline = await loadCardPipeline(
    { db },
    { workspaceId: context.workspaceId, publicId: context.cardPublicId },
  );
  const { subtask, stage } = findPipelineSubtask(pipeline, subtaskPublicId);
  void sendWebhooksForWorkspace(
    db,
    context.workspaceId,
    createSubtaskWebhookPayload(
      "subtask.created",
      {
        publicId: subtask.publicId,
        title: subtask.title,
        description: subtask.description,
        priority: subtask.priority,
        dueDate: subtask.dueDate,
        startedAt: subtask.startedAt,
        completedAt: subtask.completedAt,
        index: subtask.index,
        stage: {
          publicId: stage.publicId,
          status: stage.status,
          name: stage.name,
        },
        ownerPublicId: subtask.owner?.publicId ?? null,
      },
      {
        card: {
          publicId: context.cardPublicId,
          title: context.cardTitle,
          listPublicId: context.listPublicId,
        },
        board: {
          publicId: context.boardPublicId,
          name: context.boardName,
        },
        listName: context.listName,
      },
    ),
  ).catch(() => {
    logger.error(
      {
        errorCode: "CANVAS_WEBHOOK_DELIVERY_FAILED",
        subtaskPublicId,
        cardPublicId: context.cardPublicId,
      },
      "Canvas conversion webhook delivery failed",
    );
  });
}

export const cardCanvasRouter = createTRPCRouter({
  get: publicProcedure
    .meta({
      openapi: {
        summary: "Get a card canvas",
        method: "GET",
        path: "/cards/{cardPublicId}/canvas",
        tags: ["Card canvas"],
      },
    })
    .input(z.object({ cardPublicId: cardCanvasPublicIdSchema }))
    .output(cardCanvasSnapshotSchema)
    .query(async ({ ctx, input }) => {
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      const access = await getReadableAccess(ctx.db, ctx.user, card);
      try {
        const head = await cardCanvasRepo.getSnapshot(ctx.db, {
          cardPublicId: input.cardPublicId,
          expectedWorkspaceId: card.workspaceId,
          requirePublic: access.requirePublic,
        });
        return head
          ? {
              exists: true,
              version: head.version,
              scene: head.scene,
              hash: head.hash,
              bytes: head.bytes,
              elementCount: head.elementCount,
              updatedAt: head.updatedAt,
              viewModeEnabled: access.viewModeEnabled,
            }
          : {
              exists: false,
              version: 0,
              scene: null,
              hash: null,
              bytes: 0,
              elementCount: 0,
              updatedAt: null,
              viewModeEnabled: access.viewModeEnabled,
            };
      } catch (error) {
        mapCanvasError(error);
      }
    }),

  save: protectedProcedure
    .meta({
      openapi: {
        summary: "Save a card canvas",
        method: "PUT",
        path: "/cards/{cardPublicId}/canvas",
        tags: ["Card canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: cardCanvasPublicIdSchema,
        expectedVersion: expectedVersionSchema,
        scene: z.unknown(),
      }),
    )
    .output(cardCanvasCasResultSchema)
    .mutation(() => {
      throw new TRPCError({
        code: "CONFLICT",
        message: "CANVAS_LEGACY_READ_ONLY",
      });
    }),

  listRevisions: protectedProcedure
    .meta({
      openapi: {
        summary: "List card canvas revisions",
        method: "GET",
        path: "/cards/{cardPublicId}/canvas/revisions",
        tags: ["Card canvas"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: cardCanvasPublicIdSchema }))
    .output(z.array(cardCanvasRevisionSchema))
    .query(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");
      try {
        return await cardCanvasRepo.listRevisions(ctx.db, {
          cardPublicId: input.cardPublicId,
          expectedWorkspaceId: card.workspaceId,
        });
      } catch (error) {
        mapCanvasError(error);
      }
    }),

  restore: protectedProcedure
    .meta({
      openapi: {
        summary: "Restore a card canvas revision",
        method: "POST",
        path: "/cards/{cardPublicId}/canvas/restore",
        tags: ["Card canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: cardCanvasPublicIdSchema,
        revisionPublicId: cardCanvasPublicIdSchema,
        expectedVersion: expectedVersionSchema,
      }),
    )
    .output(cardCanvasCasResultSchema)
    .mutation(() => {
      throw new TRPCError({
        code: "CONFLICT",
        message: "CANVAS_LEGACY_READ_ONLY",
      });
    }),

  listFrames: publicProcedure
    .meta({
      openapi: {
        summary: "List card canvas frames",
        method: "GET",
        path: "/cards/{cardPublicId}/canvas/frames",
        tags: ["Card canvas"],
      },
    })
    .input(z.object({ cardPublicId: cardCanvasPublicIdSchema }))
    .output(z.array(cardCanvasFrameSchema))
    .query(async ({ ctx, input }) => {
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      const access = await getReadableAccess(ctx.db, ctx.user, card);
      try {
        return await cardCanvasRepo.listFrames(ctx.db, {
          cardPublicId: input.cardPublicId,
          expectedWorkspaceId: card.workspaceId,
          requirePublic: access.requirePublic,
          includeTombstones: !access.viewModeEnabled,
        });
      } catch (error) {
        mapCanvasError(error);
      }
    }),

  convertFrame: protectedProcedure
    .meta({
      openapi: {
        summary: "Convert a canvas frame to a card subtask",
        method: "POST",
        path: "/cards/{cardPublicId}/canvas/convert-frame",
        tags: ["Card canvas"],
        protect: true,
      },
    })
    .input(
      cardCanvasConvertFrameInputSchema.omit({ scene: true }).extend({
        scene: z.unknown().optional(),
        subtaskFields:
          cardCanvasConvertFrameInputSchema.shape.subtaskFields.extend({
            title: requiredPlainText(500),
            description: descriptionSchema.nullable().optional(),
          }),
      }),
    )
    .output(cardCanvasConvertFrameResultSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");
      try {
        const result = await cardCanvasRepo.convertFrame(ctx.db, {
          cardPublicId: input.cardPublicId,
          framePublicId: input.framePublicId,
          expectedVersion: input.expectedVersion,
          targetStageStatus: input.targetStageStatus,
          subtaskFields: input.subtaskFields,
          expectedWorkspaceId: card.workspaceId,
          actorId: userId,
        });
        if (result.status === "conflict") return result;
        await emitConvertedSubtaskWebhook(ctx.db, result.subtaskPublicId).catch(
          () => {
            logger.error(
              {
                errorCode: "CANVAS_WEBHOOK_PREPARATION_FAILED",
                subtaskPublicId: result.subtaskPublicId,
              },
              "Unable to prepare canvas conversion webhook",
            );
          },
        );
        return result;
      } catch (error) {
        mapCanvasError(error);
      }
    }),
});
