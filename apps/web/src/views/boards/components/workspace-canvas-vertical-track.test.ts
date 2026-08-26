import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import {
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import { describe, expect, it, vi } from "vitest";

import {
  clampWorkspaceCanvasCamera,
  constrainWorkspaceCanvasOutliers,
  constrainWorkspaceCanvasSelection,
  getWorkspaceCanvasHomeCamera,
  WORKSPACE_CANVAS_TRACK_MAX_Y,
  WORKSPACE_CANVAS_TRACK_WIDTH,
} from "./workspace-canvas-vertical-track";

const mocks = vi.hoisted(() => ({
  nextElementId: 0,
}));

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn(
    (
      skeletons: {
        type: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }[],
    ) =>
      skeletons.map((skeleton) => ({
        ...skeleton,
        id: `element-${++mocks.nextElementId}`,
        x: skeleton.x ?? 0,
        y: skeleton.y ?? 0,
        width: skeleton.width ?? 0,
        height: skeleton.height ?? 0,
        version: 1,
        versionNonce: 1,
        updated: 1,
        isDeleted: false,
      })),
  ),
  getCommonBounds: vi.fn(
    (
      elements: readonly {
        x: number;
        y: number;
        width: number;
        height: number;
      }[],
    ) => [
      Math.min(...elements.map((element) => element.x)),
      Math.min(...elements.map((element) => element.y)),
      Math.max(...elements.map((element) => element.x + element.width)),
      Math.max(...elements.map((element) => element.y + element.height)),
    ],
  ),
  newElementWith: vi.fn(
    (element: ExcalidrawElement, updates: Partial<ExcalidrawElement>) => ({
      ...element,
      ...updates,
      version: element.version + 1,
      versionNonce: element.versionNonce + 1,
      updated: element.updated + 1,
    }),
  ),
}));

const zoom = (value: number): AppState["zoom"] => ({
  value: value as AppState["zoom"]["value"],
});

const rectangle = ({
  id,
  x,
  y,
  width,
  height,
}: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) => {
  const element = convertToExcalidrawElements([
    { type: "rectangle", x, y, width, height },
  ])[0];
  if (!element) throw new Error("MISSING_TEST_ELEMENT");
  return { ...element, id } as ExcalidrawElement;
};

describe("getWorkspaceCanvasHomeCamera", () => {
  it("fits a narrow viewport to the complete track and its top origin", () => {
    const camera = getWorkspaceCanvasHomeCamera({ viewportWidth: 600 });

    expect(camera.zoom.value).toBeCloseTo(0.46);
    expect(camera.scrollX).toBeCloseTo(24 / 0.46);
    expect(camera.scrollY).toBeCloseTo(24 / 0.46);
    expect((0 + camera.scrollX) * camera.zoom.value).toBeCloseTo(24);
    expect(
      (WORKSPACE_CANVAS_TRACK_WIDTH + camera.scrollX) * camera.zoom.value,
    ).toBeCloseTo(576);
  });

  it("centres the track without enlarging it beyond one hundred percent", () => {
    expect(getWorkspaceCanvasHomeCamera({ viewportWidth: 1_600 })).toEqual({
      scrollX: 200,
      scrollY: 24,
      zoom: zoom(1),
    });
  });
});

describe("clampWorkspaceCanvasCamera", () => {
  it("keeps a zoomed viewport between the left and right track edges", () => {
    const atLeft = clampWorkspaceCanvasCamera({
      viewportWidth: 600,
      scrollX: 300,
      scrollY: 0,
      zoom: zoom(1),
    });
    const atRight = clampWorkspaceCanvasCamera({
      viewportWidth: 600,
      scrollX: -900,
      scrollY: 0,
      zoom: zoom(1),
    });

    expect(atLeft.scrollX).toBe(24);
    expect(atRight.scrollX).toBe(-624);
  });

  it("centres the track when the complete width fits in the viewport", () => {
    expect(
      clampWorkspaceCanvasCamera({
        viewportWidth: 1_600,
        scrollX: -400,
        scrollY: 0,
        zoom: zoom(1),
      }).scrollX,
    ).toBe(200);
  });

  it("keeps vertical travel inside the technical scene boundary", () => {
    expect(
      clampWorkspaceCanvasCamera({
        viewportWidth: 600,
        viewportHeight: 800,
        scrollX: 0,
        scrollY: 100,
        zoom: zoom(2),
      }).scrollY,
    ).toBe(12);
    expect(
      clampWorkspaceCanvasCamera({
        viewportWidth: 600,
        viewportHeight: 800,
        scrollX: 0,
        scrollY: -2_000_000,
        zoom: zoom(2),
      }).scrollY,
    ).toBe((800 - 24) / 2 - WORKSPACE_CANVAS_TRACK_MAX_Y);
  });
});

describe("constrainWorkspaceCanvasSelection", () => {
  it("translates a selection as one unit inside the left and top edges", () => {
    const first = rectangle({
      id: "first",
      x: -120,
      y: -80,
      width: 100,
      height: 60,
    });
    const second = rectangle({
      id: "second",
      x: 40,
      y: 20,
      width: 80,
      height: 40,
    });
    const untouched = rectangle({
      id: "untouched",
      x: 400,
      y: 400,
      width: 40,
      height: 40,
    });
    const result = constrainWorkspaceCanvasSelection(
      [first, second, untouched],
      { first: true, second: true },
    );

    const [nextFirst, nextSecond, nextUntouched] = result.elements;
    if (!nextFirst || !nextSecond) throw new Error("MISSING_TEST_ELEMENT");
    expect(result.changed).toBe(true);
    expect(result.scale).toBe(1);
    expect(result.translation.x).toBeGreaterThan(0);
    expect(result.translation.y).toBeGreaterThan(0);
    expect(nextSecond.x - nextFirst.x).toBe(second.x - first.x);
    expect(nextSecond.y - nextFirst.y).toBe(second.y - first.y);
    expect(getCommonBounds([nextFirst, nextSecond])[0]).toBeCloseTo(0);
    expect(getCommonBounds([nextFirst, nextSecond])[1]).toBeCloseTo(0);
    expect(nextUntouched).toBe(untouched);
    expect(nextFirst.version).toBe(first.version + 1);
    expect(nextSecond.version).toBe(second.version + 1);
  });

  it("moves a selection back from the right edge without changing spacing", () => {
    const first = rectangle({
      id: "first",
      x: 1_050,
      y: 40,
      width: 100,
      height: 50,
    });
    const second = rectangle({
      id: "second",
      x: 1_200,
      y: 40,
      width: 100,
      height: 50,
    });
    const result = constrainWorkspaceCanvasSelection([first, second], {
      first: true,
      second: true,
    });
    const [nextFirst, nextSecond] = result.elements;

    expect(getCommonBounds(result.elements)[2]).toBeCloseTo(1_200);
    expect((nextSecond?.x ?? 0) - (nextFirst?.x ?? 0)).toBe(150);
  });

  it("reduces an oversized multi-element selection proportionally", () => {
    const first = rectangle({
      id: "first",
      x: 100,
      y: 100,
      width: 1_000,
      height: 400,
    });
    const second = rectangle({
      id: "second",
      x: 1_300,
      y: 700,
      width: 1_200,
      height: 600,
    });
    const result = constrainWorkspaceCanvasSelection([first, second], {
      first: true,
      second: true,
    });
    const [nextFirst, nextSecond] = result.elements;
    const [minimumX, minimumY, maximumX] = getCommonBounds(result.elements);

    expect(result.changed).toBe(true);
    expect(result.scale).toBeLessThan(1);
    expect(minimumX).toBeGreaterThanOrEqual(-0.001);
    expect(minimumY).toBeCloseTo(100);
    expect(maximumX).toBeLessThanOrEqual(1_200.001);
    expect(nextFirst?.width).toBeCloseTo(first.width * result.scale);
    expect(nextFirst?.height).toBeCloseTo(first.height * result.scale);
    expect((nextSecond?.x ?? 0) - (nextFirst?.x ?? 0)).toBeCloseTo(
      (second.x - first.x) * result.scale,
    );
    expect((nextSecond?.y ?? 0) - (nextFirst?.y ?? 0)).toBeCloseTo(
      (second.y - first.y) * result.scale,
    );
  });

  it("scales linear geometry with an oversized arrow", () => {
    const arrow = {
      ...rectangle({
        id: "arrow",
        x: 0,
        y: 100,
        width: 2_400,
        height: 200,
      }),
      type: "arrow",
      points: [
        [0, 0],
        [2_400, 200],
      ],
      lastCommittedPoint: [2_400, 200],
    } as unknown as ExcalidrawElement;
    const result = constrainWorkspaceCanvasSelection([arrow], { arrow: true });
    const nextArrow = result.elements[0] as unknown as {
      points: readonly (readonly [number, number])[];
      lastCommittedPoint: readonly [number, number] | null;
    };

    expect(result.scale).toBeCloseTo(0.5);
    expect(nextArrow.points).toEqual([
      [0, 0],
      [1_200, 100],
    ]);
    expect(nextArrow.lastCommittedPoint).toEqual([1_200, 100]);
  });

  it("keeps text size proportional when reducing an oversized element", () => {
    const text = {
      ...rectangle({
        id: "text",
        x: 0,
        y: 100,
        width: 2_400,
        height: 200,
      }),
      type: "text",
      fontSize: 40,
    } as unknown as ExcalidrawElement;
    const result = constrainWorkspaceCanvasSelection([text], { text: true });
    const nextText = result.elements[0] as unknown as { fontSize: number };

    expect(result.scale).toBeCloseTo(0.5);
    expect(nextText.fontSize).toBeCloseTo(20);
  });

  it("keeps bound text attached when its container returns to the track", () => {
    const container = {
      ...rectangle({
        id: "container",
        x: 1_100,
        y: -100,
        width: 300,
        height: 200,
      }),
      boundElements: [{ id: "label", type: "text" }],
    } as ExcalidrawElement;
    const label = {
      ...rectangle({
        id: "label",
        x: 1_180,
        y: -40,
        width: 140,
        height: 40,
      }),
      type: "text",
      containerId: "container",
      fontSize: 24,
    } as unknown as ExcalidrawElement;
    const result = constrainWorkspaceCanvasSelection([container, label], {
      container: true,
    });
    const [nextContainer, nextLabel] = result.elements;

    expect(result.changed).toBe(true);
    expect(getCommonBounds(result.elements)[0]).toBeGreaterThanOrEqual(-0.001);
    expect(getCommonBounds(result.elements)[1]).toBeGreaterThanOrEqual(-0.001);
    expect(getCommonBounds(result.elements)[2]).toBeLessThanOrEqual(1_200.001);
    expect((nextLabel?.x ?? 0) - (nextContainer?.x ?? 0)).toBeCloseTo(
      (label.x - container.x) * result.scale,
    );
    expect((nextLabel?.y ?? 0) - (nextContainer?.y ?? 0)).toBeCloseTo(
      (label.y - container.y) * result.scale,
    );
  });

  it("keeps a connected arrow and both bound shapes consistent", () => {
    const first = {
      ...rectangle({
        id: "first",
        x: -200,
        y: 100,
        width: 120,
        height: 80,
      }),
      boundElements: [{ id: "arrow", type: "arrow" }],
    } as ExcalidrawElement;
    const second = {
      ...rectangle({
        id: "second",
        x: 500,
        y: 100,
        width: 120,
        height: 80,
      }),
      boundElements: [{ id: "arrow", type: "arrow" }],
    } as ExcalidrawElement;
    const arrow = {
      ...rectangle({
        id: "arrow",
        x: -80,
        y: 140,
        width: 580,
        height: 1,
      }),
      type: "arrow",
      points: [
        [0, 0],
        [580, 0],
      ],
      lastCommittedPoint: [580, 0],
      startBinding: { elementId: "first", focus: 0, gap: 0 },
      endBinding: { elementId: "second", focus: 0, gap: 0 },
    } as unknown as ExcalidrawElement;
    const result = constrainWorkspaceCanvasSelection([first, arrow, second], {
      first: true,
    });

    expect(result.changed).toBe(true);
    expect(result.elements[0]?.version).toBeGreaterThan(first.version);
    expect(result.elements[1]?.version).toBeGreaterThan(arrow.version);
    expect(result.elements[2]).toBe(second);
    expect(getCommonBounds(result.elements)[0]).toBeCloseTo(0);
  });

  it("returns a completed unselected stroke to the vertical track", () => {
    const stroke = {
      ...rectangle({
        id: "stroke",
        x: -60,
        y: -40,
        width: 200,
        height: 100,
      }),
      type: "freedraw",
      points: [
        [0, 0],
        [200, 100],
      ],
      lastCommittedPoint: [200, 100],
    } as unknown as ExcalidrawElement;
    const result = constrainWorkspaceCanvasOutliers([stroke]);

    expect(result.changed).toBe(true);
    expect(getCommonBounds(result.elements)[0]).toBeCloseTo(0);
    expect(getCommonBounds(result.elements)[1]).toBeCloseTo(0);
  });

  it("keeps extremely wide pasted text valid after fitting the track", () => {
    const text = {
      ...rectangle({
        id: "long-text",
        x: 0,
        y: 100,
        width: 120_000,
        height: 2_000,
      }),
      type: "text",
      fontSize: 20,
    } as unknown as ExcalidrawElement;
    const result = constrainWorkspaceCanvasSelection([text], {
      "long-text": true,
    });
    const nextText = result.elements[0] as unknown as {
      fontSize: number;
      width: number;
    };

    expect(result.changed).toBe(true);
    expect(nextText.width).toBeCloseTo(WORKSPACE_CANVAS_TRACK_WIDTH);
    expect(nextText.fontSize).toBe(1);
  });

  it("does not rewrite a selection that is already inside the track", () => {
    const element = rectangle({
      id: "inside",
      x: 100,
      y: 200,
      width: 300,
      height: 200,
    });
    const result = constrainWorkspaceCanvasSelection([element], {
      inside: true,
    });

    expect(result.changed).toBe(false);
    expect(result.elements[0]).toBe(element);
    expect(result.scale).toBe(1);
    expect(result.translation).toEqual({ x: 0, y: 0 });
  });

  it("returns a selection dropped below the technical boundary", () => {
    const element = rectangle({
      id: "too-low",
      x: 100,
      y: WORKSPACE_CANVAS_TRACK_MAX_Y + 40,
      width: 300,
      height: 200,
    });
    const result = constrainWorkspaceCanvasSelection([element], {
      "too-low": true,
    });

    expect(result.changed).toBe(true);
    expect(getCommonBounds(result.elements)[3]).toBeCloseTo(
      WORKSPACE_CANVAS_TRACK_MAX_Y,
    );
  });

  it("ignores deleted and unselected elements", () => {
    const deleted = {
      ...rectangle({
        id: "deleted",
        x: -500,
        y: -500,
        width: 100,
        height: 100,
      }),
      isDeleted: true,
    } as ExcalidrawElement;
    const result = constrainWorkspaceCanvasSelection([deleted], {
      deleted: true,
    });

    expect(result.changed).toBe(false);
    expect(result.elements[0]).toBe(deleted);
  });
});
