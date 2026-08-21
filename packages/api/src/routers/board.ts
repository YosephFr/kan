import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as boardCreateRepo from "@kan/db/repository/boardCreate.repo";
import * as boardReadRepo from "@kan/db/repository/boardRead.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { cardPriorities } from "@kan/db/schema";
import { colours } from "@kan/shared/constants";
import {
  convertDueDateFiltersToRanges,
  generateAvatarUrl,
  generateSlug,
  generateUID,
} from "@kan/shared/utils";

import {
  boardBySlugSchema,
  boardCreateResponseSchema,
  boardDetailSchema,
  boardListItemSchema,
  boardUpdateResponseSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import {
  assertCanDelete,
  assertCanEdit,
  assertPermission,
} from "../utils/permissions";

function rethrowWorkspaceChanged(error: unknown): never {
  if (error instanceof WorkspaceChangedError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
  }
  throw error;
}

export const boardRouter = createTRPCRouter({
  all: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspacePublicId}/boards",
        summary: "Get all boards",
        description: "Retrieves all boards for a given workspace",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        type: z.enum(["regular", "template"]).optional(),
        archived: z.boolean().optional(),
      }),
    )
    .output(z.array(boardListItemSchema))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(ctx.db, userId, workspace.id, "board:view");

      const result = boardRepo.getAllByWorkspaceId(
        ctx.db,
        workspace.id,
        userId,
        {
          type: input.type,
          archived: input.archived ?? false,
        },
      );

      return result;
    }),
  byId: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/boards/{boardPublicId}",
        summary: "Get board by public ID",
        description: "Retrieves a board by its public ID",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardPublicId: z.string().min(12),
        members: z.array(z.string().min(12)).optional(),
        labels: z.array(z.string().min(12)).optional(),
        lists: z.array(z.string().min(12)).optional(),
        dueDateFilters: z
          .array(
            z.enum([
              "overdue",
              "today",
              "tomorrow",
              "next-week",
              "next-month",
              "no-due-date",
            ]),
          )
          .optional(),
        priorities: z.array(z.enum(cardPriorities)).optional(),
        type: z.enum(["regular", "template"]).optional(),
      }),
    )
    .output(boardDetailSchema)
    .query(async ({ ctx, input }) => {
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

      await assertPermission(ctx.db, userId, board.workspaceId, "board:view");

      // Convert semantic string filters to date ranges expected by the repo
      const dueDateFilters = input.dueDateFilters
        ? convertDueDateFiltersToRanges(input.dueDateFilters)
        : [];

      const { board: result, summaries } = await boardReadRepo
        .getByPublicIdGuarded(ctx.db, {
          boardPublicId: input.boardPublicId,
          userId,
          expectedWorkspaceId: board.workspaceId,
          requirePublic: false,
          filters: {
            members: input.members ?? [],
            labels: input.labels ?? [],
            lists: input.lists ?? [],
            dueDate: dueDateFilters,
            priorities: input.priorities ?? [],
            type: input.type,
          },
        })
        .catch(rethrowWorkspaceChanged);

      // Generate presigned URLs for workspace member avatars
      const workspaceWithAvatarUrls = {
        ...result.workspace,
        members: await Promise.all(
          result.workspace.members.map(async (member) => {
            if (!member.user?.image) {
              return member;
            }

            const avatarUrl = await generateAvatarUrl(member.user.image);
            return {
              ...member,
              user: {
                ...member.user,
                image: avatarUrl,
              },
            };
          }),
        ),
      };

      // Generate presigned URLs for card member avatars
      const listsWithAvatarUrls = await Promise.all(
        result.lists.map(async (list) => ({
          ...list,
          cards: await Promise.all(
            list.cards.map(async (card) => ({
              ...card,
              members: await Promise.all(
                card.members.map(async (member) => {
                  if (!member.user?.image) return member;
                  const avatarUrl = await generateAvatarUrl(member.user.image);
                  return {
                    ...member,
                    user: { ...member.user, image: avatarUrl },
                  };
                }),
              ),
            })),
          ),
        })),
      );
      return {
        ...result,
        lists: listsWithAvatarUrls.map((list) => ({
          ...list,
          cards: list.cards.map((card) => ({
            ...card,
            subtaskSummary: summaries.get(card.publicId) ?? {
              total: 0,
              completed: 0,
              blocked: 0,
              progressPercent: 0,
            },
          })),
        })),
        workspace: workspaceWithAvatarUrls,
      };
    }),
  bySlug: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspaceSlug}/boards/{boardSlug}",
        summary: "Get board by slug",
        description:
          "Retrieves a board by its slug within a specific workspace",
        tags: ["Boards"],
        protect: false,
      },
    })
    .input(
      z.object({
        workspaceSlug: z
          .string()
          .min(3)
          .max(64)
          .regex(/^(?![-]+$)[a-zA-Z0-9-]+$/),
        boardSlug: z
          .string()
          .min(3)
          .max(60)
          .regex(/^(?![-]+$)[a-zA-Z0-9-]+$/),
        members: z.array(z.string().min(12)).optional(),
        labels: z.array(z.string().min(12)).optional(),
        lists: z.array(z.string().min(12)).optional(),
        dueDateFilters: z
          .array(
            z.enum([
              "overdue",
              "today",
              "tomorrow",
              "next-week",
              "next-month",
              "no-due-date",
            ]),
          )
          .optional(),
        priorities: z.array(z.enum(cardPriorities)).optional(),
      }),
    )
    .output(boardBySlugSchema.nullable())
    .query(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getBySlugWithBoards(
        ctx.db,
        input.workspaceSlug,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with slug ${input.workspaceSlug} not found`,
          code: "NOT_FOUND",
        });

      // Convert semantic string filters to date ranges expected by the repo
      const dueDateFilters = input.dueDateFilters
        ? convertDueDateFiltersToRanges(input.dueDateFilters)
        : [];

      const snapshot = await boardReadRepo
        .getBySlugGuarded(ctx.db, {
          boardSlug: input.boardSlug,
          expectedWorkspaceId: workspace.id,
          filters: {
            members: input.members ?? [],
            labels: input.labels ?? [],
            lists: input.lists ?? [],
            dueDate: dueDateFilters,
            priorities: input.priorities ?? [],
          },
        })
        .catch((error: unknown) => {
          if (error instanceof WorkspaceChangedError) return null;
          throw error;
        });

      if (!snapshot) return null;
      const { board: result, summaries } = snapshot;

      return {
        ...result,
        lists: result.lists.map((list) => ({
          ...list,
          cards: list.cards.map((card) => ({
            ...card,
            subtaskSummary: summaries.get(card.publicId) ?? {
              total: 0,
              completed: 0,
              blocked: 0,
              progressPercent: 0,
            },
          })),
        })),
      };
    }),
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/workspaces/{workspacePublicId}/boards",
        summary: "Create board",
        description: "Creates a new board for a given workspace",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(
      z.object({
        name: z.string().min(1).max(100),
        workspacePublicId: z.string().min(12),
        lists: z.array(z.string().min(1)),
        labels: z.array(z.string().min(1)),
        type: z.enum(["regular", "template"]).optional(),
        sourceBoardPublicId: z.string().min(12).optional(),
      }),
    )
    .output(boardCreateResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );

      if (!workspace)
        throw new TRPCError({
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(ctx.db, userId, workspace.id, "board:create");

      // If sourceBoardPublicId is provided, clone the source board
      if (input.sourceBoardPublicId) {
        const sourceBoardInfo = await boardRepo.getIdByPublicId(
          ctx.db,
          input.sourceBoardPublicId,
        );

        if (!sourceBoardInfo)
          throw new TRPCError({
            message: `Source board with public ID ${input.sourceBoardPublicId} not found`,
            code: "NOT_FOUND",
          });

        if (sourceBoardInfo.workspaceId !== workspace.id)
          throw new TRPCError({
            message: `Source board does not belong to this workspace`,
            code: "FORBIDDEN",
          });

        await assertPermission(
          ctx.db,
          userId,
          sourceBoardInfo.workspaceId,
          "board:view",
        );

        let slug = generateSlug(input.name);

        const isSlugUnique = await boardRepo.isSlugUnique(ctx.db, {
          slug,
          workspaceId: workspace.id,
        });

        if (!isSlugUnique || input.type === "template")
          slug = `${slug}-${generateUID()}`;

        const result = await boardRepo
          .createFromSnapshot(ctx.db, {
            workspaceId: workspace.id,
            expectedSourceWorkspaceId: sourceBoardInfo.workspaceId,
            createdBy: userId,
            slug,
            name: input.name,
            type: input.type ?? "regular",
            sourceBoardId: sourceBoardInfo.id,
          })
          .catch(rethrowWorkspaceChanged);

        return result;
      }

      // Otherwise, create a new board with provided lists and labels
      let slug = generateSlug(input.name);

      const isSlugUnique = await boardRepo.isSlugUnique(ctx.db, {
        slug,
        workspaceId: workspace.id,
      });

      if (!isSlugUnique || input.type === "template")
        slug = `${slug}-${generateUID()}`;

      const result = await boardCreateRepo
        .createWithSetup(ctx.db, {
          publicId: generateUID(),
          slug,
          name: input.name,
          createdBy: userId,
          workspaceId: workspace.id,
          type: input.type,
          lists: input.lists.map((name) => ({ name })),
          labels: input.labels.map((name, index) => ({
            name,
            colourCode: colours[index % colours.length]?.code ?? "#0d9488",
          })),
        })
        .catch(rethrowWorkspaceChanged);

      return result;
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/boards/{boardPublicId}",
        summary: "Update board",
        description: "Updates a board by its public ID",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardPublicId: z.string().min(12),
        name: z.string().min(1).optional(),
        slug: z
          .string()
          .min(3)
          .max(60)
          .regex(/^(?![-]+$)[a-zA-Z0-9-]+$/)
          .optional(),
        visibility: z.enum(["public", "private"]).optional(),
        favorite: z.boolean().optional(),
        isArchived: z.boolean().optional(),
      }),
    )
    .output(boardUpdateResponseSchema)
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

      await assertCanEdit(
        ctx.db,
        userId,
        board.workspaceId,
        "board:edit",
        board.createdBy ?? null,
      );

      // Handle favorite toggle separately
      if (input.favorite !== undefined) {
        if (input.favorite) {
          await boardRepo.addUserFavorite(ctx.db, userId, board.id);
        } else {
          await boardRepo.removeUserFavorite(ctx.db, userId, board.id);
        }
      }

      // Handle other updates (name, slug, visibility)
      const hasOtherUpdates =
        input.name !== undefined ||
        input.slug !== undefined ||
        input.visibility !== undefined ||
        input.isArchived !== undefined;

      if (!hasOtherUpdates) {
        // Only favorite was updated, return success
        return { success: true };
      }

      if (input.slug) {
        const isBoardSlugAvailable = await boardRepo.isBoardSlugAvailable(
          ctx.db,
          input.slug,
          board.workspaceId,
        );

        if (!isBoardSlugAvailable) {
          throw new TRPCError({
            message: `Board slug ${input.slug} is not available`,
            code: "BAD_REQUEST",
          });
        }
      }

      const result = await boardRepo
        .update(ctx.db, {
          name: input.name,
          slug: input.slug,
          boardPublicId: input.boardPublicId,
          expectedWorkspaceId: board.workspaceId,
          visibility: input.visibility,
          isArchived: input.isArchived,
        })
        .catch(rethrowWorkspaceChanged);

      if (!result)
        throw new TRPCError({
          message: `Failed to update board`,
          code: "INTERNAL_SERVER_ERROR",
        });

      return result;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/boards/{boardPublicId}",
        summary: "Delete board",
        description: "Deletes a board by its public ID",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardPublicId: z.string().min(12),
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

      const board = await boardRepo.getWithListIdsByPublicId(
        ctx.db,
        input.boardPublicId,
      );

      if (!board)
        throw new TRPCError({
          message: `Board with public ID ${input.boardPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertCanDelete(
        ctx.db,
        userId,
        board.workspaceId,
        "board:delete",
        board.createdBy ?? null,
      );

      const deletedAt = new Date();

      await boardRepo
        .softDelete(ctx.db, {
          boardId: board.id,
          expectedWorkspaceId: board.workspaceId,
          deletedAt,
          deletedBy: userId,
        })
        .catch(rethrowWorkspaceChanged);

      return { success: true };
    }),
  move: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/boards/{boardPublicId}/move",
        summary: "Move board to another workspace",
        description:
          "Moves a board and all its contents to a different workspace",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardPublicId: z.string().min(12),
        targetWorkspacePublicId: z.string().min(12),
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

      // Get source board
      const board = await boardRepo.getBoardForMove(
        ctx.db,
        input.boardPublicId,
      );

      if (!board)
        throw new TRPCError({
          message: `Board with public ID ${input.boardPublicId} not found`,
          code: "NOT_FOUND",
        });

      if (board.type === "template")
        throw new TRPCError({
          message: `Templates cannot be moved between workspaces`,
          code: "BAD_REQUEST",
        });

      if (board.isArchived)
        throw new TRPCError({
          message: `Archived boards cannot be moved. Unarchive the board first.`,
          code: "BAD_REQUEST",
        });

      // Check permission to edit board in source workspace
      await assertPermission(ctx.db, userId, board.workspaceId, "board:edit");

      // Get target workspace. workspaceRepo.getByPublicId does not yet
      // filter soft-deleted workspaces (legacy: same is true for several
      // peer callers); guard at this call site so we never move a board
      // into a tombstoned workspace. A wider fix to make the repo treat
      // deleted-as-not-found is a separate concern.
      const targetWorkspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.targetWorkspacePublicId,
      );

      if (!targetWorkspace || targetWorkspace.deletedAt)
        throw new TRPCError({
          message: `Target workspace not found`,
          code: "NOT_FOUND",
        });

      if (targetWorkspace.id === board.workspaceId)
        throw new TRPCError({
          message: `Board is already in this workspace`,
          code: "BAD_REQUEST",
        });

      // Check permission to create boards in target workspace
      await assertPermission(
        ctx.db,
        userId,
        targetWorkspace.id,
        "board:create",
      );

      let slug = board.slug;

      const isSlugAvailable = await boardRepo.isBoardSlugAvailable(
        ctx.db,
        slug,
        targetWorkspace.id,
      );

      if (!isSlugAvailable) {
        slug = `${slug}-${generateUID()}`;
      }

      // Move the board
      await boardRepo
        .moveToWorkspace(ctx.db, board.id, targetWorkspace.id, slug, {
          expectedSourceWorkspaceId: board.workspaceId,
          movedBy: userId,
        })
        .catch(rethrowWorkspaceChanged);

      return { success: true };
    }),
  checkSlugAvailability: publicProcedure
    .meta({
      openapi: {
        summary: "Check if a board slug is available",
        method: "GET",
        path: "/boards/{boardPublicId}/check-slug-availability",
        description: "Checks if a board slug is available",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(
      z.object({
        boardSlug: z
          .string()
          .min(3)
          .max(60)
          .regex(/^(?![-]+$)[a-zA-Z0-9-]+$/),
        boardPublicId: z.string().min(12),
      }),
    )
    .output(
      z.object({
        isReserved: z.boolean(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const board = await boardRepo.getWorkspaceAndBoardIdByBoardPublicId(
        ctx.db,
        input.boardPublicId,
      );

      if (!board)
        throw new TRPCError({
          message: `Board with public ID ${input.boardPublicId} not found`,
          code: "NOT_FOUND",
        });

      const isBoardSlugAvailable = await boardRepo.isBoardSlugAvailable(
        ctx.db,
        input.boardSlug,
        board.workspaceId,
      );

      return {
        isReserved: !isBoardSlugAvailable,
      };
    }),
});
