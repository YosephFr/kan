import { and, desc, eq } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { workspaceCanvasRevisions } from "@kan/db/schema";

import type { WorkspaceCanvasResourceValidator } from "./workspaceCanvas.internal";
import {
  assertWorkspacePermissionTx,
  lockActiveWorkspaceByPublicId,
  WorkspaceChangedError,
} from "./workspace-boundary";
import {
  applyWorkspaceCanvasTx,
  getWorkspaceCanvasHeadTx,
  prepareWorkspaceCanvasScene,
} from "./workspaceCanvas.internal";
import {
  reclaimWorkspaceCanvasImagesTx,
  syncReferences,
} from "./workspaceCanvasImage.repo";

const withReclaimedS3Keys = <T extends object>(
  result: T,
  reclaimedS3Keys: string[],
): T & { reclaimedS3Keys?: string[] } => ({
  ...result,
  ...(reclaimedS3Keys.length > 0 ? { reclaimedS3Keys } : {}),
});

const syncWorkspaceCanvasImages: WorkspaceCanvasResourceValidator = async (
  tx,
  input,
) =>
  syncReferences(tx, {
    canvasId: input.canvasId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    references: input.resources,
  });

export const getSnapshot = async (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    actorId: string;
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceByPublicId(tx, input);
    await assertWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.actorId,
      permission: "workspace:view",
    });
    return getWorkspaceCanvasHeadTx(tx, workspace.id, "share");
  });

export const save = async (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    scene: unknown;
    actorId: string;
    validateResourceReferences?: WorkspaceCanvasResourceValidator;
  },
) => {
  const prepared = await prepareWorkspaceCanvasScene(input.scene);
  return db.transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceByPublicId(tx, {
      ...input,
      lock: "update",
    });
    await assertWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.actorId,
      permission: "workspace:edit",
    });
    const result = await applyWorkspaceCanvasTx(tx, {
      workspaceId: workspace.id,
      expectedVersion: input.expectedVersion,
      prepared,
      actorId: input.actorId,
      validateResourceReferences:
        input.validateResourceReferences ?? syncWorkspaceCanvasImages,
    });
    if (result.status === "conflict") {
      return result;
    }
    const reclaimedS3Keys = await reclaimWorkspaceCanvasImagesTx(tx, {
      workspaceId: workspace.id,
    });
    return withReclaimedS3Keys(result, reclaimedS3Keys);
  });
};

export const listRevisions = async (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    actorId: string;
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceByPublicId(tx, input);
    await assertWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.actorId,
      permission: "workspace:edit",
    });
    const head = await getWorkspaceCanvasHeadTx(tx, workspace.id, "share");
    if (!head) return [];
    return tx
      .select({
        publicId: workspaceCanvasRevisions.publicId,
        version: workspaceCanvasRevisions.sourceVersion,
        kind: workspaceCanvasRevisions.kind,
        bytes: workspaceCanvasRevisions.bytes,
        elementCount: workspaceCanvasRevisions.elementCount,
        createdAt: workspaceCanvasRevisions.createdAt,
      })
      .from(workspaceCanvasRevisions)
      .where(eq(workspaceCanvasRevisions.canvasId, head.id))
      .orderBy(
        desc(workspaceCanvasRevisions.createdAt),
        desc(workspaceCanvasRevisions.id),
      );
  });

export const restore = async (
  db: dbClient,
  input: {
    workspacePublicId: string;
    revisionPublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    validateResourceReferences?: WorkspaceCanvasResourceValidator;
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceByPublicId(tx, {
      ...input,
      lock: "update",
    });
    await assertWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.actorId,
      permission: "workspace:edit",
    });
    const head = await getWorkspaceCanvasHeadTx(tx, workspace.id, "update");
    if (!head || head.version !== input.expectedVersion) {
      return {
        status: "conflict" as const,
        code: "CANVAS_VERSION_CONFLICT" as const,
        remoteVersion: head?.version ?? 0,
      };
    }
    const [revision] = await tx
      .select({ scene: workspaceCanvasRevisions.scene })
      .from(workspaceCanvasRevisions)
      .where(
        and(
          eq(workspaceCanvasRevisions.publicId, input.revisionPublicId),
          eq(workspaceCanvasRevisions.canvasId, head.id),
        ),
      )
      .limit(1)
      .for("share");
    if (!revision) {
      return { status: "revision_not_found" as const };
    }
    const prepared = await prepareWorkspaceCanvasScene(revision.scene);
    const result = await applyWorkspaceCanvasTx(tx, {
      workspaceId: workspace.id,
      expectedVersion: input.expectedVersion,
      prepared,
      actorId: input.actorId,
      checkpoint: "preRestore",
      validateResourceReferences:
        input.validateResourceReferences ?? syncWorkspaceCanvasImages,
    });
    if (result.status === "conflict") {
      return result;
    }
    const reclaimedS3Keys = await reclaimWorkspaceCanvasImagesTx(tx, {
      workspaceId: workspace.id,
    });
    return withReclaimedS3Keys(result, reclaimedS3Keys);
  });

export {
  WorkspaceCanvasPolicyError,
  prepareWorkspaceCanvasScene,
} from "./workspaceCanvas.internal";
export type { WorkspaceCanvasResourceValidator } from "./workspaceCanvas.internal";
export { WorkspaceChangedError };
