import { describe, expect, it, vi } from "vitest";

import {
  MAX_CARD_CANVAS_ELEMENTS,
  MAX_CARD_CANVAS_IMAGE_BYTES,
} from "@kan/shared";

import {
  createCardCanvasImageImportQueue,
  downloadCardCanvasImageUrl,
  getCardCanvasImageFiles,
  getCardCanvasNativePasteAction,
  hasCardCanvasImageDragItem,
} from "./card-canvas-image-import";

describe("card canvas image imports", () => {
  it("allows a native paste that reaches exactly 5,000 elements", () => {
    expect(
      getCardCanvasNativePasteAction({
        currentElementCount: MAX_CARD_CANVAS_ELEMENTS - 1,
        elements: [{ type: "rectangle" }],
        files: undefined,
      }),
    ).toBe("continue");
  });

  it("blocks a native paste over 5,000 elements before further processing", () => {
    const elements = [{ type: "rectangle" }];
    const inspectElements = vi.spyOn(elements, "some");
    const inspectFiles = vi.fn(() => []);
    const files = new Proxy<Record<string, unknown>>(
      {},
      { ownKeys: inspectFiles },
    );

    expect(
      getCardCanvasNativePasteAction({
        currentElementCount: MAX_CARD_CANVAS_ELEMENTS,
        elements,
        files,
      }),
    ).toBe("block");

    expect(inspectElements).not.toHaveBeenCalled();
    expect(inspectFiles).not.toHaveBeenCalled();
  });

  it("rejects embedded credentials and non-standard ports before fetch", async () => {
    const fetchImage = vi.fn();

    await expect(
      downloadCardCanvasImageUrl(
        "https://user:secret@images.example/private.png",
        fetchImage as unknown as typeof fetch,
      ),
    ).rejects.toThrow("UNSAFE_IMAGE_URL");
    await expect(
      downloadCardCanvasImageUrl(
        "https://images.example:8443/private.png",
        fetchImage as unknown as typeof fetch,
      ),
    ).rejects.toThrow("UNSAFE_IMAGE_URL");
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("rejects an oversized content-length before reading the response", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const getReader = vi.fn();
    const fetchImage = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-length": String(MAX_CARD_CANVAS_IMAGE_BYTES + 1),
        "content-type": "image/png",
      }),
      body: { cancel, getReader },
    });

    await expect(
      downloadCardCanvasImageUrl(
        "https://images.example/large.png",
        fetchImage as unknown as typeof fetch,
      ),
    ).rejects.toThrow("IMAGE_RESOURCE_TOO_LARGE");
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });

  it("cancels a chunked response as soon as its streamed body exceeds the cap", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        controller.enqueue(new Uint8Array(5 * 1024 * 1024));
      },
      cancel,
    });
    const fetchImage = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      downloadCardCanvasImageUrl(
        "https://images.example/chunked.png",
        fetchImage as unknown as typeof fetch,
      ),
    ).rejects.toThrow("IMAGE_RESOURCE_TOO_LARGE");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts the exact per-image byte limit", async () => {
    const fetchImage = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(MAX_CARD_CANVAS_IMAGE_BYTES), {
        headers: {
          "content-length": String(MAX_CARD_CANVAS_IMAGE_BYTES),
          "content-type": "image/png",
        },
      }),
    );

    const file = await downloadCardCanvasImageUrl(
      "https://images.example/exact.png",
      fetchImage as unknown as typeof fetch,
    );

    expect(file.size).toBe(MAX_CARD_CANVAS_IMAGE_BYTES);
    expect(file.type).toBe("image/png");
  });

  it("serializes imports and continues after a rejected task", async () => {
    const enqueue = createCardCanvasImageImportQueue();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = enqueue(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = enqueue(() => {
      order.push("second");
      return Promise.reject(new Error("rejected"));
    });
    const third = enqueue(() => {
      order.push("third");
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await first;
    await expect(second).rejects.toThrow("rejected");
    await third;
    expect(order).toEqual(["first:start", "first:end", "second", "third"]);
  });

  it("selects only image files from picker, paste or drop payloads", () => {
    const image = new File(["image"], "image.png", { type: "image/png" });
    const document = new File(["text"], "notes.txt", {
      type: "text/plain",
    });

    expect(getCardCanvasImageFiles([document, image])).toEqual([image]);
    expect(
      hasCardCanvasImageDragItem({
        files: [] as unknown as FileList,
        items: [
          { kind: "file", type: "image/jpeg" } as DataTransferItem,
        ] as unknown as DataTransferItemList,
      }),
    ).toBe(true);
  });
});
