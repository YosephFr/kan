import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardVisualWallRepo from "@kan/db/repository/cardVisualWall.repo";
import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";
import { VisualWallError } from "@kan/db/repository/workspaceVisualWall.repo";

import {
  cardVisualWallMutationResultSchema,
  cardVisualWallSnapshotSchema,
  freeformUrlSchema,
  visualWallExpectedVersionSchema,
  visualWallPlacementSchema,
  visualWallPublicIdSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import {
  deleteCardVisualWallPreviewObjects,
  ensureCardVisualWallPreview,
  releaseUnreferencedCardVisualWallPreview,
} from "../utils/card-visual-wall-preview";
import { assertPermission, hasPermission } from "../utils/permissions";

const visibilityAcknowledgement = z.boolean().optional().default(false);

type CardMeta = NonNullable<
  Awaited<ReturnType<typeof cardRepo.getWorkspaceAndCardIdByCardPublicId>>
>;

const getCardOrThrow = async (db: dbClient, cardPublicId: string) => {
  const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
    db,
    cardPublicId,
  );
  if (!card) {
    throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
  }
  return card;
};

const getAccess = async (
  db: dbClient,
  user: { id: string } | null | undefined,
  card: CardMeta,
) => {
  const requirePublic = card.workspaceVisibility === "public";
  if (!requirePublic) {
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    await assertPermission(db, user.id, card.workspaceId, "card:view");
  }
  const editable = user
    ? await hasPermission(db, user.id, card.workspaceId, "card:edit")
    : false;
  return { requirePublic, viewModeEnabled: !editable };
};

const mapError = (error: unknown): never => {
  if (error instanceof TRPCError) throw error;
  if (error instanceof WorkspaceChangedError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
  }
  if (error instanceof WorkspacePermissionChangedError) {
    throw new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN" });
  }
  if (error instanceof VisualWallError) {
    throw new TRPCError({
      code:
        error.code === "VISUAL_WALL_ITEM_NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "VISUAL_WALL_ITEM_LIMIT_REACHED"
            ? "PAYLOAD_TOO_LARGE"
            : "BAD_REQUEST",
      message: error.code,
    });
  }
  throw error;
};

const placementFields = visualWallPlacementSchema.shape;

const assertPlacementBounds = (
  placement: z.infer<typeof visualWallPlacementSchema>,
) => {
  if (
    placement.x + placement.width > 1_200 ||
    placement.y + placement.height > 1_000_000
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "VISUAL_WALL_ITEM_OUT_OF_BOUNDS",
    });
  }
};

export const cardVisualWallRouter = createTRPCRouter({
  get: publicProcedure
    .meta({
      openapi: {
        summary: "Get a card visual wall",
        method: "GET",
        path: "/cards/{cardPublicId}/visual-wall",
        tags: ["Card visual wall"],
      },
    })
    .input(z.object({ cardPublicId: visualWallPublicIdSchema }))
    .output(cardVisualWallSnapshotSchema)
    .query(async ({ ctx, input }) => {
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      const access = await getAccess(ctx.db, ctx.user, card);
      try {
        const wall = await cardVisualWallRepo.getSnapshot(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          actorId: ctx.user?.id ?? null,
          requirePublic: access.requirePublic,
        });
        return wall
          ? {
              exists: true,
              version: wall.version,
              freeformUrl: wall.freeformUrl,
              updatedAt: wall.updatedAt,
              viewModeEnabled: access.viewModeEnabled,
              items: wall.items.map((item) => ({
                ...item,
                viewUrl: `/api/visual-wall-resources/${item.resourcePublicId}`,
              })),
            }
          : {
              exists: false,
              version: 0,
              freeformUrl: null,
              updatedAt: null,
              viewModeEnabled: access.viewModeEnabled,
              items: [],
            };
      } catch (error) {
        return mapError(error);
      }
    }),

  addResource: protectedProcedure
    .meta({
      openapi: {
        summary: "Add an image resource to a card visual wall",
        method: "POST",
        path: "/cards/{cardPublicId}/visual-wall/resources",
        tags: ["Card visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: visualWallPublicIdSchema,
        resourcePublicId: visualWallPublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
        publicVisibilityAcknowledged: visibilityAcknowledgement,
        ...placementFields,
      }),
    )
    .output(cardVisualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      assertPlacementBounds(input);
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");
      if (
        card.workspaceVisibility === "public" &&
        !input.publicVisibilityAcknowledged
      ) {
        return { status: "public_ack_required" as const };
      }
      let createdPreviewS3Key: string | null = null;
      try {
        const preflight = await cardVisualWallRepo.getExpectedVersionStatus(
          ctx.db,
          {
            cardId: card.id,
            expectedWorkspaceId: card.workspaceId,
            expectedVersion: input.expectedVersion,
            actorId: userId,
          },
        );
        if (preflight.status === "conflict") return preflight;
        const preview = await ensureCardVisualWallPreview(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          actorId: userId,
          resourcePublicId: input.resourcePublicId,
        });
        if (preview.status === "created") {
          createdPreviewS3Key = preview.s3Key;
        }
        const result = await cardVisualWallRepo.addResource(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          expectedVersion: input.expectedVersion,
          actorId: userId,
          resourcePublicId: input.resourcePublicId,
          placement: {
            x: input.x,
            y: input.y,
            width: input.width,
            height: input.height,
            zIndex: input.zIndex,
          },
          publicVisibilityAcknowledged: input.publicVisibilityAcknowledged,
        });
        if (result.status !== "saved" && createdPreviewS3Key) {
          await releaseUnreferencedCardVisualWallPreview(ctx.db, {
            cardId: card.id,
            expectedWorkspaceId: card.workspaceId,
            resourcePublicId: input.resourcePublicId,
            previewS3Key: createdPreviewS3Key,
          }).catch(() => undefined);
        }
        return result;
      } catch (error) {
        if (createdPreviewS3Key) {
          await releaseUnreferencedCardVisualWallPreview(ctx.db, {
            cardId: card.id,
            expectedWorkspaceId: card.workspaceId,
            resourcePublicId: input.resourcePublicId,
            previewS3Key: createdPreviewS3Key,
          }).catch(() => undefined);
        }
        return mapError(error);
      }
    }),

  updateItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a card visual wall item",
        method: "PATCH",
        path: "/cards/{cardPublicId}/visual-wall/items/{itemPublicId}",
        tags: ["Card visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: visualWallPublicIdSchema,
        itemPublicId: visualWallPublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
        ...placementFields,
      }),
    )
    .output(cardVisualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      assertPlacementBounds(input);
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");
      try {
        return await cardVisualWallRepo.updateItem(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          expectedVersion: input.expectedVersion,
          actorId: userId,
          itemPublicId: input.itemPublicId,
          placement: {
            x: input.x,
            y: input.y,
            width: input.width,
            height: input.height,
            zIndex: input.zIndex,
          },
        });
      } catch (error) {
        return mapError(error);
      }
    }),

  removeItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Remove a card visual wall item",
        method: "DELETE",
        path: "/cards/{cardPublicId}/visual-wall/items/{itemPublicId}",
        tags: ["Card visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: visualWallPublicIdSchema,
        itemPublicId: visualWallPublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
      }),
    )
    .output(cardVisualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");
      try {
        const result = await cardVisualWallRepo.removeItem(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          expectedVersion: input.expectedVersion,
          actorId: userId,
          itemPublicId: input.itemPublicId,
        });
        if ("reclaimedS3Keys" in result) {
          await deleteCardVisualWallPreviewObjects(
            ctx.db,
            result.reclaimedS3Keys,
          );
        }
        return result;
      } catch (error) {
        return mapError(error);
      }
    }),

  setFreeformLink: protectedProcedure
    .meta({
      openapi: {
        summary: "Set the card Freeform link",
        method: "PUT",
        path: "/cards/{cardPublicId}/visual-wall/freeform",
        tags: ["Card visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: visualWallPublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
        freeformUrl: freeformUrlSchema.nullable(),
        publicVisibilityAcknowledged: visibilityAcknowledgement,
      }),
    )
    .output(cardVisualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const card = await getCardOrThrow(ctx.db, input.cardPublicId);
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");
      try {
        return await cardVisualWallRepo.setFreeformLink(ctx.db, {
          cardId: card.id,
          expectedWorkspaceId: card.workspaceId,
          expectedVersion: input.expectedVersion,
          actorId: userId,
          freeformUrl: input.freeformUrl,
          publicVisibilityAcknowledged: input.publicVisibilityAcknowledged,
        });
      } catch (error) {
        return mapError(error);
      }
    }),
});
