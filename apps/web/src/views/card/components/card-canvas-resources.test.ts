import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CARD_CANVAS_ELEMENTS,
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import type {
  UploadCardResource,
  WebCardResource,
} from "./card-resource-types";
import {
  assertCardCanvasImageResourceBudget,
  hydrateCardCanvasImage,
  hydrateCardCanvasImages,
  insertCardCanvasResource,
  parseCardCanvasImageDimensions,
  preflightCardCanvasImageFile,
} from "./card-canvas-resources";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn(),
}));

const makePngHeader = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const makeResource = (publicId: string, size: number): UploadCardResource => ({
  kind: "upload",
  publicId,
  title: `${publicId}.png`,
  originalFilename: `${publicId}.png`,
  contentType: "image/png",
  size,
  viewUrl: `/api/attachments/${publicId}/view`,
  downloadUrl: `/api/attachments/${publicId}/download`,
  createdAt: new Date(0),
});

const makePngFile = (width: number, height: number, size: number) =>
  new File(
    [makePngHeader(width, height), new Uint8Array(size - 24)],
    "whiteboard.png",
    { type: "image/png" },
  );

const makeCanvasApi = (resources: UploadCardResource[]) =>
  ({
    getSceneElements: () =>
      resources.map((resource) => ({
        id: resource.publicId,
        type: "image",
        customData: { kanResourcePublicId: resource.publicId },
      })),
  }) as unknown as ExcalidrawImperativeAPI;

const deferExistingImageLoad = () => {
  let release: (() => void) | undefined;
  class DeferredImage {
    naturalWidth = 100;
    naturalHeight = 80;

    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      if (type !== "load") return;
      release = () => {
        const event = new Event("load");
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      };
    }

    set src(value: string) {
      void value;
    }
  }
  vi.stubGlobal("Image", DeferredImage);
  return () => {
    if (!release) throw new Error("IMAGE_LOAD_NOT_STARTED");
    release();
  };
};

const makeDeferredInsertionApi = (
  elements: {
    id: string;
    type: string;
    isDeleted?: boolean;
    customData?: { kanResourcePublicId: string };
  }[],
  candidate: UploadCardResource,
) => {
  const updateScene = vi.fn();
  const api = {
    getSceneElements: () => elements,
    getFiles: () => ({
      [candidate.publicId]: { dataURL: "data:image/png;base64,AA==" },
    }),
    getAppState: () => ({
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
      width: 1000,
      height: 800,
    }),
    updateScene,
    scrollToContent: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("card canvas image resources", () => {
  it("parses dimensions without decoding the image", () => {
    expect(
      parseCardCanvasImageDimensions("image/png", makePngHeader(640, 480)),
    ).toEqual({ width: 640, height: 480 });
  });

  it("rejects unsafe dimensions before decoding", async () => {
    const header = makePngHeader(8192, 8192);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Blob([header], { type: "image/png" }), {
            status: 200,
            headers: { "content-length": String(header.byteLength) },
          }),
        ),
      ),
    );
    const api = { getFiles: () => ({}) } as unknown as ExcalidrawImperativeAPI;

    await expect(
      hydrateCardCanvasImage(
        api,
        makeResource("resource0001", header.byteLength),
      ),
    ).rejects.toThrow("IMAGE_RESOURCE_DIMENSIONS_UNSAFE");
  });

  it("rejects an aggregate budget before fetching any image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resources = [
      makeResource("resource0001", MAX_CARD_CANVAS_IMAGE_BYTES - 1),
      makeResource("resource0002", MAX_CARD_CANVAS_IMAGE_BYTES - 1),
      makeResource("resource0003", MAX_CARD_CANVAS_IMAGE_BYTES - 1),
    ];
    const api = {
      getSceneElements: () =>
        resources.map((resource) => ({
          id: resource.publicId,
          type: "image",
          customData: { kanResourcePublicId: resource.publicId },
        })),
    } as unknown as ExcalidrawImperativeAPI;

    await expect(hydrateCardCanvasImages(api, resources)).rejects.toThrow(
      "IMAGE_RESOURCE_BUDGET_EXCEEDED",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the exact upload, dimension, pixel, and aggregate limits", async () => {
    const existing = [
      makeResource(
        "resource0001",
        MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES - MAX_CARD_CANVAS_IMAGE_BYTES,
      ),
    ];

    await expect(
      preflightCardCanvasImageFile({
        file: makePngFile(8192, 2048, MAX_CARD_CANVAS_IMAGE_BYTES),
        contentType: "image/png",
        api: makeCanvasApi(existing),
        resources: existing,
      }),
    ).resolves.toEqual({ width: 8192, height: 2048 });
  });

  it("allows adding the fiftieth distinct canvas image", async () => {
    const existing = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES - 1 },
      (_, index) => makeResource(`image${String(index).padStart(7, "0")}`, 1),
    );

    await expect(
      preflightCardCanvasImageFile({
        file: makePngFile(1, 1, 24),
        contentType: "image/png",
        api: makeCanvasApi(existing),
        resources: existing,
      }),
    ).resolves.toEqual({ width: 1, height: 1 });
  });

  it("revalidates the current scene immediately before an image insertion", () => {
    const current = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES },
      (_, index) => makeResource(`image${String(index).padStart(7, "0")}`, 1),
    );
    const candidate = makeResource("candidate001", 1);

    expect(() =>
      assertCardCanvasImageResourceBudget({
        elements: makeCanvasApi(current).getSceneElements(),
        resources: current,
        candidates: [candidate],
      }),
    ).toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  });

  it("rejects a direct image that becomes the fifty-first while hydration waits", async () => {
    const releaseImage = deferExistingImageLoad();
    vi.mocked(convertToExcalidrawElements).mockReturnValue([
      { id: "candidate-element", type: "image" } as never,
    ]);
    const existing = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES - 1 },
      (_, index) => makeResource(`image${String(index).padStart(7, "0")}`, 1),
    );
    const concurrent = makeResource("concurrent01", 1);
    const candidate = makeResource("candidate001", 1);
    const elements = existing.map((resource) => ({
      id: resource.publicId,
      type: "image",
      isDeleted: false,
      customData: { kanResourcePublicId: resource.publicId },
    }));
    const { api, updateScene } = makeDeferredInsertionApi(elements, candidate);

    const insertion = insertCardCanvasResource(api, candidate, [
      ...existing,
      concurrent,
      candidate,
    ]);
    await Promise.resolve();
    elements.push({
      id: concurrent.publicId,
      type: "image",
      isDeleted: false,
      customData: { kanResourcePublicId: concurrent.publicId },
    });
    releaseImage();

    await expect(insertion).rejects.toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("rejects a direct resource when another element fills slot 5,000 during hydration", async () => {
    const releaseImage = deferExistingImageLoad();
    vi.mocked(convertToExcalidrawElements).mockReturnValue([
      { id: "candidate-element", type: "image" } as never,
    ]);
    const candidate = makeResource("candidate001", 1);
    const elements = Array.from(
      { length: MAX_CARD_CANVAS_ELEMENTS - 1 },
      (_, index) => ({ id: `element-${index}`, type: "rectangle" }),
    );
    const { api, updateScene } = makeDeferredInsertionApi(elements, candidate);

    const insertion = insertCardCanvasResource(api, candidate, [candidate]);
    await Promise.resolve();
    elements.push({ id: "concurrent-element", type: "rectangle" });
    releaseImage();

    await expect(insertion).rejects.toThrow(
      "CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED",
    );
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("allows a final image budget exactly at fifty resources and 20 MiB", () => {
    const current = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES - 1 },
      (_, index) => makeResource(`image${String(index).padStart(7, "0")}`, 1),
    );
    current[0] = makeResource("image0000000", MAX_CARD_CANVAS_IMAGE_BYTES);
    current[1] = makeResource(
      "image0000001",
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES -
        MAX_CARD_CANVAS_IMAGE_BYTES -
        (current.length - 1),
    );
    const candidate = makeResource("candidate001", 1);

    expect(() =>
      assertCardCanvasImageResourceBudget({
        elements: makeCanvasApi(current).getSceneElements(),
        resources: current,
        candidates: [candidate],
      }),
    ).not.toThrow();
  });

  it("rejects an oversized file before reading its header or scene", async () => {
    const sceneSpy = vi.fn();
    const file = makePngFile(1, 1, MAX_CARD_CANVAS_IMAGE_BYTES + 1);
    const sliceSpy = vi.spyOn(file, "slice");

    await expect(
      preflightCardCanvasImageFile({
        file,
        contentType: "image/png",
        api: {
          getSceneElements: sceneSpy,
        } as unknown as ExcalidrawImperativeAPI,
        resources: [],
      }),
    ).rejects.toThrow("IMAGE_RESOURCE_TOO_LARGE");
    expect(sliceSpy).not.toHaveBeenCalled();
    expect(sceneSpy).not.toHaveBeenCalled();
  });

  it("rejects unsafe dimensions before checking the resource budget", async () => {
    const sceneSpy = vi.fn();

    await expect(
      preflightCardCanvasImageFile({
        file: makePngFile(8192, 2049, 24),
        contentType: "image/png",
        api: {
          getSceneElements: sceneSpy,
        } as unknown as ExcalidrawImperativeAPI,
        resources: [],
      }),
    ).rejects.toThrow("IMAGE_RESOURCE_DIMENSIONS_UNSAFE");
    expect(sceneSpy).not.toHaveBeenCalled();
  });

  it("rejects a dimension above 8192 before checking the resource budget", async () => {
    const sceneSpy = vi.fn();

    await expect(
      preflightCardCanvasImageFile({
        file: makePngFile(8193, 1, 24),
        contentType: "image/png",
        api: {
          getSceneElements: sceneSpy,
        } as unknown as ExcalidrawImperativeAPI,
        resources: [],
      }),
    ).rejects.toThrow("IMAGE_RESOURCE_DIMENSIONS_UNSAFE");
    expect(sceneSpy).not.toHaveBeenCalled();
  });

  it("rejects the fifty-first distinct canvas image", async () => {
    const existing = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES },
      (_, index) => makeResource(`image${String(index).padStart(7, "0")}`, 1),
    );

    await expect(
      preflightCardCanvasImageFile({
        file: makePngFile(1, 1, 24),
        contentType: "image/png",
        api: makeCanvasApi(existing),
        resources: existing,
      }),
    ).rejects.toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  });

  it("rejects an aggregate image byte above 20 MiB", async () => {
    const existing = [
      makeResource(
        "resource0001",
        MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES - MAX_CARD_CANVAS_IMAGE_BYTES + 1,
      ),
    ];

    await expect(
      preflightCardCanvasImageFile({
        file: makePngFile(1, 1, MAX_CARD_CANVAS_IMAGE_BYTES),
        contentType: "image/png",
        api: makeCanvasApi(existing),
        resources: existing,
      }),
    ).rejects.toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  });

  it("stores only the internal resource identifier in a web card element", async () => {
    vi.mocked(convertToExcalidrawElements).mockReturnValue([
      { id: "element-1", type: "rectangle" } as never,
    ]);
    const updateScene = vi.fn((update: unknown) => update);
    const api = {
      getAppState: () => ({
        zoom: { value: 1 },
        scrollX: 0,
        scrollY: 0,
        width: 1000,
        height: 800,
      }),
      getSceneElements: () => [],
      updateScene,
      scrollToContent: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI;
    const webResource: WebCardResource = {
      kind: "web",
      publicId: "resource0001",
      title: "Private planning reference",
      openUrl: "https://example.com/private?secret=marker",
      description: "Private metadata marker",
      siteName: "Example",
      previewImageUrl: "/api/resources/resource0001/preview-image",
      createdAt: new Date(0),
    };

    await insertCardCanvasResource(api, webResource);

    const sceneUpdate = updateScene.mock.calls[0]?.[0] as {
      elements: {
        type: string;
        link?: string;
        customData?: { kanResourcePublicId?: string };
      }[];
    };
    expect(sceneUpdate.elements.at(-1)).toMatchObject({
      type: "embeddable",
      link: "kan-resource:resource0001",
      customData: { kanResourcePublicId: "resource0001" },
    });
    expect(JSON.stringify(sceneUpdate)).not.toContain(webResource.openUrl);
    expect(JSON.stringify(sceneUpdate)).not.toContain(webResource.title);
    expect(JSON.stringify(sceneUpdate)).not.toContain(webResource.description);
  });
});
