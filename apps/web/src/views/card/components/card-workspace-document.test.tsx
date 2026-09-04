import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CardWorkspaceDocument } from "./CardWorkspaceDocument";

vi.mock("next/router", () => ({
  useRouter: () => ({
    isReady: true,
    pathname: "/cards/[cardId]",
    query: {},
    replace: vi.fn(),
  }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicView() {
      return <div data-dynamic-view="true" />;
    },
}));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("~/utils/card-workspace", () => ({
  getCardWorkspaceNavigationQuery: (query: object) => query,
  getCardWorkspaceTargetView: () => null,
}));

vi.mock("./CardSubtasksView", () => ({
  CardSubtasksView: () => <div data-subtasks-view="true" />,
}));

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const defaultProps = {
  cardPublicId: "cardpublic01",
  members: [],
  canEdit: true,
  isPublicBoard: false,
  subtaskSummary: {
    total: 0,
    completed: 0,
    blocked: 0,
    progressPercent: 0,
  },
  resourceSummary: { total: 0, uploads: 0, driveLinks: 0, webLinks: 0 },
  hasCanvas: false,
  preferenceScope: "test-user",
  summaryContent: <p>Summary content</p>,
  activityContent: <p>Activity content</p>,
};

describe("CardWorkspaceDocument", () => {
  it("renders one document without mounting optional empty workspaces", () => {
    const markup = renderToStaticMarkup(
      <CardWorkspaceDocument {...defaultProps} />,
    );

    expect(markup).toContain('id="card-view-summary"');
    expect(markup).toContain('id="card-view-files"');
    expect(markup).toContain('id="card-view-subtasks"');
    expect(markup).toContain('id="card-view-visual-wall"');
    expect(markup).toContain("Summary content");
    expect(markup).toContain("Activity content");
    expect(markup).not.toContain('role="tabpanel"');
    expect(markup).not.toContain('data-subtasks-view="true"');
    expect(markup.match(/data-dynamic-view="true"/g)).toHaveLength(1);
  });

  it("exposes accessible disclosure controls for optional sections", () => {
    const markup = renderToStaticMarkup(
      <CardWorkspaceDocument {...defaultProps} />,
    );

    expect(markup).toContain('aria-controls="card-workspace-subtasks-content"');
    expect(markup).toContain(
      'aria-controls="card-workspace-visual-wall-content"',
    );
    expect(markup).toContain('id="card-workspace-subtasks-content"');
    expect(markup).toContain('id="card-workspace-visual-wall-content"');
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(markup).toContain("Activate subtasks");
    expect(markup).toContain("Visual wall");
  });

  it("mounts the visual wall for cards with legacy canvas content without hiding the document", () => {
    const markup = renderToStaticMarkup(
      <CardWorkspaceDocument {...defaultProps} hasCanvas />,
    );

    expect(markup).toContain('id="card-workspace-visual-wall-content"');
    expect(markup).toContain('id="card-workspace-visual-wall-heading"');
    expect(markup.match(/data-dynamic-view="true"/g)).toHaveLength(1);
    expect(markup).toContain("Summary content");
    expect(markup).toContain("Activity content");
  });
});
