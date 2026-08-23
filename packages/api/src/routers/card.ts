import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { CardMutationActivityInput } from "@kan/db/repository/cardMutationActivity";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as cardAssociationsRepo from "@kan/db/repository/cardAssociations.repo";
import * as cardCommentRepo from "@kan/db/repository/cardComment.repo";
import * as cardDuplicateRepo from "@kan/db/repository/cardDuplicate.repo";
import * as cardReadRepo from "@kan/db/repository/cardRead.repo";
import { PublicVisibilityAcknowledgementError } from "@kan/db/repository/cardResourceVisibility.repo";
import * as labelRepo from "@kan/db/repository/label.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { cardPriorities } from "@kan/db/schema";
import { createLogger } from "@kan/logger";
import { colours } from "@kan/shared/constants";
import { generateAvatarUrl } from "@kan/shared/utils";

import {
  activityItemSchema,
  cardCreateResponseSchema,
  cardDetailSchema,
  cardUpdateResponseSchema,
  commentDeleteResponseSchema,
  commentResponseSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { mergeActivities } from "../utils/activities";
import { sendMentionEmails } from "../utils/notifications";
import {
  assertCanDelete,
  assertCanEdit,
  assertPermission,
} from "../utils/permissions";
import {
  createCardWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";
import { cardMoveManyProcedure } from "./card-move-many";

const paletteColourCodes = new Set<string>(
  colours.map((colour) => colour.code),
);
const logger = createLogger("card-router");
const colourCodeSchema = z
  .string()
  .transform((colourCode) => colourCode.toLowerCase())
  .refine((colourCode) => paletteColourCodes.has(colourCode), {
    message: "Colour must use the Kan palette",
  })
  .nullable();

function rethrowWorkspaceChanged(error: unknown): never {
  if (error instanceof WorkspaceChangedError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
  }
  throw error;
}

function rethrowCardMutationError(error: unknown): never {
  if (error instanceof PublicVisibilityAcknowledgementError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
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

  rethrowWorkspaceChanged(error);
}

async function runUrgentAlertBestEffort(
  operation: () => Promise<unknown>,
  context: {
    cardPublicId: string;
    trigger: "create" | "priority" | "assignment" | "duplicate";
  },
) {
  try {
    await operation();
  } catch (error) {
    logger.error({ error, ...context }, "Urgent card alert delivery failed");
  }
}

export const cardRouter = createTRPCRouter({
  moveMany: cardMoveManyProcedure,
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a card",
        method: "POST",
        path: "/cards",
        description: "Creates a new card for a given list",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        title: z.string().min(1).max(2000),
        description: z.string().max(10000),
        listPublicId: z.string().min(12),
        labelPublicIds: z.array(z.string().min(12)),
        memberPublicIds: z.array(z.string().min(12)),
        position: z.enum(["start", "end"]),
        dueDate: z.date().nullable().optional(),
        priority: z.enum(cardPriorities).optional(),
        colourCode: colourCodeSchema.optional(),
      }),
    )
    .output(cardCreateResponseSchema)
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

      await assertPermission(ctx.db, userId, list.workspaceId, "card:create");

      const labelPublicIds = [...new Set(input.labelPublicIds)];
      const labels = labelPublicIds.length
        ? await labelRepo.getAllByPublicIdsForBoard(
            ctx.db,
            labelPublicIds,
            list.boardId,
          )
        : [];

      if (labels.length !== labelPublicIds.length)
        throw new TRPCError({
          message: `Labels with public IDs (${labelPublicIds.join(", ")}) not found`,
          code: "NOT_FOUND",
        });

      const memberPublicIds = [...new Set(input.memberPublicIds)];
      const members = memberPublicIds.length
        ? await workspaceRepo.getAllMembersByPublicIds(
            ctx.db,
            memberPublicIds,
            list.workspaceId,
          )
        : [];

      if (members.length !== memberPublicIds.length)
        throw new TRPCError({
          message: `Members with public IDs (${memberPublicIds.join(", ")}) not found`,
          code: "NOT_FOUND",
        });

      const newCard = await cardRepo
        .create(ctx.db, {
          title: input.title,
          description: input.description,
          createdBy: userId,
          listId: list.id,
          workspaceId: list.workspaceId,
          position: input.position,
          dueDate: input.dueDate ?? null,
          priority: input.priority,
          colourCode: input.colourCode,
          labelIds: labels.map((label) => label.id),
          workspaceMemberIds: members.map((member) => member.id),
        })
        .catch(rethrowWorkspaceChanged);

      const newCardId = newCard.id;

      if (!newCardId)
        throw new TRPCError({
          message: `Failed to create card`,
          code: "INTERNAL_SERVER_ERROR",
        });

      if (input.description) {
        sendMentionEmails({
          db: ctx.db,
          cardPublicId: newCard.publicId,
          commentHtml: input.description,
          commenterUserId: userId,
        }).catch((error) => {
          console.error("Failed to send mention emails:", error);
        });
      }

      if (input.priority === "urgent") {
        await runUrgentAlertBestEffort(
          () =>
            notificationRepo.createUrgentAlertsForAssignees(ctx.db, {
              cardId: newCard.id,
              actorUserId: userId,
            }),
          { cardPublicId: newCard.publicId, trigger: "create" },
        );
      }

      // Fire webhooks (non-blocking)
      sendWebhooksForWorkspace(
        ctx.db,
        list.workspaceId,
        createCardWebhookPayload(
          "card.created",
          {
            publicId: newCard.publicId,
            title: input.title,
            description: input.description,
            dueDate: input.dueDate ?? null,
            priority: newCard.priority,
            colourCode: newCard.colourCode,
            startedAt: newCard.startedAt,
            completedAt: newCard.completedAt,
            listId: list.publicId,
          },
          {
            boardId: list.boardPublicId,
            boardName: list.boardName,
            listName: list.name,
            user: ctx.user
              ? { id: ctx.user.id, name: ctx.user.name }
              : undefined,
          },
        ),
      ).catch((error) => {
        console.error("Webhook delivery failed:", error);
      });

      return newCard;
    }),
  addComment: protectedProcedure
    .meta({
      openapi: {
        summary: "Add a comment to a card",
        method: "POST",
        path: "/cards/{cardPublicId}/comments",
        description: "Adds a comment to a card",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        comment: z.string().min(1),
      }),
    )
    .output(commentResponseSchema)
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

      await assertPermission(
        ctx.db,
        userId,
        card.workspaceId,
        "comment:create",
      );

      const newComment = await cardCommentRepo
        .create(ctx.db, {
          comment: input.comment,
          createdBy: userId,
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
        })
        .catch(rethrowWorkspaceChanged);

      if (!newComment?.id)
        throw new TRPCError({
          message: `Failed to create comment`,
          code: "INTERNAL_SERVER_ERROR",
        });

      sendMentionEmails({
        db: ctx.db,
        cardPublicId: input.cardPublicId,
        commentHtml: input.comment,
        commenterUserId: userId,
        commentId: newComment.id,
      }).catch((error) => {
        console.error("Failed to send mention emails:", error);
      });

      return newComment;
    }),
  updateComment: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a comment",
        method: "PUT",
        path: "/cards/{cardPublicId}/comments/{commentPublicId}",
        description: "Updates a comment",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        commentPublicId: z.string().min(12),
        comment: z.string().min(1),
      }),
    )
    .output(commentResponseSchema)
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

      const existingComment = await cardCommentRepo.getByPublicId(
        ctx.db,
        input.commentPublicId,
      );

      if (!existingComment || existingComment.cardId !== card.id)
        throw new TRPCError({
          message: `Comment with public ID ${input.commentPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertCanEdit(
        ctx.db,
        userId,
        card.workspaceId,
        "comment:edit",
        existingComment.createdBy,
      );

      const updatedComment = await cardCommentRepo
        .update(ctx.db, {
          id: existingComment.id,
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          comment: input.comment,
          updatedBy: userId,
        })
        .catch(rethrowWorkspaceChanged);

      sendMentionEmails({
        db: ctx.db,
        cardPublicId: input.cardPublicId,
        commentHtml: input.comment,
        commenterUserId: userId,
        commentId: updatedComment.id,
      }).catch((error) => {
        console.error("Failed to send mention emails:", error);
      });

      return updatedComment;
    }),
  deleteComment: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a comment",
        method: "DELETE",
        path: "/cards/{cardPublicId}/comments/{commentPublicId}",
        description: "Deletes a comment",
        tags: ["Cards"],
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        commentPublicId: z.string().min(12),
      }),
    )
    .output(commentDeleteResponseSchema)
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

      const existingComment = await cardCommentRepo.getByPublicId(
        ctx.db,
        input.commentPublicId,
      );

      if (!existingComment || existingComment.cardId !== card.id)
        throw new TRPCError({
          message: `Comment with public ID ${input.commentPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertCanDelete(
        ctx.db,
        userId,
        card.workspaceId,
        "comment:delete",
        existingComment.createdBy,
      );

      await cardCommentRepo
        .softDelete(ctx.db, {
          commentId: existingComment.id,
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          deletedAt: new Date(),
          deletedBy: userId,
        })
        .catch(rethrowWorkspaceChanged);

      return { publicId: input.commentPublicId };
    }),
  addOrRemoveLabel: protectedProcedure
    .meta({
      openapi: {
        summary: "Add or remove a label from a card",
        method: "PUT",
        path: "/cards/{cardPublicId}/labels/{labelPublicId}",
        description: "Adds or removes a label from a card",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        labelPublicId: z.string().min(12),
      }),
    )
    .output(z.object({ newLabel: z.boolean() }))
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

      const label = await labelRepo.getByPublicIdForBoard(
        ctx.db,
        input.labelPublicId,
        card.boardId,
      );

      if (!label)
        throw new TRPCError({
          message: `Label with public ID ${input.labelPublicId} not found`,
          code: "NOT_FOUND",
        });

      return cardAssociationsRepo
        .toggleCardLabel(ctx.db, {
          cardId: card.id,
          labelId: label.id,
          expectedWorkspaceId: card.workspaceId,
          updatedBy: userId,
        })
        .catch(rethrowWorkspaceChanged);
    }),
  addOrRemoveMember: protectedProcedure
    .meta({
      openapi: {
        summary: "Add or remove a member from a card",
        method: "PUT",
        path: "/cards/{cardPublicId}/members/{workspaceMemberPublicId}",
        description: "Adds or removes a member from a card",
        tags: ["Cards"],
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        workspaceMemberPublicId: z.string().min(12),
      }),
    )
    .output(z.object({ newMember: z.boolean() }))
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

      const member = await workspaceRepo.getMemberByPublicId(
        ctx.db,
        input.workspaceMemberPublicId,
        card.workspaceId,
      );

      if (!member)
        throw new TRPCError({
          message: `Member with public ID ${input.workspaceMemberPublicId} not found`,
          code: "NOT_FOUND",
        });

      const result = await cardAssociationsRepo
        .toggleCardMember(ctx.db, {
          cardId: card.id,
          workspaceMemberId: member.id,
          expectedWorkspaceId: card.workspaceId,
          updatedBy: userId,
        })
        .catch(rethrowWorkspaceChanged);

      if (result.newMember) {
        await runUrgentAlertBestEffort(
          () =>
            notificationRepo.createUrgentAlertForAssignedMember(ctx.db, {
              cardId: card.id,
              workspaceMemberId: member.id,
            }),
          { cardPublicId: input.cardPublicId, trigger: "assignment" },
        );
      }

      return result;
    }),
  byId: publicProcedure
    .meta({
      openapi: {
        summary: "Get a card by public ID",
        method: "GET",
        path: "/cards/{cardPublicId}",
        description: "Retrieves a card by its public ID",
        tags: ["Cards"],
      },
    })
    .input(z.object({ cardPublicId: z.string().min(12) }))
    .output(cardDetailSchema)
    .query(async ({ ctx, input }) => {
      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });

      const requirePublic = card.workspaceVisibility === "public";

      if (!requirePublic) {
        const userId = ctx.user?.id;

        if (!userId)
          throw new TRPCError({
            message: `User not authenticated`,
            code: "UNAUTHORIZED",
          });

        await assertPermission(ctx.db, userId, card.workspaceId, "card:view");
      }

      const {
        card: result,
        subtaskSummary,
        resourceSummary,
        hasCanvas,
      } = await cardReadRepo
        .getDetailSnapshot(ctx.db, {
          cardPublicId: input.cardPublicId,
          expectedWorkspaceId: card.workspaceId,
          requirePublic,
        })
        .catch(rethrowWorkspaceChanged);

      // Generate presigned URLs for workspace member avatars
      const workspaceWithAvatarUrls = {
        ...result.list.board.workspace,
        members: await Promise.all(
          result.list.board.workspace.members.map(async (member) => {
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

      return {
        ...result,
        subtaskSummary,
        resourceSummary,
        hasCanvas,
        list: {
          ...result.list,
          board: {
            ...result.list.board,
            workspace: workspaceWithAvatarUrls,
          },
        },
      };
    }),
  getActivities: publicProcedure
    .meta({
      openapi: {
        summary: "Get paginated card activities",
        method: "GET",
        path: "/cards/{cardPublicId}/activities",
        description:
          "Retrieves paginated activities for a card with merged frequent changes",
        tags: ["Cards"],
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        limit: z.number().min(1).max(100).optional().default(10),
        cursor: z.string().datetime().optional(), // ISO datetime string
      }),
    )
    .output(
      z.object({
        activities: z.array(activityItemSchema),
        hasMore: z.boolean(),
        nextCursor: z.string().datetime().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });

      const requirePublic = card.workspaceVisibility === "public";

      if (!requirePublic) {
        const userId = ctx.user?.id;

        if (!userId)
          throw new TRPCError({
            message: `User not authenticated`,
            code: "UNAUTHORIZED",
          });

        await assertPermission(ctx.db, userId, card.workspaceId, "card:view");
      }

      const cursor = input.cursor ? new Date(input.cursor) : undefined;
      const result = await cardActivityRepo
        .getPaginatedActivitiesGuarded(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          requirePublic,
          limit: input.limit,
          cursor,
        })
        .catch(rethrowWorkspaceChanged);

      // Generate presigned URLs for user avatars in activities
      const activitiesWithAvatarUrls = await Promise.all(
        result.activities.map(async (activity) => {
          const updatedActivity = { ...activity };

          // Generate presigned URL for activity user avatar
          if (activity.user?.image) {
            const userAvatarUrl = await generateAvatarUrl(activity.user.image);
            updatedActivity.user = {
              ...activity.user,
              image: userAvatarUrl,
            };
          }

          // Generate presigned URL for member user avatar (if exists)
          if (activity.member?.user?.image) {
            const memberAvatarUrl = await generateAvatarUrl(
              activity.member.user.image,
            );
            updatedActivity.member = {
              ...activity.member,
              user: {
                ...activity.member.user,
                image: memberAvatarUrl,
              },
            };
          }

          return updatedActivity;
        }),
      );

      const mergedActivities = mergeActivities(activitiesWithAvatarUrls);

      return {
        activities: mergedActivities,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor?.toISOString() ?? null,
      };
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a card",
        method: "PUT",
        path: "/cards/{cardPublicId}",
        description: "Updates a card by its public ID",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        title: z.string().min(1).max(2000).optional(),
        description: z.string().optional(),
        index: z.number().optional(),
        listPublicId: z.string().min(12).optional(),
        dueDate: z.date().nullable().optional(),
        priority: z.enum(cardPriorities).optional(),
        colourCode: colourCodeSchema.optional(),
        confirmOpenSubtasks: z.boolean().optional(),
        publicVisibilityAcknowledged: z.boolean().optional().default(false),
      }),
    )
    .output(cardUpdateResponseSchema)
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

      await assertCanEdit(
        ctx.db,
        userId,
        card.workspaceId,
        "card:edit",
        card.createdBy,
      );

      const existingCard = await cardRepo.getByPublicId(
        ctx.db,
        input.cardPublicId,
      );

      let newListId: number | undefined;
      let newList:
        | NonNullable<
            Awaited<
              ReturnType<typeof listRepo.getWorkspaceAndListIdByListPublicId>
            >
          >
        | undefined;

      if (input.listPublicId) {
        const destinationList =
          await listRepo.getWorkspaceAndListIdByListPublicId(
            ctx.db,
            input.listPublicId,
          );

        if (!destinationList)
          throw new TRPCError({
            message: `List with public ID ${input.listPublicId} not found`,
            code: "NOT_FOUND",
          });

        if (destinationList.workspaceId !== card.workspaceId)
          throw new TRPCError({
            message: `Cards can only be moved within the same workspace`,
            code: "BAD_REQUEST",
          });

        newList = destinationList;
        newListId = newList.id;
      }

      if (!existingCard) {
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });
      }

      let result:
        | {
            id: number;
            title: string;
            description: string | null;
            publicId: string;
            dueDate: Date | null;
            priority: (typeof cardPriorities)[number];
            colourCode: string | null;
            startedAt: Date | null;
            completedAt: Date | null;
          }
        | undefined;

      const previousDueDate = existingCard.dueDate;
      const movedToNewBoard = Boolean(
        newList && newList.boardPublicId !== card.boardPublicId,
      );
      const scalarUpdates = {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.colourCode !== undefined && {
          colourCode: input.colourCode,
        }),
      };
      const hasScalarUpdates = Object.keys(scalarUpdates).length > 0;
      const titleChanged =
        input.title !== undefined && existingCard.title !== input.title;
      const descriptionChanged =
        input.description !== undefined &&
        existingCard.description !== input.description;
      const priorityChanged =
        input.priority !== undefined &&
        existingCard.priority !== input.priority;
      const colourChanged =
        input.colourCode !== undefined &&
        existingCard.colourCode !== input.colourCode;
      const dueDateChanged =
        input.dueDate !== undefined &&
        previousDueDate?.getTime() !== input.dueDate?.getTime();
      const movedToNewList =
        newListId !== undefined && existingCard.listId !== newListId;
      const activities: CardMutationActivityInput[] = [];

      if (titleChanged) {
        activities.push({
          type: "card.updated.title",
          createdBy: userId,
          fromTitle: existingCard.title,
          toTitle: input.title,
        });
      }

      if (descriptionChanged && input.description !== undefined) {
        activities.push({
          type: "card.updated.description",
          createdBy: userId,
          fromDescription: existingCard.description ?? undefined,
          toDescription: input.description,
        });
      }

      if (priorityChanged) {
        activities.push({
          type: "card.updated.priority",
          createdBy: userId,
          fromPriority: existingCard.priority,
          toPriority: input.priority,
        });
      }

      if (colourChanged) {
        activities.push({
          type: "card.updated.colourCode",
          createdBy: userId,
          fromColourCode: existingCard.colourCode ?? undefined,
          toColourCode: input.colourCode ?? undefined,
        });
      }

      if (dueDateChanged) {
        const activityType = !previousDueDate
          ? "card.updated.dueDate.added"
          : !input.dueDate
            ? "card.updated.dueDate.removed"
            : "card.updated.dueDate.updated";
        activities.push({
          type: activityType,
          createdBy: userId,
          fromDueDate: previousDueDate ?? undefined,
          toDueDate: input.dueDate ?? undefined,
        });
      }

      if (movedToNewList) {
        activities.push({
          type: "card.updated.list",
          createdBy: userId,
          fromListId: existingCard.listId,
          toListId: newListId,
        });
      }

      if (movedToNewBoard) {
        activities.push(
          ...existingCard.labels.map(({ labelId }) => ({
            type: "card.updated.label.removed" as const,
            createdBy: userId,
            labelId,
          })),
        );
      }

      if (input.index !== undefined || newListId !== undefined) {
        try {
          result = await cardRepo.reorder(ctx.db, {
            cardId: existingCard.id,
            newIndex: input.index,
            newListId,
            expectedWorkspaceId: card.workspaceId,
            clearLabels: movedToNewBoard,
            confirmOpenSubtasks: input.confirmOpenSubtasks,
            publicVisibilityAcknowledged: input.publicVisibilityAcknowledged,
            ...(hasScalarUpdates && { updates: scalarUpdates }),
            activities,
          });
        } catch (error) {
          rethrowCardMutationError(error);
        }
      } else if (hasScalarUpdates) {
        result = await cardRepo
          .update(ctx.db, scalarUpdates, {
            cardPublicId: input.cardPublicId,
            expectedWorkspaceId: card.workspaceId,
            activities,
          })
          .catch(rethrowWorkspaceChanged);
      }

      if (!result)
        throw new TRPCError({
          message: `Failed to update card`,
          code: "INTERNAL_SERVER_ERROR",
        });

      if (descriptionChanged && input.description !== undefined) {
        sendMentionEmails({
          db: ctx.db,
          cardPublicId: input.cardPublicId,
          commentHtml: input.description,
          commenterUserId: userId,
        }).catch((error) => {
          console.error("Failed to send mention emails:", error);
        });
      }

      if (priorityChanged) {
        if (input.priority === "urgent") {
          await runUrgentAlertBestEffort(
            () =>
              notificationRepo.createUrgentAlertsForAssignees(ctx.db, {
                cardId: result.id,
                actorUserId: userId,
              }),
            { cardPublicId: input.cardPublicId, trigger: "priority" },
          );
        }
      }

      // Build changes object for webhook
      const webhookChanges: Record<string, { from: unknown; to: unknown }> = {};
      if (input.title && existingCard.title !== input.title) {
        webhookChanges.title = { from: existingCard.title, to: input.title };
      }
      if (
        input.description !== undefined &&
        existingCard.description !== input.description
      ) {
        webhookChanges.description = {
          from: existingCard.description,
          to: input.description,
        };
      }
      if (
        input.priority !== undefined &&
        existingCard.priority !== input.priority
      ) {
        webhookChanges.priority = {
          from: existingCard.priority,
          to: input.priority,
        };
      }
      if (
        input.colourCode !== undefined &&
        existingCard.colourCode !== input.colourCode
      ) {
        webhookChanges.colourCode = {
          from: existingCard.colourCode,
          to: input.colourCode,
        };
      }
      if (
        input.dueDate !== undefined &&
        previousDueDate?.getTime() !== input.dueDate?.getTime()
      ) {
        webhookChanges.dueDate = { from: previousDueDate, to: input.dueDate };
      }
      const currentWebhookListPublicId =
        newList?.publicId ?? existingCard.list.publicId;
      const currentWebhookListName = newList?.name ?? existingCard.list.name;

      if (movedToNewList && newList) {
        webhookChanges.listId = {
          from: existingCard.list.publicId,
          to: newList.publicId,
        };
      }

      // Fire webhooks (non-blocking)
      sendWebhooksForWorkspace(
        ctx.db,
        card.workspaceId,
        createCardWebhookPayload(
          movedToNewList ? "card.moved" : "card.updated",
          {
            publicId: result.publicId,
            title: result.title,
            description: result.description,
            dueDate: result.dueDate,
            priority: result.priority,
            colourCode: result.colourCode,
            startedAt: result.startedAt,
            completedAt: result.completedAt,
            listId: currentWebhookListPublicId,
          },
          {
            boardId:
              movedToNewBoard && newList
                ? newList.boardPublicId
                : card.boardPublicId,
            boardName:
              movedToNewBoard && newList ? newList.boardName : card.boardName,
            listName: currentWebhookListName,
            user: ctx.user
              ? { id: ctx.user.id, name: ctx.user.name }
              : undefined,
            changes:
              Object.keys(webhookChanges).length > 0
                ? webhookChanges
                : undefined,
          },
        ),
      ).catch((error) => {
        console.error("Webhook delivery failed:", error);
      });

      return result;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a card",
        method: "DELETE",
        path: "/cards/{cardPublicId}",
        description: "Deletes a card by its public ID",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
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

      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertCanDelete(
        ctx.db,
        userId,
        card.workspaceId,
        "card:delete",
        card.createdBy,
      );

      // Fetch full card data before delete for webhook
      const fullCard = await cardRepo.getByPublicId(ctx.db, input.cardPublicId);

      const deletedAt = new Date();

      await cardRepo
        .softDelete(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          deletedAt,
          deletedBy: userId,
        })
        .catch(rethrowWorkspaceChanged);

      // Fire webhooks (non-blocking)
      if (fullCard) {
        sendWebhooksForWorkspace(
          ctx.db,
          card.workspaceId,
          createCardWebhookPayload(
            "card.deleted",
            {
              publicId: fullCard.publicId,
              title: fullCard.title,
              description: fullCard.description,
              dueDate: fullCard.dueDate,
              priority: fullCard.priority,
              colourCode: fullCard.colourCode,
              startedAt: fullCard.startedAt,
              completedAt: fullCard.completedAt,
              listId: fullCard.list.publicId,
            },
            {
              boardId: card.boardPublicId,
              boardName: card.boardName,
              listName: fullCard.list.name,
              user: ctx.user
                ? { id: ctx.user.id, name: ctx.user.name }
                : undefined,
            },
          ),
        ).catch((error) => {
          console.error("Webhook delivery failed:", error);
        });
      }

      return { success: true };
    }),
  duplicate: protectedProcedure
    .meta({
      openapi: {
        summary: "Duplicate a card",
        method: "POST",
        path: "/cards/{cardPublicId}/duplicate",
        description: "Duplicates a card to a target list with optional options",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().min(12),
        listPublicId: z.string().min(12),
        index: z.number().int().min(0).optional(),
        title: z.string().min(1).max(2000).optional(),
        copyLabels: z.boolean(),
        copyMembers: z.boolean(),
        copyChecklists: z.boolean(),
        copyPipeline: z.boolean().optional().default(true),
        publicVisibilityAcknowledged: z.boolean().optional().default(false),
      }),
    )
    .output(
      z.object({
        publicId: z.string(),
        skippedResourceCount: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const sourceCardMeta = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!sourceCardMeta)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });

      await assertPermission(
        ctx.db,
        userId,
        sourceCardMeta.workspaceId,
        "card:create",
      );
      await assertPermission(
        ctx.db,
        userId,
        sourceCardMeta.workspaceId,
        "card:view",
      );

      const newCard = await cardDuplicateRepo
        .duplicateCard(ctx.db, {
          sourceCardPublicId: input.cardPublicId,
          targetListPublicId: input.listPublicId,
          expectedWorkspaceId: sourceCardMeta.workspaceId,
          createdBy: userId,
          title: input.title,
          index: input.index,
          copyLabels: input.copyLabels,
          copyMembers: input.copyMembers,
          copyChecklists: input.copyChecklists,
          copyPipeline: input.copyPipeline,
          publicVisibilityAcknowledged: input.publicVisibilityAcknowledged,
        })
        .catch((error: unknown) => {
          if (error instanceof cardDuplicateRepo.CardPipelineCloneError) {
            throw new TRPCError({
              message: "CARD_PIPELINE_CLONE_FAILED",
              code: "CONFLICT",
            });
          }
          return rethrowWorkspaceChanged(error);
        });

      if (newCard.status === "public_ack_required") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
        });
      }

      if (newCard.priority === "urgent") {
        await runUrgentAlertBestEffort(
          () =>
            notificationRepo.createUrgentAlertsForAssignees(ctx.db, {
              cardId: newCard.id,
              actorUserId: userId,
            }),
          { cardPublicId: newCard.publicId, trigger: "duplicate" },
        );
      }

      return {
        publicId: newCard.publicId,
        skippedResourceCount: newCard.skippedResourceCount,
      };
    }),
});
