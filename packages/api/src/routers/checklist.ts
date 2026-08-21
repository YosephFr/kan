import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import { stripHtml } from "@kan/shared/utils";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

const checklistSchema = z.object({
  publicId: z.string().length(12),
  name: z.string().min(1).max(255),
});

const checklistItemSchema = z.object({
  publicId: z.string().length(12),
  title: z.string().min(1).max(500),
  completed: z.boolean(),
});

const executeWorkspaceBound = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceChangedError) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
    }
    throw error;
  }
};

export const checklistRouter = createTRPCRouter({
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Add a checklist to a card",
        method: "POST",
        path: "/cards/{cardPublicId}/checklists",
        description: "Adds a checklist to a card",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        name: z.string().min(1).max(255),
      }),
    )
    .output(checklistSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");

      const newChecklist = await executeWorkspaceBound(() =>
        checklistRepo.create(ctx.db, {
          name: input.name,
          createdBy: userId,
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
        }),
      );

      if (!newChecklist?.id)
        throw new TRPCError({
          message: `Failed to create checklist`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return newChecklist;
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a checklist",
        method: "PUT",
        path: "/checklists/{checklistPublicId}",
        description: "Updates a checklist by its public ID",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        checklistPublicId: z.string().length(12),
        name: z.string().min(1).max(255),
      }),
    )
    .output(z.object({ publicId: z.string().length(12), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const checklist = await checklistRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );
      if (!checklist)
        throw new TRPCError({
          message: `Checklist with public ID ${input.checklistPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const updated = await executeWorkspaceBound(() =>
        checklistRepo.updateChecklistById(ctx.db, {
          id: checklist.id,
          name: input.name,
          expectedWorkspaceId: checklist.card.list.board.workspace.id,
          updatedBy: userId,
        }),
      );

      return updated;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a checklist",
        method: "DELETE",
        path: "/checklists/{checklistPublicId}",
        description: "Deletes a checklist by its public ID",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(z.object({ checklistPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const checklist = await checklistRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );
      if (!checklist)
        throw new TRPCError({
          message: `Checklist with public ID ${input.checklistPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const _deleted = await executeWorkspaceBound(() =>
        checklistRepo.softDeleteById(ctx.db, {
          id: checklist.id,
          expectedWorkspaceId: checklist.card.list.board.workspace.id,
          deletedAt: new Date(),
          deletedBy: userId,
        }),
      );

      return { success: true };
    }),
  createItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Add an item to a checklist",
        method: "POST",
        path: "/checklists/{checklistPublicId}/items",
        description: "Adds an item to a checklist",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        checklistPublicId: z.string().length(12),
        title: z.string().min(1).max(500).transform(stripHtml),
      }),
    )
    .output(checklistItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const checklist = await checklistRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );

      if (!checklist)
        throw new TRPCError({
          message: `Checklist with public ID ${input.checklistPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const newChecklistItem = await executeWorkspaceBound(() =>
        checklistRepo.createItem(ctx.db, {
          title: input.title,
          createdBy: userId,
          checklistId: checklist.id,
          expectedWorkspaceId: checklist.card.list.board.workspace.id,
        }),
      );

      if (!newChecklistItem?.id)
        throw new TRPCError({
          message: `Failed to create checklist item`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return newChecklistItem;
    }),
  updateItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a checklist item",
        method: "PATCH",
        path: "/checklists/items/{checklistItemPublicId}",
        description: "Updates a checklist item (title/completed)",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        checklistItemPublicId: z.string().length(12),
        title: z.string().min(1).max(500).transform(stripHtml).optional(),
        completed: z.boolean().optional(),
        index: z.number().int().min(0).optional(),
      }),
    )
    .output(checklistItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const item = await checklistRepo.getChecklistItemByPublicIdWithChecklist(
        ctx.db,
        input.checklistItemPublicId,
      );

      if (!item)
        throw new TRPCError({
          message: `Checklist item with public ID ${input.checklistItemPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        item.checklist.card.list.board.workspace.id,
        "card:edit",
      );

      let updatedItem;

      if (input.title !== undefined || input.completed !== undefined) {
        updatedItem = await executeWorkspaceBound(() =>
          checklistRepo.updateItemById(ctx.db, {
            id: item.id,
            title: input.title,
            completed: input.completed,
            expectedWorkspaceId: item.checklist.card.list.board.workspace.id,
            updatedBy: userId,
          }),
        );
      }

      if (input.index !== undefined) {
        const newIndex = input.index;
        updatedItem = await executeWorkspaceBound(() =>
          checklistRepo.reorderItem(ctx.db, {
            itemId: item.id,
            newIndex,
            expectedWorkspaceId: item.checklist.card.list.board.workspace.id,
          }),
        );
      }

      if (!updatedItem) {
        throw new TRPCError({
          message: `Failed to update checklist item`,
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      return updatedItem;
    }),
  deleteItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a checklist item",
        method: "DELETE",
        path: "/checklists/items/{checklistItemPublicId}",
        description: "Deletes a checklist item",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(z.object({ checklistItemPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const item = await checklistRepo.getChecklistItemByPublicIdWithChecklist(
        ctx.db,
        input.checklistItemPublicId,
      );
      if (!item)
        throw new TRPCError({
          message: `Checklist item with public ID ${input.checklistItemPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        item.checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const _deleted = await executeWorkspaceBound(() =>
        checklistRepo.softDeleteItemById(ctx.db, {
          id: item.id,
          expectedWorkspaceId: item.checklist.card.list.board.workspace.id,
          deletedAt: new Date(),
          deletedBy: userId,
        }),
      );

      return { success: true };
    }),
});
