import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PopupProvider } from "../../providers/popup";
import { clearSettledVisualWallPatch, VisualWall } from "./VisualWall";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const handlers = {
  onFiles: vi.fn(),
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
  onSetFreeformUrl: vi.fn(),
};

const renderWall = (canEdit: boolean) =>
  renderToStaticMarkup(
    <PopupProvider>
      <VisualWall
        label="Project visuals"
        items={[
          {
            publicId: "wallitem0001",
            resourcePublicId: "wallimage001",
            title: "Campaign",
            viewUrl: "/api/workspace-canvas-images/wallimage001",
            x: 24,
            y: 24,
            width: 320,
            height: 180,
            zIndex: 1,
          },
        ]}
        canEdit={canEdit}
        freeformUrl="https://www.icloud.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg#CURSO_KING"
        {...handlers}
      />
    </PopupProvider>,
  );

describe("VisualWall", () => {
  it("keeps read-only previews and the safe Freeform exit available", () => {
    const markup = renderWall(false);

    expect(markup).toContain("Campaign");
    expect(markup).toContain("Open in Freeform");
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).not.toContain("Add images");
    expect(markup).not.toContain("Paste");
    expect(markup).not.toContain("Change link");
  });

  it("shows image and link actions to editors", () => {
    const markup = renderWall(true);

    expect(markup).toContain("Add images");
    expect(markup).toContain("Paste");
    expect(markup).toContain("Change link");
    expect(markup).toContain("relative isolate");
  });

  it("rolls back a settled optimistic patch without clearing a newer edit", () => {
    const firstPatch = { x: 10, y: 20, width: 300, height: 200, zIndex: 1 };
    const secondPatch = { x: 30, y: 40, width: 300, height: 200, zIndex: 2 };

    expect(
      clearSettledVisualWallPatch(
        { wallitem0001: firstPatch },
        "wallitem0001",
        firstPatch,
      ),
    ).toEqual({});
    expect(
      clearSettledVisualWallPatch(
        { wallitem0001: secondPatch },
        "wallitem0001",
        firstPatch,
      ),
    ).toEqual({ wallitem0001: secondPatch });
  });
});
