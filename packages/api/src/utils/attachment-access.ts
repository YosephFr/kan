import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as cardAttachmentRepo from "@kan/db/repository/cardAttachment.repo";

import { assertPermission } from "./permissions";

export async function getAttachmentForView(
  db: dbClient,
  attachmentPublicId: string,
  userId?: string,
) {
  const attachment = await cardAttachmentRepo.getByPublicId(
    db,
    attachmentPublicId,
  );

  if (
    !attachment ||
    attachment.deletedAt ||
    attachment.card.deletedAt ||
    attachment.card.list.deletedAt ||
    attachment.card.list.board.deletedAt ||
    attachment.card.list.board.workspace.deletedAt ||
    attachment.storageQuarantinedAt ||
    !cardAttachmentRepo.hasValidAttachmentStorageOwnership(attachment)
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });

  const board = attachment.card.list.board;
  if (board.visibility === "public") return attachment;

  if (!userId)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not authenticated",
    });

  await assertPermission(db, userId, board.workspaceId, "card:view");
  return attachment;
}
