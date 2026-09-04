import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import type {
  CardVisualWallCloneSource,
  PreparedCardVisualWallUploadClone,
} from "@kan/db/repository/cardVisualWallClone.repo";
import * as cardVisualWallRepo from "@kan/db/repository/cardVisualWall.repo";
import {
  MAX_CARD_VISUAL_WALL_WORKSPACE_PHYSICAL_BYTES,
  MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES,
} from "@kan/shared";
import { copyObject, generateUID, inspectObject } from "@kan/shared/utils";

import { deleteCardVisualWallPreviewObjects } from "./card-visual-wall-preview";

const PREVIEW_MAX_BYTES = 750 * 1024;
export const MAX_CARD_VISUAL_WALL_CLONE_RESOURCES = 100;
export const MAX_CARD_VISUAL_WALL_CLONE_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_BOARD_VISUAL_WALL_CLONE_RESOURCES = 250;
export const MAX_BOARD_VISUAL_WALL_CLONE_SOURCE_BYTES = 250 * 1024 * 1024;

type CloneSourceSize = Pick<
  CardVisualWallCloneSource,
  "attachment" | "preview"
>;

const getCloneSourcesBudget = (sources: readonly CloneSourceSize[]) => ({
  resourceCount: sources.length,
  sourceBytes: sources.reduce(
    (total, source) => total + source.attachment.size + source.preview.size,
    0,
  ),
});

export function assertBoardVisualWallCloneBudget(input: {
  resourceCount: number;
  sourceBytes: number;
}) {
  if (
    input.resourceCount > MAX_BOARD_VISUAL_WALL_CLONE_RESOURCES ||
    input.sourceBytes > MAX_BOARD_VISUAL_WALL_CLONE_SOURCE_BYTES
  ) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "VISUAL_WALL_BOARD_CLONE_LIMIT_REACHED",
    });
  }
}

export function assertCardVisualWallCloneBudget(input: {
  resourceCount: number;
  sourceBytes: number;
}) {
  if (
    input.resourceCount > MAX_CARD_VISUAL_WALL_CLONE_RESOURCES ||
    input.sourceBytes > MAX_CARD_VISUAL_WALL_CLONE_SOURCE_BYTES
  ) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "VISUAL_WALL_CARD_CLONE_LIMIT_REACHED",
    });
  }
}

export function assertWorkspaceVisualWallCloneStorageBudget(input: {
  currentBytes: number;
  additionalBytes: number;
}) {
  if (
    input.currentBytes + input.additionalBytes >
    MAX_CARD_VISUAL_WALL_WORKSPACE_PHYSICAL_BYTES
  ) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "VISUAL_WALL_CLONE_STORAGE_QUOTA_REACHED",
    });
  }
}

const getBucket = () => {
  const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (!bucket) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "VISUAL_WALL_PREVIEW_STORAGE_UNAVAILABLE",
    });
  }
  return bucket;
};

export async function deletePreparedCardVisualWallCloneObjects(
  db: dbClient,
  s3Keys: readonly string[],
) {
  if (s3Keys.length === 0) return;
  await cardVisualWallRepo.enqueuePreviewDeletionKeys(db, s3Keys);
  await deleteCardVisualWallPreviewObjects(db, s3Keys);
}

export const deferPreparedCardVisualWallCloneCleanup = (
  db: dbClient,
  s3Keys: readonly string[],
) => cardVisualWallRepo.reservePreviewDeletionKeys(db, s3Keys);

const prepareOne = async (
  db: dbClient,
  bucket: string,
  source: CardVisualWallCloneSource,
  copiedKeys: string[],
): Promise<PreparedCardVisualWallUploadClone> => {
  const attachment = await inspectObject(
    bucket,
    source.attachment.sourceS3Key,
    {
      maxBytes: MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES,
      expectedBytes: source.attachment.size,
    },
  );
  if (
    attachment.contentType !== source.attachment.contentType ||
    (source.attachment.sha256 !== null &&
      attachment.sha256 !== source.attachment.sha256)
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "VISUAL_WALL_SOURCE_CHANGED",
    });
  }
  const preview = await inspectObject(bucket, source.preview.sourceS3Key, {
    maxBytes: PREVIEW_MAX_BYTES,
    expectedBytes: source.preview.size,
  });
  if (
    preview.contentType !== "image/webp" ||
    source.preview.contentType !== "image/webp" ||
    preview.sha256 !== source.preview.sha256
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "VISUAL_WALL_SOURCE_CHANGED",
    });
  }
  const destinationAttachmentS3Key = `.objects/${generateUID()}`;
  const destinationPreviewS3Key = `.visual-wall/${generateUID()}`;
  await cardVisualWallRepo.reservePreviewDeletionKeys(db, [
    destinationAttachmentS3Key,
    destinationPreviewS3Key,
  ]);
  copiedKeys.push(destinationAttachmentS3Key);
  await copyObject({
    bucket,
    sourceKey: source.attachment.sourceS3Key,
    destinationKey: destinationAttachmentS3Key,
    sourceEtag: attachment.etag,
    contentType: source.attachment.contentType,
  });
  copiedKeys.push(destinationPreviewS3Key);
  await copyObject({
    bucket,
    sourceKey: source.preview.sourceS3Key,
    destinationKey: destinationPreviewS3Key,
    sourceEtag: preview.etag,
    contentType: "image/webp",
  });
  return {
    ...source,
    destinationAttachmentS3Key,
    destinationPreviewS3Key,
    attachmentSha256: attachment.sha256,
  };
};

export async function prepareCardVisualWallCloneObjects(
  db: dbClient,
  sources: readonly CardVisualWallCloneSource[],
) {
  assertCardVisualWallCloneBudget(getCloneSourcesBudget(sources));
  if (sources.length === 0) {
    return { clones: [], copiedKeys: [] };
  }
  const bucket = getBucket();
  const copiedKeys: string[] = [];
  try {
    const clones: PreparedCardVisualWallUploadClone[] = [];
    for (const source of sources) {
      clones.push(await prepareOne(db, bucket, source, copiedKeys));
      if (clones.length % 10 === 0) {
        await cardVisualWallRepo.renewPreviewDeletionKeyReservations(
          db,
          copiedKeys,
        );
      }
    }
    await cardVisualWallRepo.renewPreviewDeletionKeyReservations(
      db,
      copiedKeys,
    );
    return { clones, copiedKeys };
  } catch (error) {
    await deletePreparedCardVisualWallCloneObjects(db, copiedKeys);
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "VISUAL_WALL_CLONE_FAILED",
    });
  }
}

export function assertBoardVisualWallCloneSources(
  sources: readonly CloneSourceSize[],
) {
  assertBoardVisualWallCloneBudget(getCloneSourcesBudget(sources));
}
