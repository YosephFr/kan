import { describe, expect, it } from "vitest";

import {
  getCardCanvasPastedWebLink,
  getSingleHttpsClipboardUrl,
  normalizeCardWebLink,
} from "./card-web-link";

describe("card web links", () => {
  it("accepts one HTTPS URL and normalizes it", () => {
    expect(normalizeCardWebLink("  https://example.com/idea?q=1  ")).toBe(
      "https://example.com/idea?q=1",
    );
  });

  it.each([
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/one https://example.com/two",
    "not a link",
  ])("rejects an unsafe or non-singular value: %s", (value) => {
    expect(normalizeCardWebLink(value)).toBeNull();
  });

  it("detects a single pasted HTTPS URL", () => {
    expect(
      getSingleHttpsClipboardUrl({ text: "https://example.com/whiteboard" }),
    ).toBe("https://example.com/whiteboard");
  });

  it("does not turn image or scene clipboard data into a web resource", () => {
    expect(
      getSingleHttpsClipboardUrl({
        text: "https://example.com/image.png",
        mixedContent: [
          { type: "imageUrl", value: "https://example.com/image.png" },
        ],
      }),
    ).toBeNull();
    expect(
      getSingleHttpsClipboardUrl({
        text: "https://example.com",
        elements: [{ type: "rectangle" } as never],
      }),
    ).toBeNull();
  });

  it("leaves URL text untouched while a text element is being edited", () => {
    expect(
      getCardCanvasPastedWebLink(
        { text: "https://example.com/whiteboard" },
        true,
      ),
    ).toBeNull();
  });
});
