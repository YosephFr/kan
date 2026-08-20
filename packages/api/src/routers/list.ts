import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as activityRepo from "@kan/db/repository/cardActivity.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import { listStatuses } from "@kan/db/schema";
import { colours } from "@kan/shared/constants";

import { listCreateResponseSchema, listUpdateResponseSchema } from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  assertCanDelete,
  assertCanEdit,
  assertPermission,
} from "../utils/permissions";

const paletteColourCodes = new Set<string>(
  colours.map((colour) => colour.code),
);
const colourCodeSchema = z
  .string()
  .transform((colourCode) => colourCode.toLowerCase())
  .refine((colourCode) => paletteColourCodes.has(colourCode), {
    message: "Colour must use the Kan palette",
  })
  .nullable();

export const listRouter = createTRPCRouter({
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a list",
        method: "POST",
        path: "/lists",
        description: "Creates a new list for a given board",
        tags: ["Lists"],
        protect: true,
      },
    })
    .input(
      z.object({
        name: z.string().min(1),
        boardPublicId: z.string().min(12),
        status: z.enum(listStatuses).nullable().optional(),
        colourCode: colourCodeSchema.optional(),
      }),
    )
    .output(listCreateResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const board = await boardRepo.getWorkspaceAndBoardIdByBoardPublicId(
        ctx.db,
        input.boardPublicId,
      );

      if (!board)
        throw new TRPCError({
          message: `Board with public ID ${input.boardPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(ctx.db, userId, board.workspaceId, "list:create");

      return listRepo.create(ctx.db, {
        name: input.name,
        createdBy: userId,
        boardId: board.id,
        status: input.status,
        colourCode: input.colourCode,
      });
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a list",
        method: "DELETE",
        path: "/lists/{listPublicId}",
        description: "Deletes a list by its public ID",
        tags: ["Lists"],
        protect: true,
      },
    })
    .input(
      z.object({
        listPublicId: z.string().min(12),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const list = await listRepo.getWorkspaceAndListIdByListPublicId(
        ctx.db,
        input.listPublicId,
      );

      if (!list)
        throw new TRPCError({
          message: `List with public ID ${input.listPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertCanDelete(
        ctx.db,
        userId,
        list.workspaceId,
        "list:delete",
        list.createdBy,
      );

      const deletedAt = new Date();

      await listRepo.softDeleteById(ctx.db, {
        listId: list.id,
        deletedAt,
        deletedBy: userId,
      });

      await notificationRepo.invalidateCardAlertsForList(ctx.db, {
        listId: list.id,
        invalidatedAt: deletedAt,
      });

      const deletedCards = await cardRepo.softDeleteAllByListIds(ctx.db, {
        listIds: [list.id],
        deletedAt,
        deletedBy: userId,
      });

      if (!Array.isArray(deletedCards))
        throw new TRPCError({
          message: `Failed to delete cards`,
          code: "INTERNAL_SERVER_ERROR",
        });

      const activities = deletedCards.map((card) => ({
        type: "card.archived" as const,
        createdBy: userId,
        cardId: card.id,
      }));

      if (activities.length) await activityRepo.bulkCreate(ctx.db, activities);

      return { success: true };
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a list",
        method: "PUT",
        path: "/lists/{listPublicId}",
        description: "Updates a list by its public ID",
        tags: ["Lists"],
        protect: true,
      },
    })
    .input(
      z.object({
        listPublicId: z.string().min(12),
        name: z.string().min(1).optional(),
        index: z.number().optional(),
        status: z.enum(listStatuses).nullable().optional(),
        colourCode: colourCodeSchema.optional(),
        confirmCardLifecycleUpdate: z.boolean().optional(),
      }),
    )
    .output(listUpdateResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const list = await listRepo.getWorkspaceAndListIdByListPublicId(
        ctx.db,
        input.listPublicId,
      );

      if (!list)
        throw new TRPCError({
          message: `List with public ID ${input.listPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertCanEdit(
        ctx.db,
        userId,
        list.workspaceId,
        "list:edit",
        list.createdBy,
      );

      let result:
        | {
            name: string;
            publicId: string;
            status: (typeof listStatuses)[number] | null;
            colourCode: string | null;
          }
        | undefined;

      if (
        input.name !== undefined ||
        input.status !== undefined ||
        input.colourCode !== undefined
      ) {
        try {
          result = await listRepo.update(
            ctx.db,
            {
              name: input.name,
              status: input.status,
              colourCode: input.colourCode,
              confirmCardLifecycleUpdate: input.confirmCardLifecycleUpdate,
            },
            { listPublicId: input.listPublicId },
          );
        } catch (error) {
          if (
            error instanceof listRepo.ListStatusChangeConfirmationRequiredError
          ) {
            throw new TRPCError({
              message: `Confirm the status change for ${error.cardCount} cards`,
              code: "BAD_REQUEST",
            });
          }

          throw error;
        }
      }

      if (input.index !== undefined) {
        result = await listRepo.reorder(ctx.db, {
          listPublicId: input.listPublicId,
          newIndex: input.index,
        });
      }

      if (input.status === "done") {
        await notificationRepo.invalidateCardAlertsForList(ctx.db, {
          listId: list.id,
        });
      }

      if (!result)
        throw new TRPCError({
          message: `Failed to update list`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return result;
    }),
});
