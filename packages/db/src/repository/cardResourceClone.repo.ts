import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import {
  cardActivities,
  cardAttachments,
  cardAttachmentUploadSessions,
  cardResources,
  cardSubtaskResources,
  cardSubtasks,
  cardVisualWallItems,
  cardVisualWallPreviews,
  cardVisualWalls,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import type { PreparedCardVisualWallUploadClone } from "./cardVisualWallClone.repo";
import { cancelPreviewDeletionKeysTx } from "./cardVisualWall.repo";
import { assertWorkspaceVisualWallCloneQuotaTx } from "./cardVisualWallClone.repo";

export interface ClonedSubtaskTarget {
  id: number;
  publicId: string;
}

const assertPreparedWallUploadStillActive = async (
  tx: DbTransaction,
  input: {
    sourceCardId: number;
    clone: PreparedCardVisualWallUploadClone;
  },
) => {
  const [source] = await tx
    .select({
      attachmentS3Key: cardAttachments.s3Key,
      attachmentFilename: cardAttachments.filename,
      attachmentOriginalFilename: cardAttachments.originalFilename,
      attachmentContentType: cardAttachments.contentType,
      attachmentSize: cardAttachments.size,
      attachmentSha256: cardAttachments.sha256,
      previewS3Key: cardVisualWallPreviews.s3Key,
      previewContentType: cardVisualWallPreviews.contentType,
      previewSize: cardVisualWallPreviews.size,
      previewSha256: cardVisualWallPreviews.sha256,
      previewWidth: cardVisualWallPreviews.width,
      previewHeight: cardVisualWallPreviews.height,
    })
    .from(cardResources)
    .innerJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .innerJoin(
      cardVisualWallPreviews,
      eq(cardVisualWallPreviews.resourceId, cardResources.id),
    )
    .innerJoin(
      cardVisualWallItems,
      and(
        eq(cardVisualWallItems.resourceId, cardResources.id),
        isNull(cardVisualWallItems.deletedAt),
      ),
    )
    .innerJoin(
      cardVisualWalls,
      and(
        eq(cardVisualWallItems.wallId, cardVisualWalls.id),
        eq(cardVisualWalls.cardId, input.sourceCardId),
      ),
    )
    .where(
      and(
        eq(cardResources.publicId, input.clone.sourceResourcePublicId),
        eq(cardResources.cardId, input.sourceCardId),
        eq(cardResources.kind, "upload"),
        isNull(cardResources.deletedAt),
        isNull(cardAttachments.deletedAt),
        isNull(cardAttachments.storageQuarantinedAt),
        isNull(cardVisualWallPreviews.deletedAt),
      ),
    )
    .limit(1)
    .for("share");
  if (
    !source ||
    source.attachmentS3Key !== input.clone.attachment.sourceS3Key ||
    source.attachmentFilename !== input.clone.attachment.filename ||
    source.attachmentOriginalFilename !==
      input.clone.attachment.originalFilename ||
    source.attachmentContentType !== input.clone.attachment.contentType ||
    source.attachmentSize !== input.clone.attachment.size ||
    source.attachmentSha256 !== input.clone.attachment.sha256 ||
    source.previewS3Key !== input.clone.preview.sourceS3Key ||
    source.previewContentType !== input.clone.preview.contentType ||
    source.previewSize !== input.clone.preview.size ||
    source.previewSha256 !== input.clone.preview.sha256 ||
    source.previewWidth !== input.clone.preview.width ||
    source.previewHeight !== input.clone.preview.height
  ) {
    throw new Error("Prepared visual wall upload source changed");
  }
};

const assertPreparedWallUploadSetStillCurrent = async (
  tx: DbTransaction,
  input: {
    sourceCardId: number;
    clones: readonly PreparedCardVisualWallUploadClone[];
  },
) => {
  const [wall] = await tx
    .select({ id: cardVisualWalls.id, version: cardVisualWalls.version })
    .from(cardVisualWalls)
    .where(eq(cardVisualWalls.cardId, input.sourceCardId))
    .limit(1)
    .for("share");
  const currentItems = wall
    ? await tx
        .select({ resourcePublicId: cardResources.publicId })
        .from(cardVisualWallItems)
        .innerJoin(
          cardResources,
          eq(cardVisualWallItems.resourceId, cardResources.id),
        )
        .where(
          and(
            eq(cardVisualWallItems.wallId, wall.id),
            eq(cardResources.cardId, input.sourceCardId),
            eq(cardResources.kind, "upload"),
            isNull(cardVisualWallItems.deletedAt),
            isNull(cardResources.deletedAt),
          ),
        )
        .for("share")
    : [];
  const currentPublicIds = new Set(
    currentItems.map((item) => item.resourcePublicId),
  );
  const expectedPublicIds = new Set(
    input.clones.map((clone) => clone.sourceResourcePublicId),
  );
  const expectedVersions = new Set(
    input.clones.map((clone) => clone.sourceWallVersion),
  );
  if (
    currentPublicIds.size !== expectedPublicIds.size ||
    [...currentPublicIds].some(
      (publicId) => !expectedPublicIds.has(publicId),
    ) ||
    expectedVersions.size > 1 ||
    (expectedVersions.size === 1 && wall?.version !== [...expectedVersions][0])
  ) {
    throw new Error("Prepared visual wall upload source changed");
  }
};

export async function cloneCardResourcesTx(
  tx: DbTransaction,
  input: {
    sourceCardId: number;
    destinationCardId: number;
    expectedWorkspaceId: number;
    createdBy: string;
    subtaskBySourceId?: Map<number, ClonedSubtaskTarget>;
    visualWallUploadClones?: readonly PreparedCardVisualWallUploadClone[];
  },
) {
  const visualWallUploadClones = input.visualWallUploadClones ?? [];
  if (visualWallUploadClones.length > 0) {
    await assertWorkspaceVisualWallCloneQuotaTx(tx, {
      workspaceId: input.expectedWorkspaceId,
      additionalBytes: visualWallUploadClones.reduce(
        (total, clone) => total + clone.attachment.size + clone.preview.size,
        0,
      ),
    });
  }
  const sourceResources = await tx
    .select({
      id: cardResources.id,
      publicId: cardResources.publicId,
      kind: cardResources.kind,
      title: cardResources.title,
      driveType: cardResources.driveType,
      driveFileId: cardResources.driveFileId,
      resourceKey: cardResources.resourceKey,
      webUrl: cardResources.webUrl,
      webUrlHash: cardResources.webUrlHash,
      webDescription: cardResources.webDescription,
      webSiteName: cardResources.webSiteName,
      webImageUrl: cardResources.webImageUrl,
      attachmentS3Key: cardAttachments.s3Key,
      attachmentFilename: cardAttachments.filename,
      attachmentOriginalFilename: cardAttachments.originalFilename,
      attachmentContentType: cardAttachments.contentType,
      attachmentSize: cardAttachments.size,
      attachmentSha256: cardAttachments.sha256,
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
          eq(cardResources.kind, "web"),
          and(
            isNull(cardAttachments.deletedAt),
            isNull(cardAttachments.storageQuarantinedAt),
          ),
        ),
      ),
    )
    .orderBy(asc(cardResources.id))
    .for("share", { of: cardResources });
  const cloneableResources = sourceResources.filter(
    (resource) => resource.kind !== "upload",
  );
  const uploadCloneBySourcePublicId = new Map(
    visualWallUploadClones.map((clone) => [
      clone.sourceResourcePublicId,
      clone,
    ]),
  );
  if (uploadCloneBySourcePublicId.size !== visualWallUploadClones.length) {
    throw new Error("Duplicate prepared visual wall upload clone");
  }
  await assertPreparedWallUploadSetStillCurrent(tx, {
    sourceCardId: input.sourceCardId,
    clones: visualWallUploadClones,
  });
  const wallUploadResources = sourceResources.filter((resource) => {
    if (resource.kind !== "upload") return false;
    const clone = uploadCloneBySourcePublicId.get(resource.publicId);
    if (!clone) return false;
    if (
      resource.attachmentS3Key !== clone.attachment.sourceS3Key ||
      resource.attachmentFilename !== clone.attachment.filename ||
      resource.attachmentOriginalFilename !==
        clone.attachment.originalFilename ||
      resource.attachmentContentType !== clone.attachment.contentType ||
      resource.attachmentSize !== clone.attachment.size ||
      resource.attachmentSha256 !== clone.attachment.sha256
    ) {
      throw new Error("Prepared visual wall upload source changed");
    }
    return true;
  });
  if (wallUploadResources.length !== uploadCloneBySourcePublicId.size) {
    throw new Error("Prepared visual wall upload is no longer active");
  }
  for (const clone of visualWallUploadClones) {
    await assertPreparedWallUploadStillActive(tx, {
      sourceCardId: input.sourceCardId,
      clone,
    });
  }
  const prepared = cloneableResources.map((resource) => ({
    sourceId: resource.id,
    sourcePublicId: resource.publicId,
    values: {
      publicId: generateUID(),
      cardId: input.destinationCardId,
      kind: resource.kind,
      title: resource.title,
      driveType: resource.driveType,
      driveFileId: resource.driveFileId,
      resourceKey: resource.resourceKey,
      webUrl: resource.webUrl,
      webUrlHash: resource.webUrlHash,
      webDescription: resource.webDescription,
      webSiteName: resource.webSiteName,
      webImageUrl: resource.webImageUrl,
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
  const resourceBySourceId = new Map<number, { id: number; publicId: string }>(
    prepared.flatMap((resource) => {
      const target = insertedByPublicId.get(resource.values.publicId);
      return target ? [[resource.sourceId, target] as const] : [];
    }),
  );
  if (resourceBySourceId.size !== cloneableResources.length) {
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
  if (resourcePublicIdBySourcePublicId.size !== cloneableResources.length) {
    throw new Error("Failed to map cloned card resource public IDs");
  }

  if (wallUploadResources.length > 0) {
    const now = new Date();
    for (const source of wallUploadResources) {
      const clone = uploadCloneBySourcePublicId.get(source.publicId);
      if (!clone) throw new Error("Missing prepared visual wall upload clone");
      const [session] = await tx
        .insert(cardAttachmentUploadSessions)
        .values({
          publicId: generateUID(),
          cardId: input.destinationCardId,
          workspaceId: input.expectedWorkspaceId,
          userId: input.createdBy,
          s3Key: clone.destinationAttachmentS3Key,
          filename: clone.attachment.filename,
          originalFilename: clone.attachment.originalFilename,
          contentType: clone.attachment.contentType,
          size: clone.attachment.size,
          sha256: clone.attachmentSha256,
          expiresAt: now,
          consumedAt: now,
        })
        .returning({ id: cardAttachmentUploadSessions.id });
      if (!session)
        throw new Error("Failed to clone visual wall upload session");
      const [attachment] = await tx
        .insert(cardAttachments)
        .values({
          publicId: generateUID(),
          cardId: input.destinationCardId,
          filename: clone.attachment.filename,
          originalFilename: clone.attachment.originalFilename,
          contentType: clone.attachment.contentType,
          size: clone.attachment.size,
          s3Key: clone.destinationAttachmentS3Key,
          sha256: clone.attachmentSha256,
          uploadSessionId: session.id,
          createdBy: input.createdBy,
        })
        .returning({ id: cardAttachments.id });
      if (!attachment)
        throw new Error("Failed to clone visual wall attachment");
      const [resource] = await tx
        .update(cardResources)
        .set({ title: source.title, createdBy: input.createdBy })
        .where(
          and(
            eq(cardResources.cardId, input.destinationCardId),
            eq(cardResources.attachmentId, attachment.id),
            eq(cardResources.kind, "upload"),
            isNull(cardResources.deletedAt),
          ),
        )
        .returning({ id: cardResources.id, publicId: cardResources.publicId });
      if (!resource) throw new Error("Failed to clone visual wall resource");
      await tx.insert(cardVisualWallPreviews).values({
        resourceId: resource.id,
        s3Key: clone.destinationPreviewS3Key,
        contentType: "image/webp",
        size: clone.preview.size,
        sha256: clone.preview.sha256,
        width: clone.preview.width,
        height: clone.preview.height,
      });
      await cancelPreviewDeletionKeysTx(tx, [
        clone.destinationAttachmentS3Key,
        clone.destinationPreviewS3Key,
      ]);
      resourceBySourceId.set(source.id, resource);
      resourcePublicIdBySourcePublicId.set(source.publicId, resource.publicId);
    }
  }

  const clonedSourceResources = [...cloneableResources, ...wallUploadResources];

  const subtaskBySourceId = input.subtaskBySourceId;
  const relations =
    !subtaskBySourceId ||
    subtaskBySourceId.size === 0 ||
    clonedSourceResources.length === 0
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
                clonedSourceResources.map((resource) => resource.id),
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
  if (resourceBySourceId.size > 0) {
    await tx.insert(cardActivities).values(
      clonedSourceResources.flatMap((resource) => {
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
    skippedUploadCount:
      sourceResources.filter((resource) => resource.kind === "upload").length -
      wallUploadResources.length,
    clonedDriveCount: cloneableResources.filter(
      (resource) => resource.kind === "drive",
    ).length,
    clonedWebCount: cloneableResources.filter(
      (resource) => resource.kind === "web",
    ).length,
    clonedRelationCount: clonedRelations.length,
    resourcePublicIdBySourcePublicId,
  };
}
