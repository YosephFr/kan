import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import Button from "./Button";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("Button", () => {
  it("stays disabled while its action is loading", () => {
    const markup = renderToStaticMarkup(
      <Button isLoading disabled={false}>
        Save
      </Button>,
    );

    expect(markup).toContain("disabled");
  });

  it("respects an explicit disabled state when it is not loading", () => {
    const markup = renderToStaticMarkup(
      <Button isLoading={false} disabled>
        Save
      </Button>,
    );

    expect(markup).toContain("disabled");
  });
});
