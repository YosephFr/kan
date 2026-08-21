import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardMoveRepo from "@kan/db/repository/card-move.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";

import { cardUpdateResponseSchema } from "../schemas";
import { protectedProcedure } from "../trpc";
import { assertCanEdit } from "../utils/permissions";
import {
  createCardWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";

export const cardMoveManyProcedure = protectedProcedure
  .meta({
    openapi: {
      summary: "Move multiple cards",
      method: "POST",
      path: "/cards/move-many",
      description: "Moves multiple cards to one list on another board",
      tags: ["Cards"],
      protect: true,
    },
  })
  .input(
    z.object({
      cardPublicIds: z.array(z.string().min(12)).min(1),
      listPublicId: z.string().min(12),
      confirmOpenSubtasks: z.boolean().optional(),
    }),
  )
  .output(z.array(cardUpdateResponseSchema))
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user?.id;

    if (!userId) {
      throw new TRPCError({
        message: "User not authenticated",
        code: "UNAUTHORIZED",
      });
    }

    if (new Set(input.cardPublicIds).size !== input.cardPublicIds.length) {
      throw new TRPCError({
        message: "Each card can only be selected once",
        code: "BAD_REQUEST",
      });
    }

    const candidates = await cardMoveRepo.getCandidates(
      ctx.db,
      input.cardPublicIds,
    );

    if (candidates.length !== input.cardPublicIds.length) {
      throw new TRPCError({
        message: "One or more cards were not found",
        code: "NOT_FOUND",
      });
    }

    const workspaceIds = new Set(
      candidates.map((card) => card.list.board.workspaceId),
    );
    const sourceBoardPublicIds = new Set(
      candidates.map((card) => card.list.board.publicId),
    );

    if (workspaceIds.size !== 1) {
      throw new TRPCError({
        message: "Selected cards must belong to the same workspace",
        code: "BAD_REQUEST",
      });
    }

    if (sourceBoardPublicIds.size !== 1) {
      throw new TRPCError({
        message: "Selected cards must belong to the same board",
        code: "BAD_REQUEST",
      });
    }

    const destinationList = await listRepo.getWorkspaceAndListIdByListPublicId(
      ctx.db,
      input.listPublicId,
    );

    if (!destinationList) {
      throw new TRPCError({
        message: `List with public ID ${input.listPublicId} not found`,
        code: "NOT_FOUND",
      });
    }

    const workspaceId = candidates[0]?.list.board.workspaceId;
    const sourceBoardPublicId = candidates[0]?.list.board.publicId;

    if (workspaceId === undefined || sourceBoardPublicId === undefined) {
      throw new TRPCError({
        message: "One or more cards were not found",
        code: "NOT_FOUND",
      });
    }

    if (workspaceId !== destinationList.workspaceId) {
      throw new TRPCError({
        message: "Cards can only be moved within the same workspace",
        code: "BAD_REQUEST",
      });
    }

    if (sourceBoardPublicId === destinationList.boardPublicId) {
      throw new TRPCError({
        message: "Choose a board other than the current board",
        code: "BAD_REQUEST",
      });
    }

    for (const card of candidates) {
      await assertCanEdit(
        ctx.db,
        userId,
        card.list.board.workspaceId,
        "card:edit",
        card.createdBy,
      );
    }

    let movedCards: Awaited<ReturnType<typeof cardMoveRepo.moveMany>>;

    try {
      movedCards = await cardMoveRepo.moveMany(ctx.db, {
        cardIds: candidates.map((card) => card.id),
        destinationListId: destinationList.id,
        expectedWorkspaceId: workspaceId,
        createdBy: userId,
        confirmOpenSubtasks: input.confirmOpenSubtasks,
      });
    } catch (error) {
      if (error instanceof WorkspaceChangedError) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more cards were not found",
        });
      }
      if (
        error instanceof Error &&
        error.message === cardRepo.OPEN_SUBTASKS_CONFIRMATION_REQUIRED
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: cardRepo.OPEN_SUBTASKS_CONFIRMATION_REQUIRED,
        });
      }
      throw error;
    }

    if (movedCards.length !== candidates.length) {
      throw new TRPCError({
        message: "Failed to move selected cards",
        code: "INTERNAL_SERVER_ERROR",
      });
    }

    const candidatesByPublicId = new Map(
      candidates.map((card) => [card.publicId, card]),
    );
    const webhookDeliveries = movedCards.map((card) => {
      const sourceCard = candidatesByPublicId.get(card.publicId);

      return sendWebhooksForWorkspace(
        ctx.db,
        destinationList.workspaceId,
        createCardWebhookPayload(
          "card.moved",
          {
            publicId: card.publicId,
            title: card.title,
            description: card.description,
            dueDate: card.dueDate,
            priority: card.priority,
            colourCode: card.colourCode,
            startedAt: card.startedAt,
            completedAt: card.completedAt,
            listId: destinationList.publicId,
          },
          {
            boardId: destinationList.boardPublicId,
            boardName: destinationList.boardName,
            listName: destinationList.name,
            user: ctx.user
              ? { id: ctx.user.id, name: ctx.user.name }
              : undefined,
            changes: sourceCard
              ? {
                  listId: {
                    from: sourceCard.list.publicId,
                    to: destinationList.publicId,
                  },
                }
              : undefined,
          },
        ),
      );
    });

    void Promise.allSettled(webhookDeliveries);

    return movedCards.map(
      ({
        publicId,
        title,
        description,
        dueDate,
        priority,
        colourCode,
        startedAt,
        completedAt,
      }) => ({
        publicId,
        title,
        description,
        dueDate,
        priority,
        colourCode,
        startedAt,
        completedAt,
      }),
    );
  });
