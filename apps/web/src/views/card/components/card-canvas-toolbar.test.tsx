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
    expect(markup).not.toContain('aria-label="Extend"');
  });

  it("offers an accessible extend toggle without an exit control when embedded", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        onToggleExtended={vi.fn()}
        extended={false}
      />,
    );

    expect(markup).not.toContain('aria-label="Leave whiteboard"');
    expect(markup).toContain('aria-label="Extend"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-label="More whiteboard actions"');
  });

  it("announces how to return to the card from the extended canvas", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        onToggleExtended={vi.fn()}
        extended
      />,
    );

    expect(markup).toContain('aria-label="Back to card"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it("keeps paste primary and moves image and link into the responsive group", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        onPaste={vi.fn()}
        onAddImage={vi.fn()}
        onAddLink={vi.fn()}
        onTogglePenMode={vi.fn()}
        penModeEnabled
      />,
    );

    expect(markup).toContain('aria-label="Paste"');
    expect(markup).toContain('aria-label="Image"');
    expect(markup).toContain('aria-label="Link"');
    expect(markup).toContain('aria-label="Disable pen mode"');
    expect(markup).toContain("h-11 min-w-11");
    expect(markup).toContain("card-canvas-toolbar-creative-actions");
    expect(markup.indexOf('aria-label="Paste"')).toBeLessThan(
      markup.indexOf("card-canvas-toolbar-creative-actions"),
    );
  });

  it("disables paste and exposes its busy state while clipboard work runs", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar {...defaultProps} onPaste={vi.fn()} pasteBusy />,
    );

    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Paste"[^>]*aria-busy="true"/,
    );
  });

  it("uses the canvas width to collapse secondary actions", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar {...defaultProps} onToggleExtended={vi.fn()} />,
    );

    expect(markup).toContain('style="container-type:inline-size"');
    expect(markup).toContain("card-canvas-toolbar-more");
    expect(markup).toContain("card-canvas-toolbar-actions");
    expect(markup).toContain("@container (min-width: 80rem)");
  });

  it("disables the image picker action while an import is in progress", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        onAddImage={vi.fn()}
        imageImportDisabled
      />,
    );

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Image"/);
  });

  it("disables link creation while another resource import is in progress", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        onAddLink={vi.fn()}
        linkImportDisabled
      />,
    );

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Link"/);
  });

  it("does not expose mutation controls in view-only mode", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasToolbar
        {...defaultProps}
        canEdit={false}
        onAddImage={vi.fn()}
        onAddLink={vi.fn()}
        onPaste={vi.fn()}
        onTogglePenMode={vi.fn()}
      />,
    );

    expect(markup).not.toContain('aria-label="Image"');
    expect(markup).not.toContain('aria-label="Link"');
    expect(markup).not.toContain('aria-label="Paste"');
    expect(markup).not.toContain("Enable pen mode");
    expect(markup).not.toContain(">Convert<");
    expect(markup).toContain('aria-label="More whiteboard actions"');
  });
});
