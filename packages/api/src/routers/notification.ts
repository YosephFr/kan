import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as notificationRepo from "@kan/db/repository/notification.repo";
import { notificationTypes } from "@kan/db/schema";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const cursorSchema = z.string().length(12);

const encodeCursor = (cursor: notificationRepo.NotificationCursor) =>
  Buffer.from(cursor.publicId).toString("base64url");

const decodeCursor = (cursor: string) => {
  try {
    const parsed = cursorSchema.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    return { publicId: parsed };
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid notification cursor",
    });
  }
};

const notificationItemSchema = z.object({
  publicId: z.string().length(12),
  type: z.enum(notificationTypes),
  createdAt: z.date(),
  readAt: z.date().nullable(),
  card: z
    .object({
      publicId: z.string().length(12),
      title: z.string(),
      boardName: z.string(),
      workspacePublicId: z.string().length(12),
    })
    .nullable(),
  subtask: z
    .object({
      publicId: z.string().length(12),
      title: z.string(),
    })
    .nullable(),
});

const getUserId = (user: { id: string } | null | undefined) => {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

  return user.id;
};

export const notificationRouter = createTRPCRouter({
  syncDueAlerts: protectedProcedure
    .meta({
      openapi: {
        summary: "Synchronize due-date alerts",
        method: "POST",
        path: "/notifications/sync-due-alerts",
        description: "Creates and invalidates due-date alerts for the user",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ created: z.number(), invalidated: z.number() }))
    .mutation(async ({ ctx }) => {
      const userId = getUserId(ctx.user);
      const [cardsResult, subtasksResult] = await Promise.all([
        notificationRepo.syncDueAlerts(ctx.db, { userId }),
        notificationRepo.syncSubtaskDueAlerts(ctx.db, { userId }),
      ]);

      return {
        created: cardsResult.created + subtasksResult.created,
        invalidated: cardsResult.invalidated + subtasksResult.invalidated,
      };
    }),
  list: protectedProcedure
    .meta({
      openapi: {
        summary: "List notifications",
        method: "GET",
        path: "/notifications",
        description: "Lists notifications belonging to the current user",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(
      z.object({
        cursor: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(50).default(30),
      }),
    )
    .output(
      z.object({
        items: z.array(notificationItemSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await notificationRepo.list(ctx.db, {
        userId: getUserId(ctx.user),
        limit: input.limit,
        cursor: input.cursor ? decodeCursor(input.cursor) : undefined,
      });

      return {
        items: result.items,
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
      };
    }),
  unreadCount: protectedProcedure
    .meta({
      openapi: {
        summary: "Get unread notification count",
        method: "GET",
        path: "/notifications/unread-count",
        description: "Returns the current user's unread notification count",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ count: z.number() }))
    .query(async ({ ctx }) => ({
      count: await notificationRepo.getUnreadCount(ctx.db, getUserId(ctx.user)),
    })),
  markRead: protectedProcedure
    .meta({
      openapi: {
        summary: "Mark a notification as read",
        method: "POST",
        path: "/notifications/{notificationPublicId}/read",
        description: "Marks one notification owned by the current user as read",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(z.object({ notificationPublicId: z.string().length(12) }))
    .output(z.object({ publicId: z.string().length(12), readAt: z.date() }))
    .mutation(async ({ ctx, input }) => {
      const result = await notificationRepo.markAsRead(ctx.db, {
        notificationPublicId: input.notificationPublicId,
        userId: getUserId(ctx.user),
      });

      if (!result?.readAt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification not found",
        });
      }

      return { publicId: result.publicId, readAt: result.readAt };
    }),
  markAllRead: protectedProcedure
    .meta({
      openapi: {
        summary: "Mark all notifications as read",
        method: "POST",
        path: "/notifications/read-all",
        description:
          "Marks all notifications owned by the current user as read",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ count: z.number() }))
    .mutation(async ({ ctx }) => ({
      count: await notificationRepo.markAllAsRead(ctx.db, getUserId(ctx.user)),
    })),
});
