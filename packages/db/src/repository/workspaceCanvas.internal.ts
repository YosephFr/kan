import { and, desc, eq, lt, notInArray } from "drizzle-orm";

import type {
  CardCanvasResourceReference,
  NormalizedCardCanvasElement,
  NormalizedCardCanvasScene,
} from "@kan/shared";
import { workspaceCanvases, workspaceCanvasRevisions } from "@kan/db/schema";
import {
  extractCardCanvasReferences,
  getCardCanvasSceneBytes,
  hashCardCanvasScene,
  normalizeCardCanvasScene,
} from "@kan/shared";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";

const CHECKPOINT_INTERVAL_MS = 15 * 60 * 1000;
const REVISION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REVISIONS = 30;
const WORKSPACE_CANVAS_TRACK_WIDTH = 1_200;
const WORKSPACE_CANVAS_TRACK_MAX_Y = 1_000_000;
const BOUNDS_EPSILON = 0.000_001;

export interface PreparedWorkspaceCanvasScene {
  scene: NormalizedCardCanvasScene;
  hash: string;
  bytes: number;
  elementCount: number;
  resources: CardCanvasResourceReference[];
}

export interface WorkspaceCanvasHeadRow {
  id: number;
  workspaceId: number;
  scene: NormalizedCardCanvasScene;
  version: number;
  hash: string;
  bytes: number;
  elementCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkspaceCanvasCasResult =
  | {
      status: "saved" | "unchanged";
      version: number;
      hash: string;
      bytes: number;
      elementCount: number;
      canvasId: number;
    }
  | {
      status: "conflict";
      code: "CANVAS_VERSION_CONFLICT";
      remoteVersion: number;
    };

export type WorkspaceCanvasResourceValidator = (
  tx: DbTransaction,
  input: {
    workspaceId: number;
    canvasId: number;
    actorId: string;
    scene: NormalizedCardCanvasScene;
    resources: CardCanvasResourceReference[];
  },
) => Promise<void>;

export class WorkspaceCanvasPolicyError extends Error {
  constructor(
    public readonly code:
      | "WORKSPACE_CANVAS_UNSUPPORTED_ELEMENT"
      | "WORKSPACE_CANVAS_REFERENCE_INVALID"
      | "WORKSPACE_CANVAS_OUT_OF_BOUNDS",
  ) {
    super(code);
    this.name = "WorkspaceCanvasPolicyError";
  }
}

const rotatePoint = (
  point: { x: number; y: number },
  center: { x: number; y: number },
  angle: number,
) => {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const offsetX = point.x - center.x;
  const offsetY = point.y - center.y;
  return {
    x: center.x + offsetX * cosine - offsetY * sine,
    y: center.y + offsetX * sine + offsetY * cosine,
  };
};

const getWorkspaceCanvasElementBounds = (
  element: NormalizedCardCanvasElement,
) => {
  const x = typeof element.x === "number" ? element.x : 0;
  const y = typeof element.y === "number" ? element.y : 0;
  const width = typeof element.width === "number" ? element.width : 0;
  const height = typeof element.height === "number" ? element.height : 0;
  const angle = typeof element.angle === "number" ? element.angle : 0;
  const points =
    (element.type === "line" ||
      element.type === "arrow" ||
      element.type === "freedraw") &&
    Array.isArray(element.points)
      ? element.points.flatMap((point) =>
          Array.isArray(point) &&
          typeof point[0] === "number" &&
          typeof point[1] === "number"
            ? [{ x: x + point[0], y: y + point[1] }]
            : [],
        )
      : [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ];
  if (points.length === 0) points.push({ x, y });
  const unrotated = points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const center = {
    x: (unrotated.minX + unrotated.maxX) / 2,
    y: (unrotated.minY + unrotated.maxY) / 2,
  };
  return points
    .map((point) => rotatePoint(point, center, angle))
    .reduce(
      (bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );
};

export async function prepareWorkspaceCanvasScene(
  value: unknown,
): Promise<PreparedWorkspaceCanvasScene> {
  const scene = normalizeCardCanvasScene(value);
  if (
    scene.elements.some((element) => {
      const bounds = getWorkspaceCanvasElementBounds(element);
      return (
        bounds.minX < -BOUNDS_EPSILON ||
        bounds.maxX > WORKSPACE_CANVAS_TRACK_WIDTH + BOUNDS_EPSILON ||
        bounds.minY < -BOUNDS_EPSILON ||
        bounds.maxY > WORKSPACE_CANVAS_TRACK_MAX_Y + BOUNDS_EPSILON
      );
    })
  ) {
    throw new WorkspaceCanvasPolicyError("WORKSPACE_CANVAS_OUT_OF_BOUNDS");
  }
  if (
    scene.elements.some(
      (element) => element.type === "frame" || element.type === "embeddable",
    )
  ) {
    throw new WorkspaceCanvasPolicyError(
      "WORKSPACE_CANVAS_UNSUPPORTED_ELEMENT",
    );
  }
  const references = extractCardCanvasReferences(scene);
  if (references.frames.length > 0 || references.subtaskPublicIds.length > 0) {
    throw new WorkspaceCanvasPolicyError(
      "WORKSPACE_CANVAS_UNSUPPORTED_ELEMENT",
    );
  }
  const elementById = new Map(
    scene.elements.map((element) => [element.id, element]),
  );
  if (
    references.resources.some(
      (reference) => elementById.get(reference.elementId)?.type !== "image",
    )
  ) {
    throw new WorkspaceCanvasPolicyError("WORKSPACE_CANVAS_REFERENCE_INVALID");
  }
  return {
    scene,
    hash: await hashCardCanvasScene(scene),
    bytes: getCardCanvasSceneBytes(scene),
    elementCount: scene.elements.length,
    resources: references.resources,
  };
}

export async function getWorkspaceCanvasHeadTx(
  tx: DbTransaction,
  workspaceId: number,
  lock: "share" | "update" | null = null,
): Promise<WorkspaceCanvasHeadRow | null> {
  const query = tx
    .select({
      id: workspaceCanvases.id,
      workspaceId: workspaceCanvases.workspaceId,
      scene: workspaceCanvases.scene,
      version: workspaceCanvases.version,
      hash: workspaceCanvases.hash,
      bytes: workspaceCanvases.bytes,
      elementCount: workspaceCanvases.elementCount,
      createdAt: workspaceCanvases.createdAt,
      updatedAt: workspaceCanvases.updatedAt,
    })
    .from(workspaceCanvases)
    .where(eq(workspaceCanvases.workspaceId, workspaceId))
    .limit(1);
  const [head] = lock ? await query.for(lock) : await query;
  return head ?? null;
}

async function pruneRevisionsTx(
  tx: DbTransaction,
  canvasId: number,
  now: Date,
) {
  await tx
    .delete(workspaceCanvasRevisions)
    .where(
      and(
        eq(workspaceCanvasRevisions.canvasId, canvasId),
        lt(
          workspaceCanvasRevisions.createdAt,
          new Date(now.getTime() - REVISION_RETENTION_MS),
        ),
      ),
    );
  const retained = await tx
    .select({ id: workspaceCanvasRevisions.id })
    .from(workspaceCanvasRevisions)
    .where(eq(workspaceCanvasRevisions.canvasId, canvasId))
    .orderBy(
      desc(workspaceCanvasRevisions.createdAt),
      desc(workspaceCanvasRevisions.id),
    )
    .limit(MAX_REVISIONS);
  if (retained.length === MAX_REVISIONS) {
    await tx.delete(workspaceCanvasRevisions).where(
      and(
        eq(workspaceCanvasRevisions.canvasId, canvasId),
        notInArray(
          workspaceCanvasRevisions.id,
          retained.map((revision) => revision.id),
        ),
      ),
    );
  }
}

async function checkpointHeadTx(
  tx: DbTransaction,
  input: {
    head: WorkspaceCanvasHeadRow;
    actorId: string;
    kind: "automatic" | "preRestore";
    now: Date;
  },
) {
  await tx.insert(workspaceCanvasRevisions).values({
    publicId: generateUID(),
    canvasId: input.head.id,
    sourceVersion: input.head.version,
    kind: input.kind,
    scene: input.head.scene,
    hash: input.head.hash,
    bytes: input.head.bytes,
    elementCount: input.head.elementCount,
    createdBy: input.actorId,
    createdAt: input.now,
  });
  await pruneRevisionsTx(tx, input.head.id, input.now);
}

async function maybeCheckpointHeadTx(
  tx: DbTransaction,
  input: {
    head: WorkspaceCanvasHeadRow;
    actorId: string;
    now: Date;
  },
) {
  const [latest] = await tx
    .select({ createdAt: workspaceCanvasRevisions.createdAt })
    .from(workspaceCanvasRevisions)
    .where(
      and(
        eq(workspaceCanvasRevisions.canvasId, input.head.id),
        eq(workspaceCanvasRevisions.kind, "automatic"),
      ),
    )
    .orderBy(
      desc(workspaceCanvasRevisions.createdAt),
      desc(workspaceCanvasRevisions.id),
    )
    .limit(1);
  const boundary = latest?.createdAt ?? input.head.createdAt;
  if (input.now.getTime() - boundary.getTime() < CHECKPOINT_INTERVAL_MS) return;
  await checkpointHeadTx(tx, { ...input, kind: "automatic" });
}

async function syncResourcesTx(
  tx: DbTransaction,
  input: {
    workspaceId: number;
    canvasId: number;
    actorId: string;
    prepared: PreparedWorkspaceCanvasScene;
    validateResourceReferences?: WorkspaceCanvasResourceValidator;
  },
) {
  if (!input.validateResourceReferences) {
    if (input.prepared.resources.length === 0) return;
    throw new WorkspaceCanvasPolicyError("WORKSPACE_CANVAS_REFERENCE_INVALID");
  }
  await input.validateResourceReferences(tx, {
    workspaceId: input.workspaceId,
    canvasId: input.canvasId,
    actorId: input.actorId,
    scene: input.prepared.scene,
    resources: input.prepared.resources,
  });
}

export async function applyWorkspaceCanvasTx(
  tx: DbTransaction,
  input: {
    workspaceId: number;
    expectedVersion: number;
    prepared: PreparedWorkspaceCanvasScene;
    actorId: string;
    checkpoint?: "automatic" | "preRestore" | "none";
    validateResourceReferences?: WorkspaceCanvasResourceValidator;
    now?: Date;
  },
): Promise<WorkspaceCanvasCasResult> {
  const now = input.now ?? new Date();
  const head = await getWorkspaceCanvasHeadTx(tx, input.workspaceId, "update");
  if (!head) {
    if (input.expectedVersion !== 0) {
      return {
        status: "conflict",
        code: "CANVAS_VERSION_CONFLICT",
        remoteVersion: 0,
      };
    }
    const [created] = await tx
      .insert(workspaceCanvases)
      .values({
        workspaceId: input.workspaceId,
        scene: input.prepared.scene,
        version: 1,
        hash: input.prepared.hash,
        bytes: input.prepared.bytes,
        elementCount: input.prepared.elementCount,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: workspaceCanvases.id });
    if (!created) throw new Error("Unable to create workspace canvas");
    await syncResourcesTx(tx, {
      workspaceId: input.workspaceId,
      canvasId: created.id,
      actorId: input.actorId,
      prepared: input.prepared,
      validateResourceReferences: input.validateResourceReferences,
    });
    return {
      status: "saved",
      version: 1,
      hash: input.prepared.hash,
      bytes: input.prepared.bytes,
      elementCount: input.prepared.elementCount,
      canvasId: created.id,
    };
  }
  if (head.version !== input.expectedVersion) {
    return {
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: head.version,
    };
  }
  const checkpoint = input.checkpoint ?? "automatic";
  if (head.hash === input.prepared.hash && checkpoint !== "preRestore") {
    return {
      status: "unchanged",
      version: head.version,
      hash: head.hash,
      bytes: head.bytes,
      elementCount: head.elementCount,
      canvasId: head.id,
    };
  }
  if (checkpoint === "preRestore") {
    await checkpointHeadTx(tx, {
      head,
      actorId: input.actorId,
      kind: "preRestore",
      now,
    });
  } else if (checkpoint === "automatic") {
    await maybeCheckpointHeadTx(tx, {
      head,
      actorId: input.actorId,
      now,
    });
  }
  const nextVersion = head.version + 1;
  const [updated] = await tx
    .update(workspaceCanvases)
    .set({
      scene: input.prepared.scene,
      version: nextVersion,
      hash: input.prepared.hash,
      bytes: input.prepared.bytes,
      elementCount: input.prepared.elementCount,
      updatedBy: input.actorId,
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceCanvases.id, head.id),
        eq(workspaceCanvases.version, input.expectedVersion),
      ),
    )
    .returning({ id: workspaceCanvases.id });
  if (!updated) {
    const remote = await getWorkspaceCanvasHeadTx(
      tx,
      input.workspaceId,
      "update",
    );
    return {
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: remote?.version ?? 0,
    };
  }
  await syncResourcesTx(tx, {
    workspaceId: input.workspaceId,
    canvasId: head.id,
    actorId: input.actorId,
    prepared: input.prepared,
    validateResourceReferences: input.validateResourceReferences,
  });
  return {
    status: "saved",
    version: nextVersion,
    hash: input.prepared.hash,
    bytes: input.prepared.bytes,
    elementCount: input.prepared.elementCount,
    canvasId: head.id,
  };
}
