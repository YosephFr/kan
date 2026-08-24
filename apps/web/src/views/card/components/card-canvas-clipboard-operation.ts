import { getCardCanvasClipboardInputFromDataTransfer } from "./card-canvas-clipboard";

export class CardCanvasClipboardOperationGate {
  private inFlight = false;

  get busy() {
    return this.inFlight;
  }

  run<T>(operation: () => Promise<T>): Promise<T> | null {
    if (this.inFlight) return null;
    this.inFlight = true;
    try {
      return operation().finally(() => {
        this.inFlight = false;
      });
    } catch (error) {
      this.inFlight = false;
      throw error;
    }
  }
}

export const getCardCanvasClipboardCaptureAction = ({
  canEdit,
  editingText,
  internal,
  busy,
}: {
  canEdit: boolean;
  editingText: boolean;
  internal: boolean;
  busy: boolean;
}) => {
  if (!canEdit || editingText || internal) return "passthrough" as const;
  return busy ? ("block" as const) : ("process" as const);
};

export const consumeCardCanvasExternalPaste = (event: {
  preventDefault: () => void;
  stopPropagation: () => void;
  nativeEvent: { stopImmediatePropagation: () => void };
}) => {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
};

export const captureCardCanvasClipboardInput = (event: {
  clipboardData: Pick<DataTransfer, "files" | "getData" | "types">;
  preventDefault: () => void;
  stopPropagation: () => void;
  nativeEvent: { stopImmediatePropagation: () => void };
}) => {
  try {
    return {
      input: getCardCanvasClipboardInputFromDataTransfer(event.clipboardData),
    } as const;
  } catch (error) {
    consumeCardCanvasExternalPaste(event);
    return { error } as const;
  }
};

export const isCardCanvasPasteAnchorTarget = (target: EventTarget | null) => {
  const candidate = target as {
    matches?: (selector: string) => boolean;
  } | null;
  return candidate?.matches?.("canvas.excalidraw__canvas.interactive") === true;
};

export const resolveCardCanvasPublicPasteDecision = <T>({
  approved,
  pending,
  busy,
  apply,
  clear,
}: {
  approved: boolean;
  pending: T | null;
  busy: boolean;
  apply: (pending: T, publicVisibilityAcknowledged: true) => Promise<void>;
  clear: () => void;
}) => {
  if (!pending) return null;
  if (!approved) {
    clear();
    return null;
  }
  if (busy) return null;
  const operation = apply(pending, true);
  void operation.finally(clear);
  return operation;
};
