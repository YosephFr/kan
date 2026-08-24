import { describe, expect, it, vi } from "vitest";

import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import type { CardCanvasClipboardItem } from "./card-canvas-clipboard";
import type { CardResource } from "./card-resource-types";
import { resolveCardCanvasPublicPasteDecision } from "./card-canvas-clipboard-operation";
import { resolveCardCanvasClipboardItems } from "./card-canvas-clipboard-resolve";

const webResource = (publicId: string): CardResource => ({
  kind: "web",
  publicId,
  title: "Reference",
  openUrl: "https://example.com/reference",
  description: null,
  siteName: "Example",
  previewImageUrl: null,
  createdAt: new Date(0),
});

const imageResource = (publicId: string, size: number): CardResource => ({
  kind: "upload",
  publicId,
  title: "Clipboard image",
  originalFilename: "clipboard.png",
  contentType: "image/png",
  size,
  viewUrl: `/api/resources/${publicId}/view`,
  downloadUrl: `/api/resources/${publicId}/download`,
  createdAt: new Date(0),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const items: CardCanvasClipboardItem[] = [
  { type: "text", text: "First idea" },
  { type: "link", url: "https://example.com/one" },
  { type: "text", text: "Second idea" },
  { type: "link", url: "https://example.com/two" },
];

describe("card canvas clipboard resolution", () => {
  it("keeps source order, skips failed resources and forwards one public acknowledgement", async () => {
    const resolveResource = vi
      .fn()
      .mockResolvedValueOnce(webResource("resource0001"))
      .mockRejectedValueOnce(new Error("safe import failed"));

    const result = await resolveCardCanvasClipboardItems({
      items,
      online: true,
      publicVisibilityAcknowledged: true,
      resolveResource,
    });

    expect(result).toEqual({
      items: [
        { kind: "text", text: "First idea" },
        { kind: "resource", resource: webResource("resource0001") },
        { kind: "text", text: "Second idea" },
      ],
      skipped: 1,
      cancelled: false,
    });
    expect(resolveResource).toHaveBeenNthCalledWith(1, items[1], true);
    expect(resolveResource).toHaveBeenNthCalledWith(2, items[3], true);
  });

  it("keeps editable text offline without starting resource work", async () => {
    const resolveResource = vi.fn();

    await expect(
      resolveCardCanvasClipboardItems({
        items,
        online: false,
        resolveResource,
      }),
    ).resolves.toEqual({
      items: [
        { kind: "text", text: "First idea" },
        { kind: "text", text: "Second idea" },
      ],
      skipped: 2,
      cancelled: false,
    });
    expect(resolveResource).not.toHaveBeenCalled();
  });

  it("stops resource work when the card surface is unmounted", async () => {
    const resolveResource = vi.fn();

    await expect(
      resolveCardCanvasClipboardItems({
        items,
        online: true,
        resolveResource,
        shouldContinue: () => false,
      }),
    ).resolves.toEqual({ items: [], skipped: 0, cancelled: true });
    expect(resolveResource).not.toHaveBeenCalled();
  });

  it("stops after a pending import resolves on an unmounted card surface", async () => {
    const pending = deferred<CardResource>();
    let mounted = true;
    const resolveResource = vi.fn(() => pending.promise);
    const operation = resolveCardCanvasClipboardItems({
      items,
      online: true,
      resolveResource,
      shouldContinue: () => mounted,
    });

    expect(resolveResource).toHaveBeenCalledOnce();
    mounted = false;
    pending.resolve(webResource("resource0001"));

    await expect(operation).resolves.toEqual({
      items: [],
      skipped: 0,
      cancelled: true,
    });
    expect(resolveResource).toHaveBeenCalledOnce();
  });

  it("stops resolving remote images as soon as their aggregate budget is exceeded", async () => {
    const remoteItems: CardCanvasClipboardItem[] = Array.from(
      { length: 4 },
      (_, index) => ({
        type: "image" as const,
        source: "url" as const,
        url: `https://example.com/image-${index + 1}.png`,
      }),
    );
    const resolveResource = vi
      .fn()
      .mockResolvedValueOnce(
        imageResource("resource0001", MAX_CARD_CANVAS_IMAGE_BYTES),
      )
      .mockResolvedValueOnce(
        imageResource("resource0002", MAX_CARD_CANVAS_IMAGE_BYTES),
      )
      .mockResolvedValueOnce(imageResource("resource0003", 1))
      .mockResolvedValueOnce(imageResource("resource0004", 1));

    await expect(
      resolveCardCanvasClipboardItems({
        items: remoteItems,
        online: true,
        resolveResource,
        validateResolvedItems: (resolved) => {
          const bytes = resolved.reduce(
            (total, item) =>
              total +
              (item.kind === "resource" && item.resource.kind === "upload"
                ? item.resource.size
                : 0),
            0,
          );
          if (bytes > MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES) {
            throw new Error("IMAGE_RESOURCE_BUDGET_EXCEEDED");
          }
        },
      }),
    ).rejects.toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
    expect(resolveResource).toHaveBeenCalledTimes(3);
    expect(resolveResource).not.toHaveBeenCalledWith(remoteItems[3], undefined);
    expect(MAX_CARD_CANVAS_IMAGE_BYTES * 2).toBe(
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
    );
  });

  it("cancels a public paste without resolving or inserting anything", () => {
    const resolveResource = vi.fn();
    const insertBatch = vi.fn();
    const clear = vi.fn();
    const apply = vi.fn(async () => {
      await resolveResource();
      await insertBatch();
    });

    expect(
      resolveCardCanvasPublicPasteDecision({
        approved: false,
        pending: {
          result: { items: [], counts: { objects: 0, images: 0, links: 0 } },
        },
        busy: false,
        apply,
        clear,
      }),
    ).toBeNull();
    expect(clear).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(resolveResource).not.toHaveBeenCalled();
    expect(insertBatch).not.toHaveBeenCalled();
  });

  it("applies an approved public paste once with one acknowledgement", async () => {
    const pending = { id: "paste-1" };
    const clear = vi.fn();
    const apply = vi.fn(() => Promise.resolve());

    await expect(
      resolveCardCanvasPublicPasteDecision({
        approved: true,
        pending,
        busy: false,
        apply,
        clear,
      }),
    ).resolves.toBeUndefined();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(pending, true);
    expect(clear).toHaveBeenCalledOnce();
  });
});
