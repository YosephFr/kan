import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as cardSubtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as checklistRepo from "@kan/db/repository/cardSubtaskChecklist.repo";
import * as resourceRepo from "@kan/db/repository/cardSubtaskResource.repo";
import { cardPriorities } from "@kan/db/schema";
import { createLogger } from "@kan/logger";
import { stripHtml } from "@kan/shared/utils";

import {
  cardPipelineSchema,
  cardSubtaskChecklistItemSchema,
  cardSubtaskResourceSchema,
  cardSubtaskSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  assertCardPipelineEditable,
  findPipelineSubtask,
  getCardMetaOrThrow,
  loadCardPipeline,
} from "../utils/card-pipeline";
import { assertPermission } from "../utils/permissions";
import {
  createSubtaskWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";

const publicId = z.string().length(12);
const logger = createLogger("card-subtask-router");
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

function userIdOrThrow(user: { id: string } | null | undefined) {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return user.id;
}

function rejectWorkspaceChange(result: { status: string }) {
  if (result.status === "workspace_changed") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
  }
}

async function getEditableSubtaskContext(
  ctx: { db: dbClient; user?: { id: string } | null },
  subtaskPublicId: string,
) {
  const context = await cardSubtaskRepo.getSubtaskContextByPublicId(
    ctx.db,
    subtaskPublicId,
  );
  if (!context) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Subtask not found" });
  }
  await assertPermission(
    ctx.db,
    userIdOrThrow(ctx.user),
    context.workspaceId,
    "card:edit",
  );
  return context;
}

type SubtaskContext = NonNullable<
  Awaited<ReturnType<typeof cardSubtaskRepo.getSubtaskContextByPublicId>>
>;
type Pipeline = Awaited<ReturnType<typeof loadCardPipeline>>;

function emitWebhook(
  db: Parameters<typeof sendWebhooksForWorkspace>[0],
  event:
    | "subtask.created"
    | "subtask.updated"
    | "subtask.moved"
    | "subtask.assigned"
    | "subtask.deleted",
  context: SubtaskContext,
  pipeline: Pipeline,
  subtaskPublicId: string,
  changes?: Record<string, { from: unknown; to: unknown }>,
) {
  const { subtask, stage } = findPipelineSubtask(pipeline, subtaskPublicId);
  void sendWebhooksForWorkspace(
    db,
    context.workspaceId,
    createSubtaskWebhookPayload(
      event,
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
        changes,
      },
    ),
  ).catch((error) => {
    logger.error(
      { error, event, subtaskPublicId, cardPublicId: context.cardPublicId },
      "Subtask webhook delivery failed",
    );
  });
}

async function loadSubtask(
  ctx: { db: dbClient },
  context: SubtaskContext,
  subtaskPublicId: string,
) {
  const pipeline = await loadCardPipeline(ctx, {
    workspaceId: context.workspaceId,
    publicId: context.cardPublicId,
  });
  return { pipeline, ...findPipelineSubtask(pipeline, subtaskPublicId) };
}

export const cardSubtaskRouter = createTRPCRouter({
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a card subtask",
        method: "POST",
        path: "/cards/{cardPublicId}/subtasks",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicId,
        stagePublicId: publicId,
        title: requiredPlainText(500),
        description: descriptionSchema.nullable().optional(),
        priority: z.enum(cardPriorities).optional(),
        dueDate: z.date().nullable().optional(),
        ownerPublicId: publicId.nullable().optional(),
      }),
    )
    .output(cardSubtaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const card = await getCardMetaOrThrow(ctx, input.cardPublicId);
      await assertCardPipelineEditable(ctx, card);
      const currentPipeline = await loadCardPipeline(ctx, card);
      if (
        !currentPipeline.initialized ||
        !currentPipeline.stages.some(
          (stage) => stage.publicId === input.stagePublicId,
        )
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "CARD_PIPELINE_NOT_INITIALIZED",
        });
      }

      const result = await cardSubtaskRepo.createSubtask(ctx.db, {
        stagePublicId: input.stagePublicId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate,
        ownerPublicId: input.ownerPublicId,
        expectedWorkspaceId: card.workspaceId,
        createdBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "owner_invalid") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Owner not found" });
      }
      if (result.status === "invalid_input") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "INVALID_SUBTASK",
        });
      }
      if (result.status !== "created" || !result.subtask) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found" });
      }

      const context = await cardSubtaskRepo.getSubtaskContextByPublicId(
        ctx.db,
        result.subtask.publicId,
      );
      if (!context) throw new TRPCError({ code: "NOT_FOUND" });
      const loaded = await loadSubtask(ctx, context, result.subtask.publicId);
      emitWebhook(
        ctx.db,
        "subtask.created",
        context,
        loaded.pipeline,
        result.subtask.publicId,
      );
      return loaded.subtask;
    }),

  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a card subtask",
        method: "PUT",
        path: "/subtasks/{subtaskPublicId}",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        title: requiredPlainText(500).optional(),
        description: descriptionSchema.nullable().optional(),
        priority: z.enum(cardPriorities).optional(),
        dueDate: z.date().nullable().optional(),
      }),
    )
    .output(cardSubtaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const result = await cardSubtaskRepo.updateSubtask(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        updatedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "invalid_input") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "INVALID_SUBTASK",
        });
      }
      if (result.status !== "updated") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subtask not found",
        });
      }
      const loaded = await loadSubtask(ctx, context, input.subtaskPublicId);
      emitWebhook(
        ctx.db,
        "subtask.updated",
        context,
        loaded.pipeline,
        input.subtaskPublicId,
      );
      return loaded.subtask;
    }),

  move: protectedProcedure
    .meta({
      openapi: {
        summary: "Move a card subtask",
        method: "POST",
        path: "/subtasks/{subtaskPublicId}/move",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        stagePublicId: publicId,
        index: z.number().int().min(0).optional(),
      }),
    )
    .output(cardSubtaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const before = await loadSubtask(ctx, context, input.subtaskPublicId);
      const destination = before.pipeline.stages.find(
        (stage) => stage.publicId === input.stagePublicId,
      );
      if (!destination) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found" });
      }
      const destinationIndex =
        input.index ??
        Math.max(
          0,
          destination.subtasks.length -
            (before.stage.publicId === destination.publicId ? 1 : 0),
        );
      const result = await cardSubtaskRepo.moveSubtask(ctx.db, {
        subtaskPublicId: input.subtaskPublicId,
        destinationStagePublicId: input.stagePublicId,
        destinationIndex,
        expectedWorkspaceId: context.workspaceId,
        movedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "invalid_index") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid index" });
      }
      if (result.status !== "moved") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found" });
      }
      const loaded = await loadSubtask(ctx, context, input.subtaskPublicId);
      emitWebhook(
        ctx.db,
        "subtask.moved",
        context,
        loaded.pipeline,
        input.subtaskPublicId,
        {
          stagePublicId: {
            from: before.stage.publicId,
            to: destination.publicId,
          },
        },
      );
      return loaded.subtask;
    }),

  reorder: protectedProcedure
    .meta({
      openapi: {
        summary: "Reorder all subtasks in a stage",
        method: "PUT",
        path: "/cards/{cardPublicId}/pipeline/stages/{stagePublicId}/subtasks/order",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicId,
        stagePublicId: publicId,
        orderedSubtaskPublicIds: z.array(publicId),
      }),
    )
    .output(cardPipelineSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const card = await getCardMetaOrThrow(ctx, input.cardPublicId);
      await assertCardPipelineEditable(ctx, card);
      const pipeline = await loadCardPipeline(ctx, card);
      if (
        !pipeline.stages.some((stage) => stage.publicId === input.stagePublicId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found" });
      }
      const result = await cardSubtaskRepo.reorderSubtasks(ctx.db, {
        stagePublicId: input.stagePublicId,
        orderedSubtaskPublicIds: input.orderedSubtaskPublicIds,
        expectedWorkspaceId: card.workspaceId,
        updatedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "invalid_order") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid order" });
      }
      if (result.status !== "reordered") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found" });
      }
      return loadCardPipeline(ctx, card);
    }),

  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a card subtask",
        method: "DELETE",
        path: "/subtasks/{subtaskPublicId}",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(z.object({ subtaskPublicId: publicId }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const loaded = await loadSubtask(ctx, context, input.subtaskPublicId);
      const result = await cardSubtaskRepo.softDeleteSubtask(ctx.db, {
        subtaskPublicId: input.subtaskPublicId,
        expectedWorkspaceId: context.workspaceId,
        deletedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status !== "deleted") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subtask not found",
        });
      }
      emitWebhook(
        ctx.db,
        "subtask.deleted",
        context,
        loaded.pipeline,
        input.subtaskPublicId,
      );
      return { success: true };
    }),

  setOwner: protectedProcedure
    .meta({
      openapi: {
        summary: "Assign a card subtask",
        method: "PUT",
        path: "/subtasks/{subtaskPublicId}/owner",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        ownerPublicId: publicId.nullable(),
      }),
    )
    .output(cardSubtaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const before = await loadSubtask(ctx, context, input.subtaskPublicId);
      const result = await cardSubtaskRepo.setSubtaskOwner(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        updatedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "owner_invalid") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Owner not found" });
      }
      if (result.status !== "updated" && result.status !== "unchanged") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subtask not found",
        });
      }
      const loaded = await loadSubtask(ctx, context, input.subtaskPublicId);
      if (result.ownerChanged) {
        emitWebhook(
          ctx.db,
          "subtask.assigned",
          context,
          loaded.pipeline,
          input.subtaskPublicId,
          {
            ownerPublicId: {
              from: before.subtask.owner?.publicId ?? null,
              to: loaded.subtask.owner?.publicId ?? null,
            },
          },
        );
      }
      return loaded.subtask;
    }),

  createChecklistItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a subtask checklist item",
        method: "POST",
        path: "/subtasks/{subtaskPublicId}/checklist",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        title: requiredPlainText(500),
      }),
    )
    .output(cardSubtaskChecklistItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const result = await checklistRepo.addChecklistItem(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        createdBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "invalid_input") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "INVALID_SUBTASK_CHECKLIST_ITEM",
        });
      }
      if (result.status !== "created") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subtask not found",
        });
      }
      return result.item;
    }),

  updateChecklistItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a subtask checklist item",
        method: "PATCH",
        path: "/subtasks/checklist/{checklistItemPublicId}",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        checklistItemPublicId: publicId,
        title: requiredPlainText(500).optional(),
        completed: z.boolean().optional(),
      }),
    )
    .output(cardSubtaskChecklistItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await checklistRepo.getChecklistItemContextByPublicId(
        ctx.db,
        input.checklistItemPublicId,
      );
      if (!context) throw new TRPCError({ code: "NOT_FOUND" });
      await assertPermission(ctx.db, userId, context.workspaceId, "card:edit");
      const result = await checklistRepo.updateChecklistItem(ctx.db, {
        itemPublicId: input.checklistItemPublicId,
        title: input.title,
        completed: input.completed,
        expectedWorkspaceId: context.workspaceId,
        updatedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "invalid_input") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "INVALID_SUBTASK_CHECKLIST_ITEM",
        });
      }
      if (result.status !== "updated") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return result.item;
    }),

  reorderChecklist: protectedProcedure
    .meta({
      openapi: {
        summary: "Reorder a subtask checklist",
        method: "PUT",
        path: "/subtasks/{subtaskPublicId}/checklist/order",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        orderedItemPublicIds: z.array(publicId),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const result = await checklistRepo.reorderChecklistItems(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        updatedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "invalid_order") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid order" });
      }
      if (result.status !== "reordered")
        throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  deleteChecklistItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a subtask checklist item",
        method: "DELETE",
        path: "/subtasks/checklist/{checklistItemPublicId}",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(z.object({ checklistItemPublicId: publicId }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await checklistRepo.getChecklistItemContextByPublicId(
        ctx.db,
        input.checklistItemPublicId,
      );
      if (!context) throw new TRPCError({ code: "NOT_FOUND" });
      await assertPermission(ctx.db, userId, context.workspaceId, "card:edit");
      const result = await checklistRepo.softDeleteChecklistItem(ctx.db, {
        itemPublicId: input.checklistItemPublicId,
        expectedWorkspaceId: context.workspaceId,
        deletedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status !== "deleted")
        throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  linkAttachment: protectedProcedure
    .meta({
      openapi: {
        summary: "Link a parent card attachment to a subtask",
        method: "POST",
        path: "/subtasks/{subtaskPublicId}/attachments",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        attachmentPublicId: publicId,
      }),
    )
    .output(cardSubtaskResourceSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const result = await resourceRepo.linkAttachment(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        createdBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status === "attachment_invalid") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Attachment not found",
        });
      }
      if (result.status !== "linked" && result.status !== "existing") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subtask not found",
        });
      }
      const loaded = await loadSubtask(ctx, context, input.subtaskPublicId);
      const resource = loaded.subtask.resources.find(
        (candidate) =>
          candidate.attachmentPublicId === input.attachmentPublicId,
      );
      if (!resource) throw new TRPCError({ code: "NOT_FOUND" });
      return resource;
    }),

  unlinkAttachment: protectedProcedure
    .meta({
      openapi: {
        summary: "Unlink an attachment from a subtask",
        method: "DELETE",
        path: "/subtasks/{subtaskPublicId}/attachments/{resourcePublicId}",
        tags: ["Card pipeline"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        resourcePublicId: publicId,
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = userIdOrThrow(ctx.user);
      const context = await getEditableSubtaskContext(
        ctx,
        input.subtaskPublicId,
      );
      const result = await resourceRepo.unlinkAttachment(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        deletedBy: userId,
      });
      rejectWorkspaceChange(result);
      if (result.status !== "unlinked")
        throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});
