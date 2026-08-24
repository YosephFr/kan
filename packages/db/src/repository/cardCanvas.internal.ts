import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";

import type { CardCanvasRevisionKind } from "@kan/db/schema";
import type {
  CardCanvasSceneReferences,
  NormalizedCardCanvasScene,
} from "@kan/shared";
import {
  cardAttachments,
  cardCanvases,
  cardCanvasFrames,
  cardCanvasResources,
  cardCanvasRevisions,
  cardResources,
  cardSubtasks,
} from "@kan/db/schema";
import {
  extractCardCanvasReferences,
  getCardCanvasSceneBytes,
  hashCardCanvasScene,
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
  normalizeCardCanvasScene,
} from "@kan/shared";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";

const CHECKPOINT_INTERVAL_MS = 15 * 60 * 1000;
const REVISION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REVISIONS = 30;

export interface PreparedCardCanvasScene {
  scene: NormalizedCardCanvasScene;
  hash: string;
  bytes: number;
  elementCount: number;
  references: CardCanvasSceneReferences;
}

export interface CardCanvasHeadRow {
  id: number;
  cardId: number;
  scene: NormalizedCardCanvasScene;
  version: number;
  hash: string;
  bytes: number;
  elementCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CardCanvasCasResult =
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

export class CardCanvasReferenceError extends Error {
  constructor(public readonly code: "CANVAS_REFERENCE_INVALID") {
    super(code);
    this.name = "CardCanvasReferenceError";
  }
}

export async function prepareCardCanvasScene(
  value: unknown,
): Promise<PreparedCardCanvasScene> {
  const scene = normalizeCardCanvasScene(value);
  return {
    scene,
    hash: await hashCardCanvasScene(scene),
    bytes: getCardCanvasSceneBytes(scene),
    elementCount: scene.elements.length,
    references: extractCardCanvasReferences(scene),
  };
}

export async function getCanvasHeadByCardIdTx(
  tx: DbTransaction,
  cardId: number,
): Promise<CardCanvasHeadRow | null> {
  const [head] = await tx
    .select({
      id: cardCanvases.id,
      cardId: cardCanvases.cardId,
      scene: cardCanvases.scene,
      version: cardCanvases.version,
      hash: cardCanvases.hash,
      bytes: cardCanvases.bytes,
      elementCount: cardCanvases.elementCount,
      createdAt: cardCanvases.createdAt,
      updatedAt: cardCanvases.updatedAt,
    })
    .from(cardCanvases)
    .where(eq(cardCanvases.cardId, cardId))
    .limit(1);
  return head ?? null;
}

export async function getCanvasHeadForUpdateTx(
  tx: DbTransaction,
  cardId: number,
): Promise<CardCanvasHeadRow | null> {
  const [head] = await tx
    .select({
      id: cardCanvases.id,
      cardId: cardCanvases.cardId,
      scene: cardCanvases.scene,
      version: cardCanvases.version,
      hash: cardCanvases.hash,
      bytes: cardCanvases.bytes,
      elementCount: cardCanvases.elementCount,
      createdAt: cardCanvases.createdAt,
      updatedAt: cardCanvases.updatedAt,
    })
    .from(cardCanvases)
    .where(eq(cardCanvases.cardId, cardId))
    .limit(1)
    .for("update");
  return head ?? null;
}

async function validateResourceReferencesTx(
  tx: DbTransaction,
  input: {
    cardId: number;
    prepared: PreparedCardCanvasScene;
  },
) {
  const publicIds = [
    ...new Set(
      input.prepared.references.resources.map((item) => item.publicId),
    ),
  ];
  if (publicIds.length === 0) return new Map<string, number>();
  const resources = await tx
    .select({
      id: cardResources.id,
      publicId: cardResources.publicId,
      kind: cardResources.kind,
      contentType: cardAttachments.contentType,
      size: cardAttachments.size,
    })
    .from(cardResources)
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .where(
      and(
        eq(cardResources.cardId, input.cardId),
        inArray(cardResources.publicId, publicIds),
        isNull(cardResources.deletedAt),
        or(
          eq(cardResources.kind, "drive"),
          eq(cardResources.kind, "web"),
          and(
            eq(cardResources.kind, "upload"),
            isNull(cardAttachments.deletedAt),
            isNull(cardAttachments.storageQuarantinedAt),
          ),
        ),
      ),
    )
    .orderBy(asc(cardResources.id))
    .for("share", { of: cardResources });
  if (resources.length !== publicIds.length) {
    throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
  }
  const byPublicId = new Map(
    resources.map((resource) => [resource.publicId, resource]),
  );
  const elementById = new Map(
    input.prepared.scene.elements.map((element) => [element.id, element]),
  );
  const imagePublicIds = new Set<string>();
  for (const reference of input.prepared.references.resources) {
    const resource = byPublicId.get(reference.publicId);
    const element = elementById.get(reference.elementId);
    if (
      !resource ||
      !element ||
      (element.type === "image" &&
        (resource.kind !== "upload" ||
          !resource.contentType?.startsWith("image/")))
    ) {
      throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
    }
    if (element.type === "image") imagePublicIds.add(reference.publicId);
  }
  const imageResources = [...imagePublicIds].flatMap((publicId) => {
    const resource = byPublicId.get(publicId);
    return resource ? [resource] : [];
  });
  if (
    imageResources.length !== imagePublicIds.size ||
    imageResources.length > MAX_CARD_CANVAS_IMAGE_RESOURCES ||
    imageResources.some(
      (resource) =>
        resource.size === null || resource.size > MAX_CARD_CANVAS_IMAGE_BYTES,
    ) ||
    imageResources.reduce(
      (total, resource) => total + (resource.size ?? 0),
      0,
    ) > MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES
  ) {
    throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
  }
  return new Map(resources.map((resource) => [resource.publicId, resource.id]));
}

async function validateSubtaskReferencesTx(
  tx: DbTransaction,
  input: { cardId: number; publicIds: string[] },
) {
  if (input.publicIds.length === 0) return;
  const subtasks = await tx
    .select({ publicId: cardSubtasks.publicId })
    .from(cardSubtasks)
    .where(
      and(
        eq(cardSubtasks.cardId, input.cardId),
        inArray(cardSubtasks.publicId, input.publicIds),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .orderBy(asc(cardSubtasks.id))
    .for("share");
  if (subtasks.length !== input.publicIds.length) {
    throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
  }
}

export async function syncCanvasRelationsTx(
  tx: DbTransaction,
  input: {
    canvasId: number;
    cardId: number;
    prepared: PreparedCardCanvasScene;
    actorId: string;
    now: Date;
  },
) {
  const resourceIdByPublicId = await validateResourceReferencesTx(tx, input);
  await validateSubtaskReferencesTx(tx, {
    cardId: input.cardId,
    publicIds: input.prepared.references.subtaskPublicIds,
  });

  const currentFrames = await tx
    .select({
      id: cardCanvasFrames.id,
      publicId: cardCanvasFrames.publicId,
      elementId: cardCanvasFrames.elementId,
      present: cardCanvasFrames.present,
      name: cardCanvasFrames.name,
    })
    .from(cardCanvasFrames)
    .where(eq(cardCanvasFrames.canvasId, input.canvasId))
    .orderBy(asc(cardCanvasFrames.id))
    .for("update");
  const referencedFramePublicIds = input.prepared.references.frames.map(
    (frame) => frame.publicId,
  );
  const collidingFrames =
    referencedFramePublicIds.length === 0
      ? []
      : await tx
          .select({
            publicId: cardCanvasFrames.publicId,
            canvasId: cardCanvasFrames.canvasId,
          })
          .from(cardCanvasFrames)
          .where(inArray(cardCanvasFrames.publicId, referencedFramePublicIds));
  if (collidingFrames.some((frame) => frame.canvasId !== input.canvasId)) {
    throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
  }

  const currentByPublicId = new Map(
    currentFrames.map((frame) => [frame.publicId, frame]),
  );
  const activeFrameIds = new Set<number>();
  for (const frame of input.prepared.references.frames) {
    const current = currentByPublicId.get(frame.publicId);
    if (current && current.elementId !== frame.elementId) {
      throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
    }
    if (current) {
      activeFrameIds.add(current.id);
      if (!current.present || current.name !== frame.name) {
        await tx
          .update(cardCanvasFrames)
          .set({ present: true, name: frame.name, updatedAt: input.now })
          .where(eq(cardCanvasFrames.id, current.id));
      }
      continue;
    }
    const [created] = await tx
      .insert(cardCanvasFrames)
      .values({
        publicId: frame.publicId,
        canvasId: input.canvasId,
        elementId: frame.elementId,
        name: frame.name,
        present: true,
        createdBy: input.actorId,
        updatedAt: input.now,
      })
      .returning({ id: cardCanvasFrames.id });
    if (!created)
      throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
    activeFrameIds.add(created.id);
  }
  const missingFrameIds = currentFrames
    .filter((frame) => !activeFrameIds.has(frame.id) && frame.present)
    .map((frame) => frame.id);
  if (missingFrameIds.length > 0) {
    await tx
      .update(cardCanvasFrames)
      .set({ present: false, updatedAt: input.now })
      .where(inArray(cardCanvasFrames.id, missingFrameIds));
  }

  await tx
    .delete(cardCanvasResources)
    .where(eq(cardCanvasResources.canvasId, input.canvasId));
  if (input.prepared.references.resources.length > 0) {
    await tx.insert(cardCanvasResources).values(
      input.prepared.references.resources.map((reference) => {
        const resourceId = resourceIdByPublicId.get(reference.publicId);
        if (!resourceId) {
          throw new CardCanvasReferenceError("CANVAS_REFERENCE_INVALID");
        }
        return {
          canvasId: input.canvasId,
          elementId: reference.elementId,
          resourceId,
        };
      }),
    );
  }
}

async function pruneRevisionsTx(
  tx: DbTransaction,
  canvasId: number,
  now: Date,
) {
  await tx
    .delete(cardCanvasRevisions)
    .where(
      and(
        eq(cardCanvasRevisions.canvasId, canvasId),
        lt(
          cardCanvasRevisions.createdAt,
          new Date(now.getTime() - REVISION_RETENTION_MS),
        ),
      ),
    );
  const retained = await tx
    .select({ id: cardCanvasRevisions.id })
    .from(cardCanvasRevisions)
    .where(eq(cardCanvasRevisions.canvasId, canvasId))
    .orderBy(desc(cardCanvasRevisions.createdAt), desc(cardCanvasRevisions.id))
    .limit(MAX_REVISIONS);
  if (retained.length === MAX_REVISIONS) {
    await tx.delete(cardCanvasRevisions).where(
      and(
        eq(cardCanvasRevisions.canvasId, canvasId),
        notInArray(
          cardCanvasRevisions.id,
          retained.map((revision) => revision.id),
        ),
      ),
    );
  }
}

async function checkpointHeadTx(
  tx: DbTransaction,
  input: {
    head: CardCanvasHeadRow;
    actorId: string;
    kind: CardCanvasRevisionKind;
    now: Date;
  },
) {
  await tx.insert(cardCanvasRevisions).values({
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
    head: CardCanvasHeadRow;
    actorId: string;
    now: Date;
  },
) {
  const [latest] = await tx
    .select({ createdAt: cardCanvasRevisions.createdAt })
    .from(cardCanvasRevisions)
    .where(
      and(
        eq(cardCanvasRevisions.canvasId, input.head.id),
        eq(cardCanvasRevisions.kind, "automatic"),
      ),
    )
    .orderBy(desc(cardCanvasRevisions.createdAt), desc(cardCanvasRevisions.id))
    .limit(1);
  const boundary = latest?.createdAt ?? input.head.createdAt;
  if (input.now.getTime() - boundary.getTime() < CHECKPOINT_INTERVAL_MS) return;
  await checkpointHeadTx(tx, { ...input, kind: "automatic" });
}

export async function applyNormalizedCanvasTx(
  tx: DbTransaction,
  input: {
    cardId: number;
    expectedVersion: number;
    prepared: PreparedCardCanvasScene;
    actorId: string;
    checkpoint?: "automatic" | "preRestore" | "none";
    now?: Date;
  },
): Promise<CardCanvasCasResult> {
  const now = input.now ?? new Date();
  const head = await getCanvasHeadForUpdateTx(tx, input.cardId);
  if (!head) {
    if (input.expectedVersion !== 0) {
      return {
        status: "conflict",
        code: "CANVAS_VERSION_CONFLICT",
        remoteVersion: 0,
      };
    }
    const [created] = await tx
      .insert(cardCanvases)
      .values({
        cardId: input.cardId,
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
      .returning({ id: cardCanvases.id });
    if (!created) throw new Error("Unable to create card canvas");
    await syncCanvasRelationsTx(tx, {
      canvasId: created.id,
      cardId: input.cardId,
      prepared: input.prepared,
      actorId: input.actorId,
      now,
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
    .update(cardCanvases)
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
        eq(cardCanvases.id, head.id),
        eq(cardCanvases.version, input.expectedVersion),
      ),
    )
    .returning({ id: cardCanvases.id });
  if (!updated) {
    const remote = await getCanvasHeadForUpdateTx(tx, input.cardId);
    return {
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: remote?.version ?? 0,
    };
  }
  await syncCanvasRelationsTx(tx, {
    canvasId: head.id,
    cardId: input.cardId,
    prepared: input.prepared,
    actorId: input.actorId,
    now,
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
