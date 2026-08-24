import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CardCanvasZonesDrawer } from "./CardCanvasZonesDrawer";

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

const props = {
  frames: [],
  activeFramePublicId: null,
  isLoading: false,
  onClose: vi.fn(),
  onFocusFrame: vi.fn(),
};

describe("card canvas drawers", () => {
  it("removes a closed drawer from keyboard and assistive navigation", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasZonesDrawer {...props} open={false} />,
    );

    expect(markup).toContain('id="card-canvas-zones-drawer"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert="true"');
    expect(markup).toContain('aria-labelledby="card-canvas-zones-heading"');
  });

  it("makes an open drawer available as a labelled region", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasZonesDrawer {...props} open />,
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-hidden="false"');
    expect(markup).not.toContain('inert="true"');
    expect(markup).toContain("h-11 w-11");
  });
});
