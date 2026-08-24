import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import {
  isInlineAttachmentContentType,
  MAX_ATTACHMENT_SIZE,
} from "@kan/shared/utils";

import { cardResourceListSchema, cardResourceSchema } from "../schemas";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { deleteCardResource } from "../utils/card-resource-delete";
import {
  buildDriveUrls,
  driveFallbackTitle,
  normalizeDriveLink,
} from "../utils/card-resource-drive";
import { normalizeWebResourceOpenUrl } from "../utils/card-resource-web";
import { assertPermission } from "../utils/permissions";
import { attachmentRouter } from "./attachment";

const publicId = z.string().regex(/^[a-z0-9]{12}$/);
const visibilityAcknowledgement = z.boolean().optional().default(false);
const safeRestConfirmation = z
  .literal("true")
  .optional()
  .transform((value) => value === "true");
const safeRestCanvasVersion = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .refine((value) => Number(value) <= 2_147_483_647)
  .optional()
  .transform((value) => (value === undefined ? undefined : Number(value)));

function mapResource(
  resource: Awaited<ReturnType<typeof cardResourceRepo.listByCardId>>[number],
) {
  if (resource.kind === "upload") {
    if (
      resource.contentType === null ||
      resource.originalFilename === null ||
      resource.size === null
    ) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    }
    return {
      kind: "upload" as const,
      publicId: resource.publicId,
      title: resource.title,
      contentType: resource.contentType,
      originalFilename: resource.originalFilename,
      size: resource.size,
      viewUrl: isInlineAttachmentContentType(resource.contentType)
        ? `/api/attachments/${resource.publicId}/view`
        : null,
      downloadUrl: `/api/attachments/${resource.publicId}/download`,
      createdAt: resource.createdAt,
    };
  }
  if (resource.kind === "drive") {
    if (!resource.driveType || !resource.driveFileId) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    }
    const urls = buildDriveUrls({
      driveType: resource.driveType,
      driveFileId: resource.driveFileId,
      resourceKey: resource.resourceKey,
    });
    return {
      kind: "drive" as const,
      publicId: resource.publicId,
      title: resource.title,
      driveType: resource.driveType,
      openUrl: urls.openUrl,
      previewUrl: urls.previewUrl,
      createdAt: resource.createdAt,
    };
  }
  const openUrl = resource.webUrl
    ? normalizeWebResourceOpenUrl(resource.webUrl)
    : null;
  if (!openUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }
  return {
    kind: "web" as const,
    publicId: resource.publicId,
    title: resource.title,
    openUrl,
    description: resource.webDescription,
    siteName: resource.webSiteName,
    previewImageUrl: null,
    createdAt: resource.createdAt,
  };
}

async function getCardOrThrow(
  db: Parameters<typeof cardRepo.getWorkspaceAndCardIdByCardPublicId>[0],
  cardPublicId: string,
) {
  const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
    db,
    cardPublicId,
  );
  if (!card)
    throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
  return card;
}

export const cardResourceRouter = createTRPCRouter({
  list: publicProcedure
    .meta({
      openapi: {
        summary: "List card resources",
        method: "GET",
        path: "/cards/{cardPublicId}/resources",
        tags: ["Card resources"],
      },
    })
    .input(z.object({ cardPublicId: publicId }))
    .output(cardResourceListSchema)
    .query(async ({ ctx, input }) => {
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      const requirePublic = card.workspaceVisibility === "public";
      if (!requirePublic) {
        const userId = ctx.user?.id;
        if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        await assertPermission(ctx.db, userId, card.workspaceId, "card:view");
      }
      try {
        const snapshot = await cardResourceRepo.getListSnapshot(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          requirePublic,
        });
        return {
          resources: snapshot.resources.map(mapResource),
          summary: snapshot.summary,
        };
      } catch (error) {
        if (error instanceof WorkspaceChangedError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
        }
        throw error;
      }
    }),

  createUpload: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a card resource upload session",
        method: "POST",
        path: "/cards/{cardPublicId}/resources/upload",
        tags: ["Card resources"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicId,
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1).max(100),
        size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
        sha256: z.string().length(64),
        publicVisibilityAcknowledged: visibilityAcknowledgement,
      }),
    )
    .output(
      z.object({
        url: z.string(),
        uploadSessionPublicId: publicId,
        expiresAt: z.date(),
      }),
    )
    .mutation(({ ctx, input }) =>
      attachmentRouter.createCaller(ctx).generateUploadUrl(input),
    ),

  confirmUpload: protectedProcedure
    .meta({
      openapi: {
        summary: "Confirm a card resource upload",
        method: "POST",
        path: "/cards/{cardPublicId}/resources/upload/confirm",
        tags: ["Card resources"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicId,
        uploadSessionPublicId: publicId,
        publicVisibilityAcknowledged: visibilityAcknowledgement,
      }),
    )
    .output(cardResourceSchema)
    .mutation(async ({ ctx, input }) => {
      const attachment = await attachmentRouter
        .createCaller(ctx)
        .confirm(input);
      return {
        kind: "upload" as const,
        publicId: attachment.publicId,
        title: attachment.originalFilename,
        originalFilename: attachment.originalFilename,
        contentType: attachment.contentType,
        size: attachment.size,
        viewUrl: isInlineAttachmentContentType(attachment.contentType)
          ? `/api/attachments/${attachment.publicId}/view`
          : null,
        downloadUrl: `/api/attachments/${attachment.publicId}/download`,
        createdAt: attachment.createdAt,
      };
    }),

  createDriveLink: protectedProcedure
    .meta({
      openapi: {
        summary: "Add a Google Drive resource",
        method: "POST",
        path: "/cards/{cardPublicId}/resources/drive",
        tags: ["Card resources"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicId,
        url: z.string().min(1).max(2048),
        title: z.string().trim().min(1).max(255).optional(),
        publicVisibilityAcknowledged: visibilityAcknowledgement,
      }),
    )
    .output(cardResourceSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");
      const drive = normalizeDriveLink(input.url);
      const result = await cardResourceRepo.createDrive(ctx.db, {
        cardId: card.id,
        expectedWorkspaceId: card.workspaceId,
        title: input.title ?? driveFallbackTitle(drive.driveType),
        driveType: drive.driveType,
        driveFileId: drive.driveFileId,
        resourceKey: drive.resourceKey,
        createdBy: userId,
        publicVisibilityAcknowledged: input.publicVisibilityAcknowledged,
      });
      if (result.status === "public_ack_required") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
        });
      }
      const snapshot = await cardResourceRepo.getListSnapshot(ctx.db, {
        cardId: card.id,
        expectedWorkspaceId: card.workspaceId,
        requirePublic: false,
      });
      const created = snapshot.resources.find(
        (resource) => resource.publicId === result.publicId,
      );
      if (!created) throw new TRPCError({ code: "CONFLICT" });
      return mapResource(created);
    }),

  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a card resource",
        method: "DELETE",
        path: "/resources/{resourcePublicId}",
        tags: ["Card resources"],
        protect: true,
      },
    })
    .input(
      z.object({
        resourcePublicId: publicId,
        removeReferences: safeRestConfirmation,
        canvasAction: z.enum(["replace", "remove"]).optional(),
        expectedCanvasVersion: safeRestCanvasVersion,
      }),
    )
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await deleteCardResource(ctx.db, { userId, ...input });
      return { success: true };
    }),
});
