import { describe, expect, it } from "vitest";

import {
  CardCanvasSceneError,
  extractCardCanvasReferences,
  getCardCanvasSceneBytes,
  hashCardCanvasScene,
  MAX_CARD_CANVAS_BYTES,
  MAX_CARD_CANVAS_ELEMENTS,
  normalizeCardCanvasScene,
  remapCardCanvasSceneReferences,
  removeCardCanvasResourceElements,
} from "./scene";

const frame = {
  id: "frame-one",
  type: "frame",
  x: 0,
  y: 0,
  width: 600,
  height: 400,
  name: "Zona uno",
  customData: { kanFramePublicId: "framepublic1" },
  isDeleted: false,
};

describe("card canvas scene", () => {
  it("keeps only live document state and extracts internal references", () => {
    const scene = normalizeCardCanvasScene({
      elements: [
        frame,
        {
          id: "image-one",
          type: "image",
          x: 20,
          y: 20,
          width: 200,
          height: 100,
          fileId: "opaque-file-id",
          customData: { kanResourcePublicId: "resource0001" },
          link: "kan-resource:resource0001",
        },
        { ...frame, id: "deleted", isDeleted: true },
      ],
      appState: {
        viewBackgroundColor: "#ffffff",
        scrollX: 200,
        zoom: { value: 2 },
        selectedElementIds: { "image-one": true },
      },
      files: { secret: "binary" },
    });

    expect(scene.elements).toHaveLength(2);
    expect(scene.elements[1]?.fileId).toBe("resource0001");
    expect(scene.appState).toEqual({ viewBackgroundColor: "#ffffff" });
    expect(extractCardCanvasReferences(scene)).toEqual({
      frames: [
        {
          publicId: "framepublic1",
          elementId: "frame-one",
          name: "Zona uno",
        },
      ],
      resources: [{ publicId: "resource0001", elementId: "image-one" }],
      subtaskPublicIds: [],
    });
  });

  it("rejects unsupported elements, unsafe links and foreign custom data", () => {
    expect(() =>
      normalizeCardCanvasScene({
        elements: [{ ...frame, type: "iframe" }],
        appState: {},
      }),
    ).toThrow(CardCanvasSceneError);
    expect(() =>
      normalizeCardCanvasScene({
        elements: [{ ...frame, link: "https://example.com" }],
        appState: {},
      }),
    ).toThrowError("UNSAFE_LINK");
    expect(() =>
      normalizeCardCanvasScene({
        elements: [
          {
            ...frame,
            customData: { kanFramePublicId: "framepublic1", ai: true },
          },
        ],
        appState: {},
      }),
    ).toThrowError("INVALID_CUSTOM_DATA");
    expect(() =>
      normalizeCardCanvasScene({
        elements: [
          {
            id: "mismatch",
            type: "embeddable",
            customData: { kanResourcePublicId: "resource0001" },
            link: "kan-resource:resource0002",
          },
        ],
        appState: {},
      }),
    ).toThrowError("INVALID_CUSTOM_DATA");
    expect(() =>
      normalizeCardCanvasScene({
        elements: [
          {
            id: "unsafe-file-id",
            type: "image",
            fileId: ".objects/private/image.png",
            customData: { kanResourcePublicId: "resource0001" },
          },
        ],
        appState: {},
      }),
    ).toThrowError("INVALID_SCENE");
  });

  it("accepts exactly the element limit", () => {
    expect(
      normalizeCardCanvasScene({
        elements: Array.from(
          { length: MAX_CARD_CANVAS_ELEMENTS },
          (_, index) => ({ id: `live-${index}`, type: "rectangle" }),
        ),
        appState: {},
      }).elements,
    ).toHaveLength(MAX_CARD_CANVAS_ELEMENTS);
  });

  it("rejects oversized scenes before inspecting an element", () => {
    const firstElement = {};
    Object.defineProperty(firstElement, "isDeleted", {
      get: () => {
        throw new Error("ELEMENT_PROCESSING_STARTED");
      },
    });
    const elements = Array.from(
      { length: MAX_CARD_CANVAS_ELEMENTS + 1 },
      (_, index) => ({ id: `live-${index}`, type: "rectangle" }),
    );
    elements[0] = firstElement as { id: string; type: string };
    expect(() =>
      normalizeCardCanvasScene({
        elements,
        appState: {},
      }),
    ).toThrowError("TOO_MANY_ELEMENTS");
  });

  it.each([
    [
      "reference extraction",
      (scene: Parameters<typeof extractCardCanvasReferences>[0]) =>
        extractCardCanvasReferences(scene),
    ],
    [
      "resource removal",
      (scene: Parameters<typeof removeCardCanvasResourceElements>[0]) =>
        removeCardCanvasResourceElements(scene, "resource0001", "remove"),
    ],
    [
      "reference remapping",
      (scene: Parameters<typeof remapCardCanvasSceneReferences>[0]) =>
        remapCardCanvasSceneReferences(scene, {
          framePublicIds: {},
          resourcePublicIds: {},
          subtaskPublicIds: {},
        }),
    ],
  ])("rejects oversized stored scenes before %s", (_, processScene) => {
    const firstElement = new Proxy(
      { id: "first", type: "rectangle" },
      {
        get: () => {
          throw new Error("STORED_ELEMENT_PROCESSING_STARTED");
        },
      },
    );
    const scene = {
      elements: Array.from(
        { length: MAX_CARD_CANVAS_ELEMENTS + 1 },
        (_, index) => ({ id: `stored-${index}`, type: "rectangle" }),
      ),
      appState: {},
    };
    scene.elements[0] = firstElement;

    expect(() => processScene(scene)).toThrowError("TOO_MANY_ELEMENTS");
  });

  it.each([
    ["geometry", { id: "bad-x", type: "rectangle", x: {} }],
    ["boolean", { id: "bad-lock", type: "rectangle", locked: "yes" }],
    ["string", { id: "bad-colour", type: "rectangle", strokeColor: 4 }],
    ["groups", { id: "bad-groups", type: "rectangle", groupIds: [1] }],
    ["points", { id: "bad-points", type: "line", points: "x" }],
    [
      "pressures",
      { id: "bad-pressure", type: "freedraw", pressures: [0.5, "x"] },
    ],
    [
      "scale",
      {
        id: "bad-scale",
        type: "image",
        scale: [1],
        customData: { kanResourcePublicId: "resource0001" },
      },
    ],
    [
      "bound elements",
      {
        id: "bad-bound",
        type: "rectangle",
        boundElements: [{ id: "arrow", type: "image" }],
      },
    ],
    [
      "binding",
      {
        id: "bad-binding",
        type: "arrow",
        startBinding: { elementId: "target", focus: "0", gap: 1 },
      },
    ],
    [
      "roundness",
      { id: "bad-roundness", type: "rectangle", roundness: { type: "2" } },
    ],
    [
      "crop",
      {
        id: "bad-crop",
        type: "image",
        crop: {
          x: 0,
          y: 0,
          width: "100",
          height: 100,
          naturalWidth: 100,
          naturalHeight: 100,
        },
        customData: { kanResourcePublicId: "resource0001" },
      },
    ],
    ["deletion flag", { id: "bad-delete", type: "rectangle", isDeleted: 1 }],
  ])("rejects malformed %s fields", (_label, element) => {
    expect(() =>
      normalizeCardCanvasScene({ elements: [element], appState: {} }),
    ).toThrowError("INVALID_SCENE");
  });

  it("accepts the persisted structures emitted by Excalidraw 0.18.1", () => {
    const scene = normalizeCardCanvasScene({
      elements: [
        {
          id: "target",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          roundness: { type: 3, value: 16 },
          boundElements: [{ id: "elbow", type: "arrow" }],
        },
        {
          id: "elbow",
          type: "arrow",
          points: [
            [0, 0],
            [100, 50],
          ],
          lastCommittedPoint: null,
          startBinding: {
            elementId: "target",
            focus: 0,
            gap: 1,
            fixedPoint: [0.5, 1],
          },
          endBinding: null,
          startArrowhead: null,
          endArrowhead: "arrow",
          elbowed: true,
          fixedSegments: [{ start: [0, 0], end: [100, 0], index: 1 }],
          startIsSpecial: false,
          endIsSpecial: null,
        },
        {
          id: "stroke",
          type: "freedraw",
          points: [
            [0, 0],
            [2, 3],
          ],
          lastCommittedPoint: [2, 3],
          pressures: [0.2, 0.8],
          simulatePressure: false,
        },
        {
          id: "image",
          type: "image",
          fileId: null,
          status: "saved",
          scale: [-1, 1],
          crop: {
            x: 1,
            y: 2,
            width: 90,
            height: 80,
            naturalWidth: 100,
            naturalHeight: 100,
          },
          customData: { kanResourcePublicId: "resource0001" },
        },
        {
          id: "copy",
          type: "text",
          fontSize: 20,
          fontFamily: 5,
          text: "Texto",
          originalText: "Texto",
          textAlign: "left",
          verticalAlign: "top",
          containerId: "target",
          autoResize: true,
          lineHeight: 1.25,
        },
      ],
      appState: {},
    });

    expect(scene.elements).toHaveLength(5);
    expect(scene.elements[1]).toMatchObject({
      elbowed: true,
      fixedSegments: [{ start: [0, 0], end: [100, 0], index: 1 }],
    });
    expect(scene.elements[3]?.crop).toEqual({
      x: 1,
      y: 2,
      width: 90,
      height: 80,
      naturalWidth: 100,
      naturalHeight: 100,
    });
    expect(scene.elements[3]?.fileId).toBe("resource0001");
  });

  it("canonicalizes image file IDs to their authorized resource IDs", () => {
    const scene = normalizeCardCanvasScene({
      elements: [
        {
          id: "image-mismatch",
          type: "image",
          fileId: "temporary-valid-id",
          customData: { kanResourcePublicId: "resource0001" },
        },
      ],
      appState: {},
    });

    expect(scene.elements[0]?.fileId).toBe("resource0001");
  });

  it("completes minimal elements with render-safe Excalidraw 0.18.1 fields", () => {
    const scene = normalizeCardCanvasScene({
      elements: [
        { id: "shape", type: "rectangle" },
        { id: "line", type: "line" },
        { id: "arrow", type: "arrow" },
        { id: "stroke", type: "freedraw" },
        { id: "copy", type: "text" },
        {
          id: "image",
          type: "image",
          customData: { kanResourcePublicId: "resource0001" },
        },
        {
          id: "frame",
          type: "frame",
          customData: { kanFramePublicId: "framepublic1" },
        },
        {
          id: "embed",
          type: "embeddable",
          link: "kan-subtask:subtask00001",
        },
      ],
      appState: {},
    });

    const base = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      angle: 0,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 0,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      locked: false,
    };
    for (const element of scene.elements) {
      expect(element).toMatchObject({
        ...base,
        strokeColor: element.type === "image" ? "transparent" : "#1e1e1e",
        link: element.type === "embeddable" ? "kan-subtask:subtask00001" : null,
      });
    }
    expect(scene.elements[1]).toMatchObject({
      points: [],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
    });
    expect(scene.elements[2]).toMatchObject({
      points: [],
      elbowed: false,
    });
    expect(scene.elements[3]).toMatchObject({
      points: [],
      pressures: [],
      simulatePressure: true,
      lastCommittedPoint: null,
    });
    expect(scene.elements[4]).toMatchObject({
      fontSize: 20,
      fontFamily: 5,
      text: "",
      originalText: "",
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    });
    expect(scene.elements[5]).toMatchObject({
      fileId: "resource0001",
      status: "saved",
      scale: [1, 1],
      crop: null,
    });
    expect(scene.elements[6]).toMatchObject({ name: "Zona sin título" });
    expect(scene.elements[7]).toMatchObject({
      type: "embeddable",
      link: "kan-subtask:subtask00001",
    });
  });

  it.each([
    ["coordinate", { id: "huge-x", type: "rectangle", x: 1_000_001 }],
    ["dimension", { id: "negative-width", type: "rectangle", width: -1 }],
    ["angle", { id: "huge-angle", type: "rectangle", angle: 1e100 }],
    ["opacity", { id: "bad-opacity", type: "rectangle", opacity: 101 }],
    ["version", { id: "huge-version", type: "rectangle", version: 1e100 }],
    [
      "point",
      { id: "huge-point", type: "line", points: [[Number.MAX_VALUE, 0]] },
    ],
    [
      "pressure",
      { id: "bad-pressure-range", type: "freedraw", pressures: [1.01] },
    ],
    ["font size", { id: "huge-font", type: "text", fontSize: 513 }],
  ])("rejects out-of-range %s values", (_label, element) => {
    expect(() =>
      normalizeCardCanvasScene({ elements: [element], appState: {} }),
    ).toThrowError("INVALID_SCENE");
  });

  it("rejects out-of-range grid values", () => {
    expect(() =>
      normalizeCardCanvasScene({
        elements: [],
        appState: { gridSize: Number.MAX_VALUE },
      }),
    ).toThrowError("INVALID_SCENE");
  });

  it("enforces the UTF-8 byte limit after normalization", () => {
    const empty = normalizeCardCanvasScene({
      elements: [{ id: "large-text", type: "text", text: "" }],
      appState: {},
    });
    const payloadBytes = MAX_CARD_CANVAS_BYTES - getCardCanvasSceneBytes(empty);
    const atLimit = normalizeCardCanvasScene({
      elements: [
        {
          id: "large-text",
          type: "text",
          text: "x".repeat(payloadBytes),
          originalText: "",
        },
      ],
      appState: {},
    });
    expect(getCardCanvasSceneBytes(atLimit)).toBe(MAX_CARD_CANVAS_BYTES);
    expect(() =>
      normalizeCardCanvasScene({
        elements: [
          {
            id: "large-text",
            type: "text",
            text: "x".repeat(payloadBytes + 1),
            originalText: "",
          },
        ],
        appState: {},
      }),
    ).toThrowError("SCENE_TOO_LARGE");
  });

  it("drops unremapped subtask embeddables while keeping ordinary shapes", () => {
    const scene = normalizeCardCanvasScene({
      elements: [
        {
          id: "subtask-card",
          type: "embeddable",
          link: "kan-subtask:subtask00001",
        },
        {
          id: "subtask-shape",
          type: "rectangle",
          link: "kan-subtask:subtask00001",
        },
      ],
      appState: {},
    });
    const remapped = remapCardCanvasSceneReferences(scene, {
      framePublicIds: {},
      resourcePublicIds: {},
      subtaskPublicIds: {},
    });

    expect(remapped.elements).toEqual([
      expect.objectContaining({ id: "subtask-shape", link: null }),
    ]);
  });

  it("canonicalizes hashes and repairs bindings after resource removal", async () => {
    const first = normalizeCardCanvasScene({
      elements: [
        frame,
        {
          id: "resource-card",
          type: "embeddable",
          x: 10,
          y: 10,
          width: 200,
          height: 80,
          link: "kan-resource:resource0001",
        },
        {
          id: "arrow-one",
          type: "arrow",
          points: [
            [0, 0],
            [100, 100],
          ],
          endBinding: { elementId: "resource-card", focus: 0, gap: 1 },
        },
      ],
      appState: { gridSize: 20, gridModeEnabled: true },
    });
    const second = normalizeCardCanvasScene({
      appState: { gridModeEnabled: true, gridSize: 20 },
      elements: first.elements.map((element) => ({ ...element })),
    });
    expect(await hashCardCanvasScene(first)).toBe(
      await hashCardCanvasScene(second),
    );

    const removed = removeCardCanvasResourceElements(
      first,
      "resource0001",
      "remove",
    );
    expect(removed.elements.map((element) => element.id)).toEqual([
      "frame-one",
      "arrow-one",
    ]);
    expect(removed.elements[1]?.endBinding).toBeNull();

    const placeholder = removeCardCanvasResourceElements(
      first,
      "resource0001",
      "placeholder",
    );
    expect(placeholder.elements[1]).toMatchObject({
      id: "resource-card",
      type: "text",
      text: "Recurso eliminado",
      locked: true,
    });
  });
});
