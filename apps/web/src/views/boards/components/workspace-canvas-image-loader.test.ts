import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  WorkspaceCanvasImageResource,
  WorkspaceCanvasImageViewportSnapshot,
} from "./workspace-canvas-image-loader";
import {
  addWorkspaceCanvasImageBlob,
  assertWorkspaceCanvasExportCapacity,
  chunkWorkspaceCanvasImagePublicIds,
  createWorkspaceCanvasImageViewportScheduler,
  fitWorkspaceCanvasImageDimensions,
  hydrateWorkspaceCanvasImage,
  hydrateWorkspaceCanvasImageWithMetadataRefresh,
  loadWorkspaceCanvasImageFile,
  prioritizeWorkspaceCanvasImageMetadata,
  prioritizeWorkspaceCanvasImagePublicIds,
  runWorkspaceCanvasImageQueue,
} from "./workspace-canvas-image-loader";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn(),
}));

const imageElement = (publicId: string, y: number) =>
  ({
    id: publicId,
    type: "image",
    x: 0,
    y,
    width: 200,
    height: 200,
    isDeleted: false,
    customData: { kanResourcePublicId: publicId },
  }) as unknown as ExcalidrawElement;

const resource = (publicId = "image0000001") =>
  ({
    kind: "upload",
    publicId,
    title: "goal.webp",
    originalFilename: "goal.png",
    contentType: "image/webp",
    size: 4,
    width: 100,
    height: 80,
    optimizedAt: new Date(0),
    viewUrl: `/api/workspace-canvas-images/${publicId}`,
    downloadUrl: `/api/workspace-canvas-images/${publicId}`,
    createdAt: new Date(0),
  }) satisfies WorkspaceCanvasImageResource;

afterEach(() => vi.unstubAllGlobals());

describe("workspace canvas image loader", () => {
  it("chunks 51 metadata ids without exceeding the transport limit", () => {
    const chunks = chunkWorkspaceCanvasImagePublicIds(
      Array.from({ length: 51 }, (_, index) => `image${index}`),
    );
    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 1]);
  });

  it("puts visible metadata in the first batch even when it is last in the scene", () => {
    const ids = Array.from({ length: 51 }, (_, index) => `image${index}`);
    const visibleId = ids.at(-1) ?? "";
    const ordered = prioritizeWorkspaceCanvasImageMetadata({
      publicIds: ids,
      nearPublicIds: [visibleId],
    });
    const chunks = chunkWorkspaceCanvasImagePublicIds(ordered);
    expect(chunks[0]?.[0]).toBe(visibleId);
    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 1]);
  });

  it("loads visible images before nearby ones and leaves distant images pending", () => {
    const visible = "visible00001";
    const nearby = "nearby000001";
    const distant = "distant00001";
    const ordered = prioritizeWorkspaceCanvasImagePublicIds({
      publicIds: [distant, nearby, visible],
      elements: [
        imageElement(distant, 3_000),
        imageElement(nearby, 900),
        imageElement(visible, 100),
      ],
      appState: {
        width: 1_000,
        height: 800,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 as never },
      },
      includeFar: false,
    });
    expect(ordered).toEqual([visible, nearby]);
  });

  it("keeps the best priority when one resource has visible and distant elements", () => {
    const duplicated = "duplicate001";
    const ordered = prioritizeWorkspaceCanvasImagePublicIds({
      publicIds: [duplicated],
      elements: [
        imageElement(duplicated, 100),
        imageElement(duplicated, 3_000),
      ],
      appState: {
        width: 1_000,
        height: 800,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 as never },
      },
      includeFar: false,
    });

    expect(ordered).toEqual([duplicated]);
  });

  it("bounds display previews to 320 pixels for large image collections", () => {
    expect(fitWorkspaceCanvasImageDimensions(1_280, 960)).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("never exceeds three concurrent image operations", async () => {
    let active = 0;
    let peak = 0;
    await runWorkspaceCanvasImageQueue({
      items: Array.from({ length: 12 }, (_, index) => index),
      worker: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      },
    });
    expect(peak).toBe(3);
  });

  it("coalesces viewport bursts into one frame using the latest camera", () => {
    const callbacks: FrameRequestCallback[] = [];
    const onFrame = vi.fn(
      (_snapshot: WorkspaceCanvasImageViewportSnapshot) => undefined,
    );
    const scheduler = createWorkspaceCanvasImageViewportScheduler({
      onFrame,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame: vi.fn(),
    });
    const elements: ExcalidrawElement[] = [];
    for (let index = 0; index < 100; index += 1) {
      scheduler.schedule({
        elements,
        appState: { scrollY: index } as AppState,
      });
    }

    expect(callbacks).toHaveLength(1);
    callbacks[0]?.(0);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0]?.[0].appState.scrollY).toBe(99);
  });

  it("isolates one failed image and continues the remaining queue", async () => {
    const result = await runWorkspaceCanvasImageQueue({
      items: [1, 2, 3, 4],
      worker: (item) =>
        item === 2 ? Promise.reject(new Error("broken")) : Promise.resolve(),
    });
    expect(result.completed.sort()).toEqual([1, 3, 4]);
    expect(result.failed.map(({ item }) => item)).toEqual([2]);
  });

  it("stops reporting work after its workspace signal is cancelled", async () => {
    const controller = new AbortController();
    const settled = vi.fn();
    const result = await runWorkspaceCanvasImageQueue({
      items: [1, 2, 3],
      signal: controller.signal,
      worker: () => {
        controller.abort();
        return Promise.resolve();
      },
      onSettled: settled,
    });
    expect(result).toEqual({ completed: [], failed: [] });
    expect(settled).not.toHaveBeenCalled();
  });

  it("skips the network when Excalidraw already has the image file", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const api = {
      getFiles: () => ({
        image0000001: { dataURL: "data:image/webp;base64,AA==" },
      }),
    } as unknown as ExcalidrawImperativeAPI;
    await expect(
      hydrateWorkspaceCanvasImage({ api, resource: resource() }),
    ).resolves.toEqual({ width: 100, height: 80 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a local optimized WebP without downloading it again", async () => {
    class TestFileReader extends EventTarget {
      result: string | ArrayBuffer | null = null;

      readAsDataURL(blob: Blob) {
        this.result = `data:${blob.type};base64,d2VicA==`;
        this.dispatchEvent(new Event("load"));
      }

      abort() {
        this.dispatchEvent(new Event("abort"));
      }
    }
    const fetchMock = vi.fn();
    const addFiles = vi.fn();
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal("fetch", fetchMock);
    const api = { addFiles } as unknown as ExcalidrawImperativeAPI;

    await addWorkspaceCanvasImageBlob({
      api,
      resource: resource(),
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], {
        type: "image/webp",
      }),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(addFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "image0000001",
        mimeType: "image/webp",
        dataURL: "data:image/webp;base64,d2VicA==",
      }),
    ]);
  });

  it("does not add a file when cancellation follows data URL conversion", async () => {
    const controller = new AbortController();
    class TestFileReader extends EventTarget {
      result: string | ArrayBuffer | null = null;

      readAsDataURL(blob: Blob) {
        this.result = `data:${blob.type};base64,d2VicA==`;
        this.dispatchEvent(new Event("load"));
        controller.abort();
      }

      abort() {
        this.dispatchEvent(new Event("abort"));
      }
    }
    const addFiles = vi.fn();
    vi.stubGlobal("FileReader", TestFileReader);
    const api = { addFiles } as unknown as ExcalidrawImperativeAPI;

    await expect(
      addWorkspaceCanvasImageBlob({
        api,
        resource: resource(),
        blob: new Blob([new Uint8Array([1, 2, 3, 4])], {
          type: "image/webp",
        }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(addFiles).not.toHaveBeenCalled();
  });

  it("loads the canonical export image without retaining it in Excalidraw", async () => {
    class TestFileReader extends EventTarget {
      result: string | ArrayBuffer | null = null;

      readAsDataURL(blob: Blob) {
        this.result = `data:${blob.type};base64,d2VicA==`;
        this.dispatchEvent(new Event("load"));
      }

      abort() {
        this.dispatchEvent(new Event("abort"));
      }
    }
    const addFiles = vi.fn();
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() =>
        Promise.resolve({
          width: 100,
          height: 80,
          close: vi.fn(),
        } as ImageBitmap),
      ),
    );
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: BlobCallback, contentType: string) =>
          callback(new Blob([new Uint8Array([1])], { type: contentType })),
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: {
              "content-length": "4",
              "content-type": "image/webp",
            },
          }),
        ),
      ),
    );

    await expect(
      loadWorkspaceCanvasImageFile({ resource: resource() }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "image0000001",
        mimeType: "image/webp",
        dataURL: "data:image/webp;base64,d2VicA==",
      }),
    );
    expect(addFiles).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("rejects an export before fetching images that exceed the decode budget", () => {
    const resources = Array.from({ length: 11 }, (_, index) => ({
      ...resource(`image${String(index).padStart(7, "0")}`),
      width: 1_280,
      height: 1_280,
    }));
    expect(() =>
      assertWorkspaceCanvasExportCapacity(resources.slice(0, 10)),
    ).not.toThrow();
    expect(() => assertWorkspaceCanvasExportCapacity(resources)).toThrow(
      "WORKSPACE_CANVAS_EXPORT_MEMORY_LIMIT",
    );
  });

  it("downscales a legacy reload before adding it to Excalidraw", async () => {
    class TestFileReader extends EventTarget {
      result: string | ArrayBuffer | null = null;

      readAsDataURL(blob: Blob) {
        this.result = `data:${blob.type};base64,d2VicA==`;
        this.dispatchEvent(new Event("load"));
      }

      abort() {
        this.dispatchEvent(new Event("abort"));
      }
    }
    const source = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: "image/png",
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback, contentType: string) =>
        callback(new Blob([new Uint8Array([1])], { type: contentType })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(source, {
            status: 200,
            headers: { "content-length": String(source.size) },
          }),
        ),
      ),
    );
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() =>
        Promise.resolve({
          width: 100,
          height: 80,
          close: vi.fn(),
        } as ImageBitmap),
      ),
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    const addFiles = vi.fn();
    const api = {
      getFiles: () => ({}),
      addFiles,
    } as unknown as ExcalidrawImperativeAPI;

    await hydrateWorkspaceCanvasImage({
      api,
      resource: {
        ...resource(),
        contentType: "image/png",
        size: source.size,
        optimizedAt: null,
      },
    });

    expect(addFiles).toHaveBeenCalledWith([
      expect.objectContaining({ mimeType: "image/webp" }),
    ]);
  });

  it("refreshes metadata once when a backfill changes bytes under the same public id", async () => {
    class TestFileReader extends EventTarget {
      result: string | ArrayBuffer | null = null;

      readAsDataURL(blob: Blob) {
        this.result = `data:${blob.type};base64,d2VicA==`;
        this.dispatchEvent(new Event("load"));
      }

      abort() {
        this.dispatchEvent(new Event("abort"));
      }
    }
    const source = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(source, {
          status: 200,
          headers: {
            "content-length": "4",
            "content-type": "image/webp",
          },
        }),
      ),
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback, contentType: string) =>
        callback(new Blob([source], { type: contentType })),
    };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() =>
        Promise.resolve({
          width: 100,
          height: 80,
          close: vi.fn(),
        } as ImageBitmap),
      ),
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    const addFiles = vi.fn();
    const api = {
      getFiles: () => ({}),
      addFiles,
    } as unknown as ExcalidrawImperativeAPI;
    const refreshResource = vi.fn(() => Promise.resolve(resource()));

    await hydrateWorkspaceCanvasImageWithMetadataRefresh({
      api,
      resource: {
        ...resource(),
        contentType: "image/png",
        optimizedAt: null,
      },
      refreshResource,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshResource).toHaveBeenCalledTimes(1);
    expect(addFiles).toHaveBeenCalledTimes(1);
  });
});
