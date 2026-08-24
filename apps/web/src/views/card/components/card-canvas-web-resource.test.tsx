import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { WebCardResource } from "./card-resource-types";
import {
  CardCanvasWebResourceCard,
  getWebResourcePreviewImage,
} from "./CardCanvasWebResourceCard";

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

const resource: WebCardResource = {
  kind: "web",
  publicId: "resource0001",
  title: "Creative reference",
  openUrl: "https://www.example.com/ideas/one?private=marker",
  description: "A concise visual reference",
  siteName: "Example Studio",
  previewImageUrl: "/api/resources/resource0001/preview-image",
  createdAt: new Date(0),
};

describe("CardCanvasWebResourceCard", () => {
  it("renders safe metadata and an explicit external action without an iframe", () => {
    const markup = renderToStaticMarkup(
      <CardCanvasWebResourceCard
        resource={resource}
        onOpenResource={vi.fn()}
      />,
    );

    expect(markup).toContain("Creative reference");
    expect(markup).toContain("Example Studio");
    expect(markup).toContain("example.com");
    expect(markup).toContain("A concise visual reference");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain("Open link");
    expect(markup).not.toContain("<iframe");
  });

  it("only accepts the expected same-origin preview image route", () => {
    expect(getWebResourcePreviewImage(resource)).toBe(
      "/api/resources/resource0001/preview-image",
    );
    expect(
      getWebResourcePreviewImage({
        ...resource,
        previewImageUrl: "https://tracker.example/pixel.png",
      }),
    ).toBeNull();
  });
});
