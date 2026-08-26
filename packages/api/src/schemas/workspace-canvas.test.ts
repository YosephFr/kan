import { describe, expect, it } from "vitest";

import {
  prepareWorkspaceCanvasScene,
  WorkspaceCanvasPolicyError,
} from "@kan/db/repository/workspaceCanvas.repo";
import { MAX_CARD_CANVAS_ELEMENTS } from "@kan/shared";

import { workspaceCanvasSceneSchema } from "./workspace-canvas";

const shape = (id: string) => ({ id, type: "rectangle" });

describe("workspace canvas scene", () => {
  it("accepts exactly the element limit and rejects excess before parsing", () => {
    const atLimit = Array.from(
      { length: MAX_CARD_CANVAS_ELEMENTS },
      (_, index) => shape(`shape-${index}`),
    );
    expect(
      workspaceCanvasSceneSchema.safeParse({
        elements: atLimit,
        appState: {},
      }).success,
    ).toBe(true);
    expect(
      workspaceCanvasSceneSchema.safeParse({
        elements: [...atLimit, shape("excess")],
        appState: {},
      }),
    ).toMatchObject({
      success: false,
      error: { issues: [{ message: "TOO_MANY_ELEMENTS" }] },
    });
  });

  it.each([
    {
      id: "frame",
      type: "frame",
      customData: { kanFramePublicId: "frame0000001" },
    },
    {
      id: "embed",
      type: "embeddable",
      link: "kan-subtask:subtask00001",
    },
    {
      id: "linked-shape",
      type: "rectangle",
      link: "kan-resource:image0000001",
    },
  ])("rejects card-only scene element $id", async (element) => {
    await expect(
      prepareWorkspaceCanvasScene({ elements: [element], appState: {} }),
    ).rejects.toBeInstanceOf(WorkspaceCanvasPolicyError);
  });

  it("keeps image references available for transactional validation", async () => {
    const prepared = await prepareWorkspaceCanvasScene({
      elements: [
        {
          id: "image",
          type: "image",
          customData: { kanResourcePublicId: "image0000001" },
          link: "kan-resource:image0000001",
        },
      ],
      appState: {},
    });
    expect(prepared.resources).toEqual([
      { publicId: "image0000001", elementId: "image" },
    ]);
  });

  it("rejects a link-only image reference before persistence", async () => {
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [
          {
            id: "link-only-image",
            type: "image",
            link: "kan-resource:image0000001",
          },
        ],
        appState: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_CUSTOM_DATA" });
  });

  it("rejects external element links instead of persisting a URL", async () => {
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [
          {
            id: "external-link",
            type: "text",
            text: "Sitio",
            link: "https://example.com/private?token=secret",
          },
        ],
        appState: {},
      }),
    ).rejects.toMatchObject({
      name: "CardCanvasSceneError",
      code: "UNSAFE_LINK",
    });
  });

  it.each([
    { id: "negative-x", x: -1, y: 0, width: 10, height: 10 },
    { id: "negative-y", x: 0, y: -1, width: 10, height: 10 },
    { id: "past-width", x: 1_101, y: 0, width: 100, height: 10 },
    {
      id: "past-vertical-limit",
      x: 0,
      y: 999_901,
      width: 100,
      height: 100,
    },
    {
      id: "rotation-past-origin",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      angle: Math.PI / 4,
    },
  ])("rejects an element outside the vertical track: $id", async (element) => {
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [{ ...element, type: "rectangle" }],
        appState: {},
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CANVAS_OUT_OF_BOUNDS" });
  });

  it("accepts exact horizontal and upper track boundaries", async () => {
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [
          {
            id: "exact-boundary",
            type: "rectangle",
            x: 1_000,
            y: 0,
            width: 200,
            height: 100,
          },
          {
            id: "exact-vertical-boundary",
            type: "rectangle",
            x: 0,
            y: 999_900,
            width: 100,
            height: 100,
          },
        ],
        appState: {},
      }),
    ).resolves.toMatchObject({ elementCount: 2 });
  });

  it("uses linear points for right-to-left arrows and freehand bounds", async () => {
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [
          {
            id: "right-to-left",
            type: "arrow",
            x: 1_000,
            y: 100,
            width: 500,
            height: 0,
            points: [
              [0, 0],
              [-500, 0],
            ],
          },
          {
            id: "negative-local-freehand",
            type: "freedraw",
            x: 600,
            y: 200,
            width: 200,
            height: 100,
            points: [
              [-100, 0],
              [0, 100],
              [100, 20],
            ],
          },
        ],
        appState: {},
      }),
    ).resolves.toMatchObject({ elementCount: 2 });
  });

  it("rejects a linear point that leaves the track", async () => {
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [
          {
            id: "arrow-outside-left",
            type: "arrow",
            x: 100,
            y: 100,
            width: 400,
            height: 0,
            points: [
              [0, 0],
              [-400, 0],
            ],
          },
        ],
        appState: {},
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CANVAS_OUT_OF_BOUNDS" });
  });

  it("uses rotated and freehand points for the vertical limit", async () => {
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [
          {
            id: "freehand-past-bottom",
            type: "freedraw",
            x: 200,
            y: 999_950,
            width: 100,
            height: 100,
            points: [
              [0, 0],
              [10, 60],
            ],
          },
        ],
        appState: {},
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CANVAS_OUT_OF_BOUNDS" });
    await expect(
      prepareWorkspaceCanvasScene({
        elements: [
          {
            id: "rotated-past-bottom",
            type: "rectangle",
            x: 100,
            y: 999_900,
            width: 100,
            height: 100,
            angle: Math.PI / 4,
          },
        ],
        appState: {},
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CANVAS_OUT_OF_BOUNDS" });
  });
});
