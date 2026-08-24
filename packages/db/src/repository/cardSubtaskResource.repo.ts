import { and, eq, isNull, or } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardActivities,
  cardAttachments,
  cardPipelineStages,
  cardResources,
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
  relationPublicId: string,
) => {
  const [context] = await db
    .select({
      relationId: cardSubtaskResources.id,
      relationPublicId: cardSubtaskResources.publicId,
      resourcePublicId: cardResources.publicId,
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
      cardResources,
      or(
        eq(cardSubtaskResources.resourceId, cardResources.id),
        and(
          isNull(cardSubtaskResources.resourceId),
          eq(cardSubtaskResources.attachmentId, cardResources.attachmentId),
        ),
      ),
    )
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .innerJoin(cards, eq(cardSubtasks.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        eq(cardSubtaskResources.publicId, relationPublicId),
        isNull(cardSubtaskResources.deletedAt),
        isNull(cardSubtasks.deletedAt),
        isNull(cardResources.deletedAt),
        or(
          eq(cardResources.kind, "drive"),
          eq(cardResources.kind, "web"),
          and(
            isNull(cardAttachments.deletedAt),
            isNull(cardAttachments.storageQuarantinedAt),
          ),
        ),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  return context ?? null;
};

export const linkResource = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    resourcePublicId: string;
    expectedWorkspaceId: number;
    createdBy: string;
    requiredKind?: "upload";
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

    const resourceConditions = [
      eq(cardResources.publicId, input.resourcePublicId),
      eq(cardResources.cardId, card.id),
      isNull(cardResources.deletedAt),
      or(
        eq(cardResources.kind, "drive"),
        eq(cardResources.kind, "web"),
        and(
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
        ),
      ),
    ];
    if (input.requiredKind) {
      resourceConditions.push(eq(cardResources.kind, input.requiredKind));
    }
    const [resource] = await tx
      .select({
        id: cardResources.id,
        publicId: cardResources.publicId,
        kind: cardResources.kind,
        attachmentId: cardResources.attachmentId,
        attachmentPublicId: cardAttachments.publicId,
      })
      .from(cardResources)
      .leftJoin(
        cardAttachments,
        eq(cardResources.attachmentId, cardAttachments.id),
      )
      .where(and(...resourceConditions))
      .limit(1)
      .for("update", { of: cardResources });
    if (!resource) return { status: "resource_invalid" as const };

    const [existing] = await tx
      .select({ publicId: cardSubtaskResources.publicId })
      .from(cardSubtaskResources)
      .where(
        and(
          eq(cardSubtaskResources.subtaskId, subtask.id),
          or(
            eq(cardSubtaskResources.resourceId, resource.id),
            and(
              isNull(cardSubtaskResources.resourceId),
              resource.attachmentId === null
                ? eq(cardSubtaskResources.resourceId, resource.id)
                : eq(cardSubtaskResources.attachmentId, resource.attachmentId),
            ),
          ),
          isNull(cardSubtaskResources.deletedAt),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        status: "existing" as const,
        relation: {
          ...existing,
          resourcePublicId: resource.publicId,
          kind: resource.kind,
          attachmentPublicId: resource.attachmentPublicId,
        },
      };
    }

    const [relation] = await tx
      .insert(cardSubtaskResources)
      .values({
        publicId: generateUID(),
        subtaskId: subtask.id,
        resourceId: resource.id,
        attachmentId: resource.attachmentId,
        createdBy: input.createdBy,
      })
      .onConflictDoNothing()
      .returning({ publicId: cardSubtaskResources.publicId });
    if (!relation) {
      const [concurrent] = await tx
        .select({ publicId: cardSubtaskResources.publicId })
        .from(cardSubtaskResources)
        .where(
          and(
            eq(cardSubtaskResources.subtaskId, subtask.id),
            or(
              eq(cardSubtaskResources.resourceId, resource.id),
              and(
                isNull(cardSubtaskResources.resourceId),
                resource.attachmentId === null
                  ? eq(cardSubtaskResources.resourceId, resource.id)
                  : eq(
                      cardSubtaskResources.attachmentId,
                      resource.attachmentId,
                    ),
              ),
            ),
            isNull(cardSubtaskResources.deletedAt),
          ),
        )
        .limit(1);
      if (!concurrent) return { status: "not_found" as const };
      return {
        status: "existing" as const,
        relation: {
          ...concurrent,
          resourcePublicId: resource.publicId,
          kind: resource.kind,
          attachmentPublicId: resource.attachmentPublicId,
        },
      };
    }
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.resource.linked",
      cardId: card.id,
      subtaskPublicId: input.subtaskPublicId,
      toTitle: input.resourcePublicId,
      createdBy: input.createdBy,
    });
    return {
      status: "linked" as const,
      relation: {
        ...relation,
        resourcePublicId: resource.publicId,
        kind: resource.kind,
        attachmentPublicId: resource.attachmentPublicId,
      },
    };
  });
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
  const result = await linkResource(db, {
    subtaskPublicId: input.subtaskPublicId,
    resourcePublicId: input.attachmentPublicId,
    expectedWorkspaceId: input.expectedWorkspaceId,
    createdBy: input.createdBy,
    requiredKind: "upload",
  });
  return result.status === "resource_invalid"
    ? { status: "attachment_invalid" as const }
    : result;
};

async function unlinkRelation(
  db: dbClient,
  input: {
    subtaskPublicId: string;
    expectedWorkspaceId: number;
    deletedBy: string;
    resourcePublicId?: string;
    relationPublicId?: string;
  },
) {
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
    const conditions = [
      eq(cardSubtaskResources.subtaskId, subtask.id),
      isNull(cardSubtaskResources.deletedAt),
    ];
    if (input.relationPublicId) {
      conditions.push(
        eq(cardSubtaskResources.publicId, input.relationPublicId),
      );
    } else if (input.resourcePublicId) {
      const [resource] = await tx
        .select({
          id: cardResources.id,
          attachmentId: cardResources.attachmentId,
        })
        .from(cardResources)
        .where(
          and(
            eq(cardResources.publicId, input.resourcePublicId),
            eq(cardResources.cardId, card.id),
            isNull(cardResources.deletedAt),
          ),
        )
        .limit(1);
      if (!resource) return { status: "not_found" as const };
      const relationCondition = or(
        eq(cardSubtaskResources.resourceId, resource.id),
        and(
          isNull(cardSubtaskResources.resourceId),
          resource.attachmentId === null
            ? eq(cardSubtaskResources.resourceId, resource.id)
            : eq(cardSubtaskResources.attachmentId, resource.attachmentId),
        ),
      );
      if (!relationCondition) return { status: "not_found" as const };
      conditions.push(relationCondition);
    } else {
      return { status: "not_found" as const };
    }
    const [relation] = await tx
      .update(cardSubtaskResources)
      .set({ deletedAt: new Date(), deletedBy: input.deletedBy })
      .where(and(...conditions))
      .returning({ publicId: cardSubtaskResources.publicId });
    if (!relation) return { status: "not_found" as const };
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.resource.unlinked",
      cardId: card.id,
      subtaskPublicId: input.subtaskPublicId,
      fromTitle: input.resourcePublicId ?? input.relationPublicId,
      createdBy: input.deletedBy,
    });
    return { status: "unlinked" as const, publicId: relation.publicId };
  });
}

export const unlinkResource = (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    resourcePublicId: string;
    expectedWorkspaceId: number;
    deletedBy: string;
  },
) => unlinkRelation(db, input);

export const unlinkAttachment = (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    resourcePublicId: string;
    expectedWorkspaceId: number;
    deletedBy: string;
  },
) =>
  unlinkRelation(db, {
    subtaskPublicId: input.subtaskPublicId,
    relationPublicId: input.resourcePublicId,
    expectedWorkspaceId: input.expectedWorkspaceId,
    deletedBy: input.deletedBy,
  });
