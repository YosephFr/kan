import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CardCanvasToolbar } from "./CardCanvasToolbar";

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

const defaultProps = {
  saveState: "saved" as const,
  canEdit: true,
  onToggleZones: vi.fn(),
  onToggleResources: vi.fn(),
  onToggleHistory: vi.fn(),
  onConvert: vi.fn(),
  onExport: vi.fn(),
};

describe("CardCanvasToolbar", () => {
  it("keeps the existing exit control for standalone whiteboards", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        cardTitle="Launch plan"
        onExit={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Leave whiteboard"');
    expect(markup).toContain("Launch plan");
    expect(markup).not.toContain('aria-label="Focus whiteboard"');
  });

  it("offers an accessible focus toggle without an exit control when embedded", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        onToggleFocus={vi.fn()}
        focusModeEnabled={false}
      />,
    );

    expect(markup).not.toContain('aria-label="Leave whiteboard"');
    expect(markup).toContain('aria-label="Focus whiteboard"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("announces how to leave focus mode", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        onToggleFocus={vi.fn()}
        focusModeEnabled
      />,
    );

    expect(markup).toContain('aria-label="Exit focus"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
