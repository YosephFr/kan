import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { WorkspaceGoalsSection } from "./WorkspaceGoalsSection";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("./WorkspaceVisualWall", () => ({
  WorkspaceVisualWall: ({
    workspacePublicId,
  }: {
    workspacePublicId: string;
  }) => <div data-workspace-wall={workspacePublicId} />,
}));

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("WorkspaceGoalsSection", () => {
  it("renders the lightweight visual wall without an Excalidraw asset loader", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceGoalsSection
        workspacePublicId="workspace001"
        workspaceName="Academia"
        canEdit
      />,
    );

    expect(markup).toContain("Visual references for Academia");
    expect(markup).toContain('data-workspace-wall="workspace001"');
    expect(markup).not.toContain("excalidraw");
    expect(markup).not.toContain("workspace-whiteboard");
  });
});
