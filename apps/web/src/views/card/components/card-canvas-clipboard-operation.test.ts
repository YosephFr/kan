import { describe, expect, it, vi } from "vitest";

import {
  captureCardCanvasClipboardInput,
  CardCanvasClipboardOperationGate,
  consumeCardCanvasExternalPaste,
  getCardCanvasClipboardCaptureAction,
  isCardCanvasPasteAnchorTarget,
} from "./card-canvas-clipboard-operation";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe("card canvas clipboard operation gate", () => {
  it("blocks a second tap and releases after the clipboard operation resolves", async () => {
    const gate = new CardCanvasClipboardOperationGate();
    const pending = deferred<string>();
    const read = vi.fn(() => pending.promise);

    const first = gate.run(read);
    const second = gate.run(read);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(gate.busy).toBe(true);

    pending.resolve("clipboard content");
    await expect(first).resolves.toBe("clipboard content");
    expect(gate.busy).toBe(false);
    await expect(gate.run(read)).resolves.toBe("clipboard content");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("releases after clipboard permission is rejected", async () => {
    const gate = new CardCanvasClipboardOperationGate();
    const denied = new DOMException("Not allowed", "NotAllowedError");

    await expect(gate.run(() => Promise.reject(denied))).rejects.toBe(denied);
    expect(gate.busy).toBe(false);
    await expect(gate.run(() => Promise.resolve("retry"))).resolves.toBe(
      "retry",
    );
  });

  it("blocks external native paste while busy but preserves internal and text-editing paste", () => {
    expect(
      getCardCanvasClipboardCaptureAction({
        canEdit: true,
        editingText: false,
        internal: false,
        busy: true,
      }),
    ).toBe("block");
    expect(
      getCardCanvasClipboardCaptureAction({
        canEdit: true,
        editingText: false,
        internal: true,
        busy: true,
      }),
    ).toBe("passthrough");
    expect(
      getCardCanvasClipboardCaptureAction({
        canEdit: true,
        editingText: true,
        internal: false,
        busy: true,
      }),
    ).toBe("passthrough");
  });

  it("consumes an external paste even when normalization produces no safe items", () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      nativeEvent: { stopImmediatePropagation: vi.fn() },
    };

    consumeCardCanvasExternalPaste(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.nativeEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("consumes and returns an early native clipboard limit rejection", () => {
    const event = {
      clipboardData: {
        files: Array.from(
          { length: 11 },
          (_, index) =>
            new File(["image"], `clipboard-${index}.png`, {
              type: "image/png",
            }),
        ) as unknown as FileList,
        getData: vi.fn(() => ""),
        types: [],
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      nativeEvent: { stopImmediatePropagation: vi.fn() },
    };

    const result = captureCardCanvasClipboardInput(event);

    expect(result).toHaveProperty("error");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.nativeEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("accepts paste anchors only from the interactive drawing canvas", () => {
    const canvas = {
      matches: vi.fn(
        (selector: string) =>
          selector === "canvas.excalidraw__canvas.interactive",
      ),
    } as unknown as EventTarget;
    const control = {
      matches: vi.fn(() => false),
    } as unknown as EventTarget;

    expect(isCardCanvasPasteAnchorTarget(canvas)).toBe(true);
    expect(isCardCanvasPasteAnchorTarget(control)).toBe(false);
    expect(isCardCanvasPasteAnchorTarget(null)).toBe(false);
  });
});
