import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  workspaceCanvasImages,
  workspaceVisualWallItems,
  workspaceVisualWalls,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import {
  assertWorkspacePermissionTx,
  lockActiveWorkspaceByPublicId,
} from "./workspace-boundary";

export const VISUAL_WALL_TRACK_WIDTH = 1_200;
export const VISUAL_WALL_TRACK_MAX_Y = 1_000_000;
export const MAX_VISUAL_WALL_ITEMS = 5_000;

export interface VisualWallPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export type VisualWallMutationResult =
  | { status: "saved"; version: number; updatedAt: Date }
  | { status: "conflict"; remoteVersion: number };

export class VisualWallError extends Error {
  constructor(
    public readonly code:
      | "VISUAL_WALL_ITEM_INVALID"
      | "VISUAL_WALL_ITEM_NOT_FOUND"
      | "VISUAL_WALL_ITEM_LIMIT_REACHED",
  ) {
    super(code);
    this.name = "VisualWallError";
  }
}

const getWallTx = async (tx: DbTransaction, workspaceId: number) => {
  const [wall] = await tx
    .select({
      id: workspaceVisualWalls.id,
      version: workspaceVisualWalls.version,
      freeformUrl: workspaceVisualWalls.freeformUrl,
      updatedAt: workspaceVisualWalls.updatedAt,
    })
    .from(workspaceVisualWalls)
    .where(eq(workspaceVisualWalls.workspaceId, workspaceId))
    .limit(1);
  return wall ?? null;
};

const getWallForUpdateTx = async (tx: DbTransaction, workspaceId: number) => {
  const [wall] = await tx
    .select({
      id: workspaceVisualWalls.id,
      version: workspaceVisualWalls.version,
      freeformUrl: workspaceVisualWalls.freeformUrl,
      updatedAt: workspaceVisualWalls.updatedAt,
    })
    .from(workspaceVisualWalls)
    .where(eq(workspaceVisualWalls.workspaceId, workspaceId))
    .limit(1)
    .for("update");
  return wall ?? null;
};

const prepareMutationTx = async (
  tx: DbTransaction,
  input: {
    workspaceId: number;
    actorId: string;
    expectedVersion: number;
  },
) => {
  const existing = await getWallForUpdateTx(tx, input.workspaceId);
  const remoteVersion = existing?.version ?? 0;
  if (remoteVersion !== input.expectedVersion) {
    return { status: "conflict" as const, remoteVersion };
  }
  if (existing)
    return { status: "ready" as const, wall: existing, created: false };
  const now = new Date();
  const [wall] = await tx
    .insert(workspaceVisualWalls)
    .values({
      workspaceId: input.workspaceId,
      version: 1,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: workspaceVisualWalls.id,
      version: workspaceVisualWalls.version,
      freeformUrl: workspaceVisualWalls.freeformUrl,
      updatedAt: workspaceVisualWalls.updatedAt,
    });
  if (!wall) throw new Error("Failed to create workspace visual wall");
  return { status: "ready" as const, wall, created: true };
};

const finishMutationTx = async (
  tx: DbTransaction,
  input: {
    wallId: number;
    version: number;
    actorId: string;
    created: boolean;
  },
): Promise<VisualWallMutationResult> => {
  const updatedAt = new Date();
  const version = input.created ? input.version : input.version + 1;
  const [updated] = await tx
    .update(workspaceVisualWalls)
    .set({ version, updatedBy: input.actorId, updatedAt })
    .where(
      and(
        eq(workspaceVisualWalls.id, input.wallId),
        eq(workspaceVisualWalls.version, input.version),
      ),
    )
    .returning({ version: workspaceVisualWalls.version });
  if (!updated) {
    const [remote] = await tx
      .select({ version: workspaceVisualWalls.version })
      .from(workspaceVisualWalls)
      .where(eq(workspaceVisualWalls.id, input.wallId))
      .limit(1);
    return { status: "conflict", remoteVersion: remote?.version ?? 0 };
  }
  return { status: "saved", version, updatedAt };
};

const lockEditableWorkspace = async (
  tx: DbTransaction,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    actorId: string;
  },
) => {
  const workspace = await lockActiveWorkspaceByPublicId(tx, {
    ...input,
    lock: "update",
  });
  await assertWorkspacePermissionTx(tx, {
    workspaceId: workspace.id,
    userId: input.actorId,
    permission: "workspace:edit",
  });
  return workspace;
};

export const getSnapshot = (
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
    const wall = await getWallTx(tx, workspace.id);
    if (!wall) return null;
    const items = await tx
      .select({
        publicId: workspaceVisualWallItems.publicId,
        imagePublicId: workspaceCanvasImages.publicId,
        title: workspaceCanvasImages.title,
        widthPx: workspaceCanvasImages.width,
        heightPx: workspaceCanvasImages.height,
        x: workspaceVisualWallItems.x,
        y: workspaceVisualWallItems.y,
        width: workspaceVisualWallItems.width,
        height: workspaceVisualWallItems.height,
        zIndex: workspaceVisualWallItems.zIndex,
      })
      .from(workspaceVisualWallItems)
      .innerJoin(
        workspaceCanvasImages,
        eq(workspaceVisualWallItems.imageId, workspaceCanvasImages.id),
      )
      .where(
        and(
          eq(workspaceVisualWallItems.wallId, wall.id),
          isNull(workspaceVisualWallItems.deletedAt),
          eq(workspaceCanvasImages.workspaceId, workspace.id),
          isNull(workspaceCanvasImages.deletedAt),
        ),
      )
      .orderBy(
        asc(workspaceVisualWallItems.zIndex),
        asc(workspaceVisualWallItems.id),
      );
    return { ...wall, items };
  });

export const addImages = (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    items: (VisualWallPlacement & { imagePublicId: string })[];
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockEditableWorkspace(tx, input);
    const prepared = await prepareMutationTx(tx, {
      workspaceId: workspace.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(workspaceVisualWallItems)
      .where(
        and(
          eq(workspaceVisualWallItems.wallId, prepared.wall.id),
          isNull(workspaceVisualWallItems.deletedAt),
        ),
      );
    if ((countRow?.count ?? 0) + input.items.length > MAX_VISUAL_WALL_ITEMS) {
      throw new VisualWallError("VISUAL_WALL_ITEM_LIMIT_REACHED");
    }
    const imagePublicIds = [
      ...new Set(input.items.map((item) => item.imagePublicId)),
    ];
    const images = await tx
      .select({
        id: workspaceCanvasImages.id,
        publicId: workspaceCanvasImages.publicId,
        createdBy: workspaceCanvasImages.createdBy,
        sharedAt: workspaceCanvasImages.sharedAt,
      })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.workspaceId, workspace.id),
          inArray(workspaceCanvasImages.publicId, imagePublicIds),
          isNull(workspaceCanvasImages.deletedAt),
        ),
      )
      .orderBy(asc(workspaceCanvasImages.id))
      .for("share");
    if (
      images.length !== imagePublicIds.length ||
      images.some(
        (image) => image.createdBy !== input.actorId && image.sharedAt === null,
      )
    ) {
      throw new VisualWallError("VISUAL_WALL_ITEM_INVALID");
    }
    const imageIdByPublicId = new Map(
      images.map((image) => [image.publicId, image.id]),
    );
    const itemValues = input.items.map((item) => {
      const imageId = imageIdByPublicId.get(item.imagePublicId);
      if (!imageId) {
        throw new VisualWallError("VISUAL_WALL_ITEM_INVALID");
      }
      return {
        publicId: generateUID(),
        wallId: prepared.wall.id,
        imageId,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        zIndex: item.zIndex,
      };
    });
    await tx.insert(workspaceVisualWallItems).values(itemValues);
    await tx
      .update(workspaceCanvasImages)
      .set({ sharedAt: new Date() })
      .where(
        and(
          inArray(workspaceCanvasImages.id, [...imageIdByPublicId.values()]),
          isNull(workspaceCanvasImages.sharedAt),
        ),
      );
    return finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
  });

export const updateItem = (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    itemPublicId: string;
    placement: VisualWallPlacement;
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockEditableWorkspace(tx, input);
    const prepared = await prepareMutationTx(tx, {
      workspaceId: workspace.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    const [updated] = await tx
      .update(workspaceVisualWallItems)
      .set({ ...input.placement, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceVisualWallItems.wallId, prepared.wall.id),
          eq(workspaceVisualWallItems.publicId, input.itemPublicId),
          isNull(workspaceVisualWallItems.deletedAt),
        ),
      )
      .returning({ id: workspaceVisualWallItems.id });
    if (!updated) throw new VisualWallError("VISUAL_WALL_ITEM_NOT_FOUND");
    return finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
  });

export const removeItem = (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    itemPublicId: string;
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockEditableWorkspace(tx, input);
    const prepared = await prepareMutationTx(tx, {
      workspaceId: workspace.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    let [removed] = await tx
      .update(workspaceVisualWallItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(workspaceVisualWallItems.wallId, prepared.wall.id),
          eq(workspaceVisualWallItems.publicId, input.itemPublicId),
          isNotNull(workspaceVisualWallItems.legacyElementId),
          isNull(workspaceVisualWallItems.deletedAt),
        ),
      )
      .returning({ id: workspaceVisualWallItems.id });
    if (!removed) {
      [removed] = await tx
        .delete(workspaceVisualWallItems)
        .where(
          and(
            eq(workspaceVisualWallItems.wallId, prepared.wall.id),
            eq(workspaceVisualWallItems.publicId, input.itemPublicId),
            isNull(workspaceVisualWallItems.legacyElementId),
            isNull(workspaceVisualWallItems.deletedAt),
          ),
        )
        .returning({ id: workspaceVisualWallItems.id });
    }
    if (!removed) throw new VisualWallError("VISUAL_WALL_ITEM_NOT_FOUND");
    return finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
  });

export const setFreeformLink = (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    freeformUrl: string | null;
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockEditableWorkspace(tx, input);
    const prepared = await prepareMutationTx(tx, {
      workspaceId: workspace.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    await tx
      .update(workspaceVisualWalls)
      .set({ freeformUrl: input.freeformUrl })
      .where(eq(workspaceVisualWalls.id, prepared.wall.id));
    return finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
  });
