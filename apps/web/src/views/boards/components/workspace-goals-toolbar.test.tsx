import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { WorkspaceGoalsToolbar } from "./WorkspaceGoalsToolbar";

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
  workspaceName: "Barbería Hernández",
  saveState: "saved" as const,
  canEdit: true,
  extended: false,
  penModeEnabled: false,
  historyOpen: false,
  onPaste: vi.fn(),
  onAddImage: vi.fn(),
  onTogglePenMode: vi.fn(),
  onHome: vi.fn(),
  onToggleHistory: vi.fn(),
  onExport: vi.fn(),
  onToggleExtended: vi.fn(),
  onRetrySave: vi.fn(),
};

describe("WorkspaceGoalsToolbar", () => {
  it("keeps the creative tablet actions reachable", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceGoalsToolbar {...defaultProps} />,
    );

    expect(markup).toContain('aria-label="Paste"');
    expect(markup).toContain('aria-label="Image"');
    expect(markup).toContain('aria-label="Enable pen mode"');
    expect(markup).toContain('aria-label="Back to the beginning"');
    expect(markup).toContain('aria-label="Extend"');
    expect(markup).toContain("h-11 min-w-11");
  });

  it("keeps navigation and export but removes mutations in read-only mode", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceGoalsToolbar {...defaultProps} canEdit={false} />,
    );

    expect(markup).not.toContain('aria-label="Paste"');
    expect(markup).not.toContain('aria-label="Image"');
    expect(markup).not.toContain('aria-label="Enable pen mode"');
    expect(markup).not.toContain('aria-label="History"');
    expect(markup).toContain('aria-label="Back to the beginning"');
    expect(markup).toContain('aria-label="Export"');
    expect(markup).toContain('aria-label="Extend"');
  });

  it("announces how to return from the same extended instance", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceGoalsToolbar {...defaultProps} extended />,
    );

    expect(markup).toContain('aria-label="Back to boards"');
    expect(markup).toContain("Vision and goals for Barbería Hernández");
  });

  it("keeps the essential actions visible and gives compact actions exclusive responsive slots", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceGoalsToolbar {...defaultProps} />,
    );

    expect(markup.match(/aria-label="Paste"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Back to the beginning"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Extend"/g)).toHaveLength(1);
    expect(markup).toContain(
      '<div class="hidden min-[480px]:block"><button type="button" aria-label="Image"',
    );
    expect(markup).toContain(
      '<div class="hidden min-[480px]:block"><button type="button" aria-label="Enable pen mode"',
    );

    const compactMenu = markup.slice(
      markup.indexOf('<details class="relative shrink-0 min-[480px]:hidden">'),
    );
    expect(compactMenu).toContain("More whiteboard actions");
    expect(compactMenu).toContain("Image</button>");
    expect(compactMenu).toContain("Enable pen mode</button>");
  });

  it("offers an explicit recovery action after a save failure", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceGoalsToolbar {...defaultProps} saveState="error" />,
    );

    expect(markup).toContain('aria-label="Try saving again"');
  });

  it("disables every image picker while a paste is running", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceGoalsToolbar {...defaultProps} pasteBusy />,
    );

    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
