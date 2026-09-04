import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as cardVisualWallRepo from "@kan/db/repository/cardVisualWall.repo";
import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";

export async function getCardVisualWallPreviewForView(
  db: dbClient,
  resourcePublicId: string,
  actorId: string | null,
) {
  try {
    const preview = await cardVisualWallRepo.getPreviewForView(db, {
      resourcePublicId,
      actorId,
    });
    if (!preview) {
      throw new TRPCError({ code: "NOT_FOUND", message: "PREVIEW_NOT_FOUND" });
    }
    return preview;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof WorkspacePermissionChangedError) {
      throw new TRPCError({ code: "FORBIDDEN", message: "PREVIEW_FORBIDDEN" });
    }
    if (error instanceof WorkspaceChangedError) {
      throw new TRPCError({ code: "NOT_FOUND", message: "PREVIEW_NOT_FOUND" });
    }
    throw error;
  }
}
