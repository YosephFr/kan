import type {
  CardCanvasScene,
  CardCanvasWorkerRequest,
  CardCanvasWorkerResponse,
  NormalizedCardCanvas,
} from "./card-canvas-types";

export class CardCanvasNormalizationError extends Error {
  constructor(
    readonly code: Exclude<
      CardCanvasWorkerResponse,
      NormalizedCardCanvas
    >["error"],
  ) {
    super(code);
    this.name = "CardCanvasNormalizationError";
  }
}

export class CardCanvasNormalizer {
  private readonly worker: Worker;
  private requestId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: NormalizedCardCanvas) => void;
      reject: (reason: CardCanvasNormalizationError) => void;
    }
  >();

  constructor() {
    this.worker = new Worker(
      new URL("./card-canvas-normalize.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.addEventListener(
      "message",
      (event: MessageEvent<CardCanvasWorkerResponse>) => {
        const request = this.pending.get(event.data.requestId);
        if (!request) return;
        this.pending.delete(event.data.requestId);
        if ("error" in event.data) {
          request.reject(new CardCanvasNormalizationError(event.data.error));
        } else {
          request.resolve(event.data);
        }
      },
    );
    this.worker.addEventListener("error", () => {
      for (const request of this.pending.values()) {
        request.reject(
          new CardCanvasNormalizationError("NORMALIZATION_FAILED"),
        );
      }
      this.pending.clear();
    });
  }

  normalize(scene: CardCanvasScene) {
    const requestId = ++this.requestId;
    return new Promise<NormalizedCardCanvas>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const message: CardCanvasWorkerRequest = { requestId, scene };
      this.worker.postMessage(message);
    });
  }

  dispose() {
    this.worker.terminate();
    for (const request of this.pending.values()) {
      request.reject(new CardCanvasNormalizationError("NORMALIZATION_FAILED"));
    }
    this.pending.clear();
  }
}
