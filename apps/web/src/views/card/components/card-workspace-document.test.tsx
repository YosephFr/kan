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
  cardTitle: "Unified card",
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
  whiteboardExtended: false,
  onWhiteboardExtendedChange: vi.fn(),
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
    expect(markup).toContain('id="card-view-whiteboard"');
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
      'aria-controls="card-workspace-whiteboard-content"',
    );
    expect(markup).toContain('id="card-workspace-subtasks-content"');
    expect(markup).toContain('id="card-workspace-whiteboard-content"');
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(markup).toContain("Activate subtasks");
    expect(markup).toContain("Open whiteboard");
  });

  it("keeps only the mounted whiteboard surface in the extended layout", () => {
    const markup = renderToStaticMarkup(
      <CardWorkspaceDocument {...defaultProps} hasCanvas whiteboardExtended />,
    );

    expect(markup).toContain("h-full max-w-none p-0");
    expect(markup).toContain('id="card-workspace-whiteboard-content"');
    expect(markup).toContain('data-dynamic-view="true"');
    expect(markup).toContain('id="card-workspace-whiteboard-heading"');
    expect(markup.match(/hidden=""/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
