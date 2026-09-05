import type { ReactNode } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UploadCardResource } from "./card-resource-types";
import { CardVisualWallResourceDialog } from "./CardVisualWallResourceDialog";

vi.mock("@headlessui/react", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogPanel: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("~/components/Button", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  ),
}));

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const resource: UploadCardResource = {
  publicId: "resource0001",
  kind: "upload",
  title: "Tall project image",
  contentType: "image/png",
  originalFilename: "project.png",
  size: 8_000_000,
  viewUrl: "/api/attachments/resource0001/view",
  downloadUrl: "/api/attachments/resource0001/download",
  createdAt: new Date("2026-09-04T00:00:00.000Z"),
};

const renderDialog = (
  existingPreviews?: Parameters<
    typeof CardVisualWallResourceDialog
  >[0]["existingPreviews"],
) =>
  renderToStaticMarkup(
    <CardVisualWallResourceDialog
      open
      resources={[resource]}
      existingPreviews={existingPreviews}
      busy={false}
      onClose={vi.fn()}
      onAdd={vi.fn()}
    />,
  );

describe("visual wall resource thumbnails", () => {
  it("reuses a known optimized preview instead of downloading the original", () => {
    const markup = renderDialog({
      resource0001: {
        viewUrl: "/api/visual-wall-resources/resource0001",
        widthPx: 320,
        heightPx: 1280,
      },
    });

    expect(markup).toContain('src="/api/visual-wall-resources/resource0001"');
    expect(markup).not.toContain("/api/attachments/resource0001/view");
  });

  it("uses the existing resource URL when no optimized preview exists", () => {
    const markup = renderDialog();

    expect(markup).toContain('src="/api/attachments/resource0001/view"');
    expect(markup).not.toContain("/api/visual-wall-resources/");
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('class="object-contain"');
  });
});
