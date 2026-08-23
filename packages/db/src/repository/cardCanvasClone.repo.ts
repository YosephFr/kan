import { and, eq } from "drizzle-orm";

import { cardCanvases, cardCanvasFrames } from "@kan/db/schema";
import { remapCardCanvasSceneReferences } from "@kan/shared";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import {
  applyNormalizedCanvasTx,
  prepareCardCanvasScene,
} from "./cardCanvas.internal";

interface ClonedSubtaskTarget {
  id: number;
  publicId: string;
}

export async function cloneCardCanvasHeadTx(
  tx: DbTransaction,
  input: {
    sourceCardId: number;
    destinationCardId: number;
    createdBy: string;
    subtaskBySourceId?: ReadonlyMap<number, ClonedSubtaskTarget>;
    subtaskPublicIdBySourcePublicId?: ReadonlyMap<string, string>;
    resourcePublicIdBySourcePublicId: ReadonlyMap<string, string>;
  },
) {
  const [sourceCanvas] = await tx
    .select({
      id: cardCanvases.id,
      scene: cardCanvases.scene,
    })
    .from(cardCanvases)
    .where(eq(cardCanvases.cardId, input.sourceCardId))
    .limit(1)
    .for("share");
  if (!sourceCanvas) return { status: "no_canvas" as const };

  const sourceFrames = await tx
    .select({
      publicId: cardCanvasFrames.publicId,
      subtaskId: cardCanvasFrames.subtaskId,
    })
    .from(cardCanvasFrames)
    .where(
      and(
        eq(cardCanvasFrames.canvasId, sourceCanvas.id),
        eq(cardCanvasFrames.present, true),
      ),
    )
    .for("share");
  const framePublicIds = new Map(
    sourceFrames.map((frame) => [frame.publicId, generateUID()]),
  );
  const remappedScene = remapCardCanvasSceneReferences(sourceCanvas.scene, {
    framePublicIds,
    resourcePublicIds: input.resourcePublicIdBySourcePublicId,
    subtaskPublicIds:
      input.subtaskPublicIdBySourcePublicId ?? new Map<string, string>(),
  });
  const prepared = await prepareCardCanvasScene(remappedScene);
  const result = await applyNormalizedCanvasTx(tx, {
    cardId: input.destinationCardId,
    expectedVersion: 0,
    prepared,
    actorId: input.createdBy,
    checkpoint: "none",
  });
  if (result.status === "conflict") {
    throw new Error("Destination card canvas is already initialized");
  }

  const subtaskBySourceId = input.subtaskBySourceId;
  if (subtaskBySourceId) {
    for (const sourceFrame of sourceFrames) {
      if (sourceFrame.subtaskId === null) continue;
      const destinationSubtask = subtaskBySourceId.get(sourceFrame.subtaskId);
      const destinationFramePublicId = framePublicIds.get(sourceFrame.publicId);
      if (!destinationFramePublicId) {
        throw new Error("Failed to map cloned canvas frame");
      }
      if (!destinationSubtask) continue;
      const [updatedFrame] = await tx
        .update(cardCanvasFrames)
        .set({
          subtaskId: destinationSubtask.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cardCanvasFrames.canvasId, result.canvasId),
            eq(cardCanvasFrames.publicId, destinationFramePublicId),
          ),
        )
        .returning({ id: cardCanvasFrames.id });
      if (!updatedFrame) {
        throw new Error("Failed to link cloned canvas frame subtask");
      }
    }
  }

  return {
    status: "cloned" as const,
    version: result.version,
    framePublicIdBySourcePublicId: framePublicIds,
  };
}
