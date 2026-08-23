import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import {
  cardActivities,
  cardAttachments,
  cardResources,
  cardSubtaskResources,
  cardSubtasks,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";

export interface ClonedSubtaskTarget {
  id: number;
  publicId: string;
}

export async function cloneCardResourcesTx(
  tx: DbTransaction,
  input: {
    sourceCardId: number;
    destinationCardId: number;
    createdBy: string;
    subtaskBySourceId?: Map<number, ClonedSubtaskTarget>;
  },
) {
  const sourceResources = await tx
    .select({
      id: cardResources.id,
      publicId: cardResources.publicId,
      kind: cardResources.kind,
      title: cardResources.title,
      driveType: cardResources.driveType,
      driveFileId: cardResources.driveFileId,
      resourceKey: cardResources.resourceKey,
    })
    .from(cardResources)
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .where(
      and(
        eq(cardResources.cardId, input.sourceCardId),
        isNull(cardResources.deletedAt),
        or(
          eq(cardResources.kind, "drive"),
          and(
            isNull(cardAttachments.deletedAt),
            isNull(cardAttachments.storageQuarantinedAt),
          ),
        ),
      ),
    )
    .orderBy(asc(cardResources.id))
    .for("share", { of: cardResources });
  const driveResources = sourceResources.filter(
    (resource) => resource.kind === "drive",
  );
  const prepared = driveResources.map((resource) => ({
    sourceId: resource.id,
    sourcePublicId: resource.publicId,
    values: {
      publicId: generateUID(),
      cardId: input.destinationCardId,
      kind: "drive" as const,
      title: resource.title,
      driveType: resource.driveType,
      driveFileId: resource.driveFileId,
      resourceKey: resource.resourceKey,
      createdBy: input.createdBy,
    },
  }));
  const inserted =
    prepared.length === 0
      ? []
      : await tx
          .insert(cardResources)
          .values(prepared.map((resource) => resource.values))
          .returning({
            id: cardResources.id,
            publicId: cardResources.publicId,
          });
  const insertedByPublicId = new Map(
    inserted.map((resource) => [resource.publicId, resource]),
  );
  const resourceBySourceId = new Map(
    prepared.flatMap((resource) => {
      const target = insertedByPublicId.get(resource.values.publicId);
      return target ? [[resource.sourceId, target] as const] : [];
    }),
  );
  if (resourceBySourceId.size !== driveResources.length) {
    throw new Error("Failed to map cloned card resources");
  }
  const resourcePublicIdBySourcePublicId = new Map(
    prepared.flatMap((resource) => {
      const target = insertedByPublicId.get(resource.values.publicId);
      return target
        ? [[resource.sourcePublicId, target.publicId] as const]
        : [];
    }),
  );
  if (resourcePublicIdBySourcePublicId.size !== driveResources.length) {
    throw new Error("Failed to map cloned card resource public IDs");
  }

  const subtaskBySourceId = input.subtaskBySourceId;
  const relations =
    !subtaskBySourceId || subtaskBySourceId.size === 0 || prepared.length === 0
      ? []
      : await tx
          .select({
            subtaskId: cardSubtaskResources.subtaskId,
            resourceId: cardResources.id,
          })
          .from(cardSubtaskResources)
          .innerJoin(
            cardResources,
            or(
              eq(cardSubtaskResources.resourceId, cardResources.id),
              and(
                isNull(cardSubtaskResources.resourceId),
                eq(
                  cardSubtaskResources.attachmentId,
                  cardResources.attachmentId,
                ),
              ),
            ),
          )
          .innerJoin(
            cardSubtasks,
            eq(cardSubtaskResources.subtaskId, cardSubtasks.id),
          )
          .where(
            and(
              inArray(cardSubtaskResources.subtaskId, [
                ...subtaskBySourceId.keys(),
              ]),
              inArray(
                cardResources.id,
                driveResources.map((resource) => resource.id),
              ),
              isNull(cardResources.deletedAt),
              isNull(cardSubtaskResources.deletedAt),
              isNull(cardSubtasks.deletedAt),
            ),
          )
          .orderBy(asc(cardSubtaskResources.id));
  const clonedRelations = relations.flatMap((relation) => {
    const subtask = subtaskBySourceId?.get(relation.subtaskId);
    const resource = resourceBySourceId.get(relation.resourceId);
    return subtask && resource
      ? [
          {
            publicId: generateUID(),
            subtaskId: subtask.id,
            resourceId: resource.id,
            attachmentId: null,
            createdBy: input.createdBy,
          },
        ]
      : [];
  });
  if (clonedRelations.length > 0) {
    await tx.insert(cardSubtaskResources).values(clonedRelations);
  }
  if (inserted.length > 0) {
    await tx.insert(cardActivities).values(
      driveResources.flatMap((resource) => {
        const target = resourceBySourceId.get(resource.id);
        return target
          ? [
              {
                publicId: generateUID(),
                type: "card.updated.resource.added" as const,
                cardId: input.destinationCardId,
                toTitle: resource.title,
                createdBy: input.createdBy,
              },
            ]
          : [];
      }),
    );
  }

  return {
    skippedUploadCount: sourceResources.filter(
      (resource) => resource.kind === "upload",
    ).length,
    clonedDriveCount: inserted.length,
    clonedRelationCount: clonedRelations.length,
    resourcePublicIdBySourcePublicId,
  };
}
