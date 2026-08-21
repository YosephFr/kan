import { and, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardAttachments,
  cardPipelineStages,
  cards,
  cardSubtaskResources,
  cardSubtasks,
  lists,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import {
  lockPipelineCardById,
  resolveSubtaskCardId,
} from "./cardPipeline.internal";

export const getResourceContextByPublicId = async (
  db: dbClient,
  resourcePublicId: string,
) => {
  const [context] = await db
    .select({
      resourceId: cardSubtaskResources.id,
      resourcePublicId: cardSubtaskResources.publicId,
      attachmentId: cardAttachments.id,
      attachmentPublicId: cardAttachments.publicId,
      subtaskId: cardSubtasks.id,
      subtaskPublicId: cardSubtasks.publicId,
      subtaskTitle: cardSubtasks.title,
      stagePublicId: cardPipelineStages.publicId,
      stageStatus: cardPipelineStages.status,
      cardId: cards.id,
      cardPublicId: cards.publicId,
      cardTitle: cards.title,
      listPublicId: lists.publicId,
      listName: lists.name,
      boardPublicId: boards.publicId,
      boardName: boards.name,
      boardVisibility: boards.visibility,
      workspaceId: workspaces.id,
      workspacePublicId: workspaces.publicId,
    })
    .from(cardSubtaskResources)
    .innerJoin(
      cardSubtasks,
      eq(cardSubtaskResources.subtaskId, cardSubtasks.id),
    )
    .innerJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .innerJoin(
      cardAttachments,
      eq(cardSubtaskResources.attachmentId, cardAttachments.id),
    )
    .innerJoin(cards, eq(cardSubtasks.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        eq(cardSubtaskResources.publicId, resourcePublicId),
        isNull(cardSubtaskResources.deletedAt),
        isNull(cardSubtasks.deletedAt),
        isNull(cardAttachments.deletedAt),
        isNull(cardAttachments.storageQuarantinedAt),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  return context ?? null;
};

export const linkAttachment = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    attachmentPublicId: string;
    expectedWorkspaceId: number;
    createdBy: string;
  },
) => {
  const cardId = await resolveSubtaskCardId(db, input.subtaskPublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const [subtask] = await tx
      .select({ id: cardSubtasks.id })
      .from(cardSubtasks)
      .where(
        and(
          eq(cardSubtasks.publicId, input.subtaskPublicId),
          eq(cardSubtasks.cardId, card.id),
          isNull(cardSubtasks.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!subtask) return { status: "not_found" as const };

    const [attachment] = await tx
      .select({
        id: cardAttachments.id,
        publicId: cardAttachments.publicId,
        filename: cardAttachments.filename,
        originalFilename: cardAttachments.originalFilename,
        contentType: cardAttachments.contentType,
        size: cardAttachments.size,
      })
      .from(cardAttachments)
      .where(
        and(
          eq(cardAttachments.publicId, input.attachmentPublicId),
          eq(cardAttachments.cardId, card.id),
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!attachment) return { status: "attachment_invalid" as const };

    const [existing] = await tx
      .select({ publicId: cardSubtaskResources.publicId })
      .from(cardSubtaskResources)
      .where(
        and(
          eq(cardSubtaskResources.subtaskId, subtask.id),
          eq(cardSubtaskResources.attachmentId, attachment.id),
          isNull(cardSubtaskResources.deletedAt),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        status: "existing" as const,
        resource: { ...existing, attachmentPublicId: attachment.publicId },
      };
    }

    const [resource] = await tx
      .insert(cardSubtaskResources)
      .values({
        publicId: generateUID(),
        subtaskId: subtask.id,
        attachmentId: attachment.id,
        createdBy: input.createdBy,
      })
      .returning({
        publicId: cardSubtaskResources.publicId,
        createdAt: cardSubtaskResources.createdAt,
      });
    if (!resource) return { status: "not_found" as const };

    return {
      status: "linked" as const,
      resource: {
        ...resource,
        attachmentPublicId: attachment.publicId,
        filename: attachment.filename,
        originalFilename: attachment.originalFilename,
        contentType: attachment.contentType,
        size: attachment.size,
      },
    };
  });
};

export const unlinkAttachment = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    resourcePublicId: string;
    expectedWorkspaceId: number;
    deletedBy: string;
  },
) => {
  const cardId = await resolveSubtaskCardId(db, input.subtaskPublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const [subtask] = await tx
      .select({ id: cardSubtasks.id })
      .from(cardSubtasks)
      .where(
        and(
          eq(cardSubtasks.publicId, input.subtaskPublicId),
          eq(cardSubtasks.cardId, card.id),
          isNull(cardSubtasks.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!subtask) return { status: "not_found" as const };

    const deletedAt = new Date();
    const [resource] = await tx
      .update(cardSubtaskResources)
      .set({ deletedAt, deletedBy: input.deletedBy })
      .where(
        and(
          eq(cardSubtaskResources.publicId, input.resourcePublicId),
          eq(cardSubtaskResources.subtaskId, subtask.id),
          isNull(cardSubtaskResources.deletedAt),
        ),
      )
      .returning({ publicId: cardSubtaskResources.publicId });

    return resource
      ? { status: "unlinked" as const, publicId: resource.publicId }
      : { status: "not_found" as const };
  });
};
