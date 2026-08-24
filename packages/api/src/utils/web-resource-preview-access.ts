import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";

import { assertPermission } from "./permissions";

export async function getWebResourcePreviewForView(
  db: dbClient,
  resourcePublicId: string,
  userId?: string,
) {
  const resource = await cardResourceRepo.getWebPreviewContextByPublicId(
    db,
    resourcePublicId,
  );
  if (!resource?.imageUrl) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Preview not found" });
  }
  if (resource.boardVisibility === "public") return resource;
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  await assertPermission(db, userId, resource.workspaceId, "card:view");
  return resource;
}
