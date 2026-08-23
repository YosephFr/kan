import {
  canonicalizeCardCanvasScene,
  CardCanvasSceneError,
  getCardCanvasSceneBytes,
  hashCardCanvasScene,
  normalizeCardCanvasScene,
} from "@kan/shared";

import type {
  CardCanvasWorkerRequest,
  CardCanvasWorkerResponse,
} from "./card-canvas-types";

const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<CardCanvasWorkerRequest>) => void,
  ) => void;
  postMessage: (message: CardCanvasWorkerResponse) => void;
};

workerScope.addEventListener("message", (event) => {
  const { requestId, scene } = event.data;
  void (async () => {
    const normalized = normalizeCardCanvasScene(scene);
    workerScope.postMessage({
      requestId,
      scene: normalized,
      serialized: canonicalizeCardCanvasScene(normalized),
      hash: await hashCardCanvasScene(normalized),
      bytes: getCardCanvasSceneBytes(normalized),
      elementCount: normalized.elements.length,
      errors: [],
    });
  })().catch((error: unknown) => {
    workerScope.postMessage({
      requestId,
      error:
        error instanceof CardCanvasSceneError
          ? error.code
          : "NORMALIZATION_FAILED",
    });
  });
});

export {};
