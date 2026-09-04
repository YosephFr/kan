import { describe, expect, it } from "vitest";

import { normalizeCardWebLink } from "./card-web-link";

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
});
