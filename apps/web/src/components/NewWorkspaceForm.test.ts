import { describe, expect, it } from "vitest";

import { buildWorkspaceCreateInput } from "../utils/workspace";

describe("buildWorkspaceCreateInput", () => {
  it("omits an empty optional workspace slug", () => {
    expect(buildWorkspaceCreateInput("Barbería Hernández", "")).toEqual({
      name: "Barbería Hernández",
    });
  });

  it("keeps a custom workspace slug", () => {
    expect(
      buildWorkspaceCreateInput("Barbería Hernández", "barberia-hernandez"),
    ).toEqual({
      name: "Barbería Hernández",
      slug: "barberia-hernandez",
    });
  });
});
