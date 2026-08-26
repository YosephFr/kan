import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CARD_CANVAS_ELEMENTS,
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import type { CardCanvasPasteBatchItem } from "./card-canvas-paste-batch";
import type * as CardCanvasResourcesModule from "./card-canvas-resources";
import type { CardResource, UploadCardResource } from "./card-resource-types";
import {
  assertCardCanvasPasteBatchBudget,
  assertCardCanvasPasteInputBudget,
  CARD_CANVAS_PASTE_GAP,
  getCardCanvasPasteViewport,
  insertCardCanvasPasteBatch,
  layoutCardCanvasPasteElements,
} from "./card-canvas-paste-batch";
import { hydrateCardCanvasImage } from "./card-canvas-resources";

const mocks = vi.hoisted(() => ({ nextElementId: 0 }));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn(
    (skeletons: { type: string; width?: number; height?: number }[]) =>
      skeletons.map((skeleton) => ({
        ...skeleton,
        id: `element-${++mocks.nextElementId}`,
        width: skeleton.width ?? 120,
        height: skeleton.height ?? 48,
        isDeleted: false,
      })),
  ),
}));

vi.mock("./card-canvas-resources", async (importOriginal) => ({
  ...(await importOriginal<typeof CardCanvasResourcesModule>()),
  hydrateCardCanvasImage: vi.fn(),
}));

const makeImageResource = (
  publicId: string,
  size: number,
): UploadCardResource => ({
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

const makeWebResource = (publicId: string) =>
  ({
    kind: "web",
    publicId,
    title: "Private planning reference",
    openUrl: "https://example.com/private?secret=marker",
    description: "Private metadata marker",
    siteName: "Example",
    previewImageUrl: `/api/resources/${publicId}/preview-image`,
    createdAt: new Date(0),
  }) as Extract<CardResource, { kind: "web" }>;

const makeDriveResource = (publicId: string) =>
  ({
    kind: "drive",
    publicId,
    title: "Private Drive plan",
    openUrl: "https://drive.google.com/private-marker",
    createdAt: new Date(0),
  }) as Extract<CardResource, { kind: "drive" }>;

const makeSceneImage = (publicId: string) =>
  ({
    id: `scene-${publicId}`,
    type: "image",
    isDeleted: false,
    customData: { kanResourcePublicId: publicId },
  }) as unknown as ExcalidrawElement;

const makeApi = ({
  elements = [],
  getSceneElements,
}: {
  elements?: ExcalidrawElement[];
  getSceneElements?: () => readonly ExcalidrawElement[];
} = {}) => {
  const updateScene = vi.fn();
  const setActiveTool = vi.fn();
  return {
    api: {
      getSceneElements: getSceneElements ?? (() => elements),
      getAppState: () => ({
        zoom: { value: 1 },
        scrollX: 0,
        scrollY: 0,
        width: 700,
        height: 500,
      }),
      updateScene,
      setActiveTool,
    } as unknown as ExcalidrawImperativeAPI,
    setActiveTool,
    updateScene,
  };
};

const overlaps = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

beforeEach(() => {
  mocks.nextElementId = 0;
  vi.clearAllMocks();
});

describe("card canvas paste layout", () => {
  it("converts the visible viewport from zoom and scroll", () => {
    expect(
      getCardCanvasPasteViewport({
        zoom: { value: 2 } as never,
        scrollX: -100,
        scrollY: -40,
        width: 800,
        height: 600,
      }),
    ).toEqual({ left: 100, top: 40, width: 400, height: 300 });
  });

  it("wraps rows at the visible width with a 24px non-overlap gap", () => {
    const positioned = layoutCardCanvasPasteElements(
      Array.from({ length: 3 }, (_, index) => ({
        id: String(index),
        x: 0,
        y: 0,
        width: 300,
        height: 168,
      })),
      { left: 0, top: 0, width: 700, height: 500 },
    );

    expect(positioned[0]?.y).toBe(positioned[1]?.y);
    expect(positioned[2]?.y).toBeGreaterThan((positioned[0]?.y ?? 0) + 168);
    expect((positioned[1]?.x ?? 0) - (positioned[0]?.x ?? 0) - 300).toBe(
      CARD_CANVAS_PASTE_GAP,
    );
    positioned.forEach((element, index) => {
      positioned.slice(index + 1).forEach((other) => {
        expect(overlaps(element, other)).toBe(false);
      });
      expect(element.x).toBeGreaterThanOrEqual(CARD_CANVAS_PASTE_GAP);
      expect(element.x + element.width).toBeLessThanOrEqual(
        700 - CARD_CANVAS_PASTE_GAP,
      );
    });
  });

  it("keeps a valid touch anchor nearby and clamps the batch to the viewport", () => {
    const positioned = layoutCardCanvasPasteElements(
      [
        { x: 0, y: 0, width: 300, height: 168 },
        { x: 0, y: 0, width: 300, height: 168 },
      ],
      { left: 0, top: 0, width: 700, height: 500 },
      { x: 690, y: 490 },
    );

    expect(positioned[1]?.x).toBe(700 - CARD_CANVAS_PASTE_GAP - 300);
    expect(positioned[0]?.y).toBe(500 - CARD_CANVAS_PASTE_GAP - 168);
  });

  it("falls back to the visible center when the saved touch is stale", () => {
    const elements = [{ x: 0, y: 0, width: 120, height: 48 }];
    expect(
      layoutCardCanvasPasteElements(
        elements,
        { left: 100, top: 50, width: 500, height: 400 },
        { x: -1000, y: -1000 },
      ),
    ).toEqual(
      layoutCardCanvasPasteElements(elements, {
        left: 100,
        top: 50,
        width: 500,
        height: 400,
      }),
    );
  });
});

describe("card canvas paste batch budget", () => {
  it("rejects a clipboard batch before resource work when the scene is full", () => {
    const resource = makeImageResource(
      "resource0001",
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
    );

    expect(() =>
      assertCardCanvasPasteInputBudget({
        elements: [makeSceneImage(resource.publicId)],
        objectCount: 1,
        imageSizes: [0],
        resources: [resource],
      }),
    ).toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  });

  it("rejects a known clipboard image over 10 MiB before resource work", () => {
    expect(() =>
      assertCardCanvasPasteInputBudget({
        elements: [],
        objectCount: 1,
        imageSizes: [MAX_CARD_CANVAS_IMAGE_BYTES + 1],
        resources: [],
      }),
    ).toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  });

  it("allows exactly 5,000 elements", () => {
    expect(() =>
      assertCardCanvasPasteBatchBudget({
        elements: Array.from(
          { length: MAX_CARD_CANVAS_ELEMENTS - 1 },
          (_, index) =>
            ({
              id: `existing-${index}`,
              type: "rectangle",
              isDeleted: false,
            }) as ExcalidrawElement,
        ),
        items: [{ kind: "text", text: "Last safe idea" }],
        resources: [],
      }),
    ).not.toThrow();
  });

  it("rejects more than 5,000 elements", () => {
    expect(() =>
      assertCardCanvasPasteBatchBudget({
        elements: Array.from(
          { length: MAX_CARD_CANVAS_ELEMENTS },
          (_, index) =>
            ({
              id: `existing-${index}`,
              type: "rectangle",
              isDeleted: false,
            }) as ExcalidrawElement,
        ),
        items: [{ kind: "text", text: "Too many" }],
        resources: [],
      }),
    ).toThrow("CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED");
  });

  it("allows exactly 50 unique images and 20 MiB", () => {
    const resources = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES },
      (_, index) => {
        const baseSize = Math.floor(
          MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES / MAX_CARD_CANVAS_IMAGE_RESOURCES,
        );
        const size =
          index === MAX_CARD_CANVAS_IMAGE_RESOURCES - 1
            ? MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES -
              baseSize * (MAX_CARD_CANVAS_IMAGE_RESOURCES - 1)
            : baseSize;
        return makeImageResource(
          `image${String(index).padStart(7, "0")}`,
          size,
        );
      },
    );
    const last = resources.at(-1);
    if (!last) throw new Error("Expected the final image resource");

    expect(() =>
      assertCardCanvasPasteBatchBudget({
        elements: resources
          .slice(0, -1)
          .map((resource) => makeSceneImage(resource.publicId)),
        items: [{ kind: "resource", resource: last }],
        resources,
      }),
    ).not.toThrow();
  });

  it("rejects the fifty-first unique image", () => {
    const resources = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES + 1 },
      (_, index) =>
        makeImageResource(`image${String(index).padStart(7, "0")}`, 1),
    );
    const last = resources.at(-1);
    if (!last) throw new Error("Expected the final image resource");

    expect(() =>
      assertCardCanvasPasteBatchBudget({
        elements: resources
          .slice(0, -1)
          .map((resource) => makeSceneImage(resource.publicId)),
        items: [{ kind: "resource", resource: last }],
        resources,
      }),
    ).toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  });

  it("counts repeated image resources once but rejects excess bytes", () => {
    const resource = makeImageResource(
      "resource0001",
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES + 1,
    );
    const items: CardCanvasPasteBatchItem[] = [
      { kind: "resource", resource },
      { kind: "resource", resource },
    ];

    expect(() =>
      assertCardCanvasPasteBatchBudget({
        elements: [],
        items,
        resources: [],
      }),
    ).toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  });

  it("rejects an existing image whose size cannot be resolved", () => {
    const pastedImage = makeImageResource("resource0001", 1024);
    expect(() =>
      assertCardCanvasPasteBatchBudget({
        elements: [makeSceneImage("missing00001")],
        items: [{ kind: "resource", resource: pastedImage }],
        resources: [],
      }),
    ).toThrow("IMAGE_RESOURCE_BUDGET_UNKNOWN");
  });

  it("does not require image metadata for a text-only paste", () => {
    expect(() =>
      assertCardCanvasPasteInputBudget({
        elements: [makeSceneImage("missing00001")],
        objectCount: 1,
        imageSizes: [],
        resources: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertCardCanvasPasteBatchBudget({
        elements: [makeSceneImage("missing00001")],
        items: [{ kind: "text", text: "Offline idea" }],
        resources: [],
      }),
    ).not.toThrow();
  });
});

describe("insertCardCanvasPasteBatch", () => {
  it("inserts text, image, web, and Drive as one undoable selected batch", async () => {
    vi.mocked(hydrateCardCanvasImage).mockResolvedValue({
      fileId: "image000001" as never,
      dimensions: { width: 100, height: 80 },
    });
    const existing = {
      id: "existing",
      type: "rectangle",
      isDeleted: false,
    } as ExcalidrawElement;
    const image = makeImageResource("image000001", 1024);
    const web = makeWebResource("web00000001");
    const drive = makeDriveResource("drive0000001");
    const { api, setActiveTool, updateScene } = makeApi({
      elements: [existing],
    });

    const ids = await insertCardCanvasPasteBatch({
      api,
      items: [
        { kind: "text", text: "Editable idea" },
        { kind: "resource", resource: image },
        { kind: "resource", resource: web },
        { kind: "resource", resource: drive },
      ],
      resources: [image, web, drive],
      anchor: { x: 350, y: 250 },
    });

    expect(ids).toHaveLength(4);
    expect(setActiveTool).toHaveBeenCalledOnce();
    expect(setActiveTool).toHaveBeenCalledWith({ type: "selection" });
    expect(updateScene).toHaveBeenCalledOnce();
    const update = updateScene.mock.calls[0]?.[0] as {
      elements: ExcalidrawElement[];
      appState: {
        selectedElementIds: Record<string, boolean>;
        selectedGroupIds: Record<string, boolean>;
      };
      captureUpdate: string;
    };
    expect(update.captureUpdate).toBe("IMMEDIATELY");
    expect(update.elements[0]).toBe(existing);
    expect(update.appState.selectedGroupIds).toEqual({});
    expect(Object.keys(update.appState.selectedElementIds)).toEqual(ids);
    expect(update.elements.slice(1).map((element) => element.type)).toEqual([
      "text",
      "image",
      "embeddable",
      "embeddable",
    ]);
    expect(update.elements[2]).toMatchObject({
      customData: { kanResourcePublicId: image.publicId },
    });
    expect(update.elements[3]).toMatchObject({
      link: `kan-resource:${web.publicId}`,
      customData: { kanResourcePublicId: web.publicId },
    });
    expect(update.elements[4]).toMatchObject({
      link: `kan-resource:${drive.publicId}`,
      customData: { kanResourcePublicId: drive.publicId },
    });
    const serialized = JSON.stringify(update);
    expect(serialized).not.toContain(web.openUrl);
    expect(serialized).not.toContain(web.title);
    expect(serialized).not.toContain("drive.google.com");
  });

  it("rejects an oversized scene before converting or hydrating", async () => {
    const { api, updateScene } = makeApi({
      elements: Array.from(
        { length: MAX_CARD_CANVAS_ELEMENTS },
        (_, index) =>
          ({
            id: `existing-${index}`,
            type: "rectangle",
            isDeleted: false,
          }) as ExcalidrawElement,
      ),
    });

    await expect(
      insertCardCanvasPasteBatch({
        api,
        items: [{ kind: "text", text: "Rejected early" }],
        resources: [],
      }),
    ).rejects.toThrow("CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED");
    expect(convertToExcalidrawElements).not.toHaveBeenCalled();
    expect(hydrateCardCanvasImage).not.toHaveBeenCalled();
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("applies a surface constraint before the single undoable insertion", async () => {
    const { api, updateScene } = makeApi({ elements: [] });
    const transformElements = vi.fn(
      (
        elements: readonly ExcalidrawElement[],
        selectedElementIds: Readonly<Record<string, true>>,
      ) =>
        elements.map((element) =>
          selectedElementIds[element.id]
            ? ({ ...element, x: 0 } as ExcalidrawElement)
            : element,
        ),
    );

    const ids = await insertCardCanvasPasteBatch({
      api,
      items: [{ kind: "text", text: "Wide goal" }],
      resources: [],
      anchor: { x: 1_300, y: -80 },
      transformElements,
    });

    const insertedId = ids[0];
    if (!insertedId) throw new Error("MISSING_INSERTED_ELEMENT");
    expect(transformElements).toHaveBeenCalledOnce();
    expect(transformElements.mock.calls[0]?.[1]).toEqual({
      [insertedId]: true,
    });
    expect(updateScene).toHaveBeenCalledOnce();
    expect(
      (
        updateScene.mock.calls[0]?.[0] as {
          elements: ExcalidrawElement[];
        }
      ).elements[0]?.x,
    ).toBe(0);
  });

  it("does not overwrite a scene that crosses the limit during hydration", async () => {
    const before = Array.from(
      { length: MAX_CARD_CANVAS_ELEMENTS - 1 },
      (_, index) =>
        ({
          id: `before-${index}`,
          type: "rectangle",
          isDeleted: false,
        }) as ExcalidrawElement,
    );
    const after = [
      ...before,
      {
        id: "concurrent-element",
        type: "rectangle",
        isDeleted: false,
      } as ExcalidrawElement,
    ];
    const getSceneElements = vi
      .fn<() => readonly ExcalidrawElement[]>()
      .mockReturnValueOnce(before)
      .mockReturnValue(after);
    const { api, updateScene } = makeApi({ getSceneElements });

    await expect(
      insertCardCanvasPasteBatch({
        api,
        items: [{ kind: "text", text: "Concurrent idea" }],
        resources: [],
      }),
    ).rejects.toThrow("CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED");
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("rejects a pasted image when a direct insertion wins the fiftieth slot", async () => {
    const hydration = deferred<{
      fileId: never;
      dimensions: { width: number; height: number };
    }>();
    vi.mocked(hydrateCardCanvasImage).mockReturnValue(hydration.promise);
    const existing = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES - 1 },
      (_, index) =>
        makeImageResource(`image${String(index).padStart(7, "0")}`, 1),
    );
    const concurrent = makeImageResource("concurrent01", 1);
    const pasted = makeImageResource("pasted000001", 1);
    const elements = existing.map((resource) =>
      makeSceneImage(resource.publicId),
    );
    const { api, updateScene } = makeApi({ elements });

    const insertion = insertCardCanvasPasteBatch({
      api,
      items: [{ kind: "resource", resource: pasted }],
      resources: [...existing, concurrent, pasted],
    });
    await Promise.resolve();
    elements.push(makeSceneImage(concurrent.publicId));
    hydration.resolve({
      fileId: "pasted000001" as never,
      dimensions: { width: 100, height: 80 },
    });

    await expect(insertion).rejects.toThrow("IMAGE_RESOURCE_BUDGET_EXCEEDED");
    expect(updateScene).not.toHaveBeenCalled();
  });
});
