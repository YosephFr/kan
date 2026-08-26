import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";

export async function getWorkspaceCanvasImageForView(
  db: dbClient,
  imagePublicId: string,
  userId?: string,
) {
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "UNAUTHORIZED" });
  }
  try {
    const image = await workspaceCanvasImageRepo.getForView(db, {
      imagePublicId,
      userId,
    });
    if (!image) {
      throw new TRPCError({ code: "NOT_FOUND", message: "IMAGE_NOT_FOUND" });
    }
    return image;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof WorkspaceChangedError) {
      throw new TRPCError({ code: "NOT_FOUND", message: "IMAGE_NOT_FOUND" });
    }
    if (error instanceof WorkspacePermissionChangedError) {
      throw new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN" });
    }
    throw error;
  }
}
