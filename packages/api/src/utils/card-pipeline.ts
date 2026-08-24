import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardPipelineRepo from "@kan/db/repository/cardPipeline.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import {
  generateAvatarUrl,
  isInlineAttachmentContentType,
} from "@kan/shared/utils";

import type { User } from "../trpc";
import { buildDriveUrls } from "./card-resource-drive";
import { normalizeWebResourceOpenUrl } from "./card-resource-web";
import { assertPermission } from "./permissions";

interface CardAccessContext {
  db: dbClient;
  user: User | null | undefined;
}

export async function getCardMetaOrThrow(
  ctx: CardAccessContext,
  cardPublicId: string,
) {
  const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
    ctx.db,
    cardPublicId,
  );
  if (!card) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
  }
  return { ...card, publicId: cardPublicId };
}

export async function assertCardPipelineReadable(
  ctx: CardAccessContext,
  card: Awaited<ReturnType<typeof getCardMetaOrThrow>>,
) {
  if (card.workspaceVisibility === "public") return true;
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  await assertPermission(ctx.db, ctx.user.id, card.workspaceId, "card:view");
  return false;
}

export async function assertCardPipelineEditable(
  ctx: CardAccessContext,
  card: Awaited<ReturnType<typeof getCardMetaOrThrow>>,
) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  await assertPermission(ctx.db, ctx.user.id, card.workspaceId, "card:edit");
}

export async function loadCardPipeline(
  ctx: Pick<CardAccessContext, "db">,
  card: { workspaceId: number; publicId: string },
  requirePublic = false,
) {
  const { pipeline, summary } = await cardPipelineRepo
    .getByCardPublicIdGuarded(ctx.db, {
      cardPublicId: card.publicId,
      expectedWorkspaceId: card.workspaceId,
      requirePublic,
    })
    .catch((error: unknown) => {
      if (error instanceof WorkspaceChangedError) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      throw error;
    });
  if (pipeline.status === "invalid_state") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "CARD_PIPELINE_INVALID_STATE",
    });
  }

  const avatarKeys = [
    ...new Set(
      pipeline.stages.flatMap((stage) =>
        stage.subtasks.flatMap((subtask) =>
          subtask.owner?.image ? [subtask.owner.image] : [],
        ),
      ),
    ),
  ];
  const avatarUrls = new Map(
    await Promise.all(
      avatarKeys.map(
        async (key) => [key, await generateAvatarUrl(key)] as const,
      ),
    ),
  );

  return {
    initialized: pipeline.initialized,
    stages: pipeline.stages.map((stage) => ({
      publicId: stage.publicId,
      status: stage.status,
      name: stage.name,
      colourCode: stage.colourCode,
      index: stage.index,
      subtasks: stage.subtasks.map((subtask) => ({
        publicId: subtask.publicId,
        title: subtask.title,
        description: subtask.description,
        priority: subtask.priority,
        dueDate: subtask.dueDate,
        startedAt: subtask.startedAt,
        completedAt: subtask.completedAt,
        index: subtask.index,
        stagePublicId: stage.publicId,
        owner: subtask.owner
          ? {
              publicId: subtask.owner.publicId,
              name: subtask.owner.name,
              image: subtask.owner.image
                ? (avatarUrls.get(subtask.owner.image) ?? null)
                : null,
            }
          : null,
        checklistItems: subtask.checklistItems.map((item) => ({
          publicId: item.publicId,
          title: item.title,
          completed: item.completed,
          index: item.index,
        })),
        canvasFrame: subtask.canvasFrame ?? null,
        resources: subtask.resources.map((resource) => {
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
              publicId: resource.publicId,
              kind: "drive" as const,
              title: resource.title,
              driveType: resource.driveType,
              ...urls,
            };
          }
          if (resource.kind === "web") {
            const openUrl = resource.webUrl
              ? normalizeWebResourceOpenUrl(resource.webUrl)
              : null;
            if (!openUrl) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            }
            return {
              publicId: resource.publicId,
              kind: "web" as const,
              title: resource.title,
              openUrl,
              description: resource.webDescription,
              siteName: resource.webSiteName,
              previewImageUrl: resource.webImageUrl
                ? `/api/resources/${resource.publicId}/preview-image`
                : null,
            };
          }
          if (
            !resource.attachmentPublicId ||
            !resource.originalFilename ||
            !resource.contentType ||
            resource.size === null
          ) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          }
          return {
            publicId: resource.publicId,
            kind: "upload" as const,
            title: resource.title,
            originalFilename: resource.originalFilename,
            contentType: resource.contentType,
            size: resource.size,
            viewUrl: isInlineAttachmentContentType(resource.contentType)
              ? `/api/attachments/${resource.attachmentPublicId}/view`
              : null,
            downloadUrl: `/api/attachments/${resource.attachmentPublicId}/download`,
          };
        }),
      })),
    })),
    summary,
  };
}

export function findPipelineSubtask(
  pipeline: Awaited<ReturnType<typeof loadCardPipeline>>,
  subtaskPublicId: string,
) {
  for (const stage of pipeline.stages) {
    const subtask = stage.subtasks.find(
      (candidate) => candidate.publicId === subtaskPublicId,
    );
    if (subtask) return { subtask, stage };
  }
  throw new TRPCError({ code: "NOT_FOUND", message: "Subtask not found" });
}
