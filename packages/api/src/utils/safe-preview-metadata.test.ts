import { describe, expect, it } from "vitest";

import { extractSafePreviewMetadata } from "./safe-preview-metadata";
import { SAFE_PREVIEW_LIMITS } from "./safe-preview-types";

describe("extractSafePreviewMetadata", () => {
  it("prefers Open Graph values and resolves an HTTPS image", () => {
    const metadata = extractSafePreviewMetadata(
      `
        <title>Document title</title>
        <meta content="Twitter title" name="twitter:title">
        <meta content="Open Graph title" property="og:title">
        <meta content="Kan Workspace" property="og:site_name">
        <meta content="Private &amp; useful" property="og:description">
        <meta content="/preview.png#fragment" property="og:image">
      `,
      "https://www.example.com/cards/one",
    );

    expect(metadata).toEqual({
      title: "Open Graph title",
      siteName: "Kan Workspace",
      description: "Private & useful",
      imageUrl: "https://www.example.com/preview.png",
    });
  });

  it("falls back to the hostname and null optional metadata", () => {
    expect(
      extractSafePreviewMetadata("<html></html>", "https://www.example.com/a"),
    ).toEqual({
      title: "example.com",
      siteName: "example.com",
      description: null,
      imageUrl: null,
    });
  });

  it("sanitizes tags, entities, controls, bidi overrides, and whitespace", () => {
    const metadata = extractSafePreviewMetadata(
      `
        <meta property="og:title" content="  A &lt;b&gt;safe&lt;/b&gt;\u0000 title\u202e  ">
        <meta property="og:site_name" content=" Site\u2066 &amp; Name ">
        <meta name="description" content=" One   &quot;line&quot; ">
      `,
      "https://example.com",
    );

    expect(metadata).toMatchObject({
      title: "A safe title",
      siteName: "Site & Name",
      description: 'One "line"',
    });
  });

  it("caps values at the persistible title and description limits", () => {
    const metadata = extractSafePreviewMetadata(
      `
        <meta property="og:title" content="${"t".repeat(300)}">
        <meta property="og:site_name" content="${"s".repeat(300)}">
        <meta name="description" content="${"d".repeat(700)}">
      `,
      "https://example.com",
    );

    expect(metadata.title).toHaveLength(SAFE_PREVIEW_LIMITS.titleCharacters);
    expect(metadata.siteName).toHaveLength(SAFE_PREVIEW_LIMITS.titleCharacters);
    expect(metadata.description).toHaveLength(
      SAFE_PREVIEW_LIMITS.descriptionCharacters,
    );
  });

  it.each([
    "http://example.com/image.png",
    "https://127.0.0.1/image.png",
    "https://user:secret@example.com/image.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
  ])("drops unsafe image URL %s", (imageUrl) => {
    const metadata = extractSafePreviewMetadata(
      `<meta property="og:image" content="${imageUrl}">`,
      "https://example.com",
    );
    expect(metadata.imageUrl).toBeNull();
  });

  it("uses only the first value for duplicate metadata", () => {
    const metadata = extractSafePreviewMetadata(
      `
        <meta property="og:title" content="First">
        <meta property="og:title" content="Second">
      `,
      "https://example.com",
    );
    expect(metadata.title).toBe("First");
  });
});
