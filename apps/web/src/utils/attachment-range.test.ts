import { describe, expect, it } from "vitest";

import { parseAttachmentRange } from "./attachment-range";

describe("parseAttachmentRange", () => {
  it.each([
    ["bytes=0-4", { start: 0, end: 4, length: 5, header: "bytes=0-4" }],
    ["bytes=5-", { start: 5, end: 9, length: 5, header: "bytes=5-9" }],
    ["bytes=-3", { start: 7, end: 9, length: 3, header: "bytes=7-9" }],
  ])("normalizes %s", (value, expected) => {
    expect(parseAttachmentRange(value, 10)).toEqual(expected);
  });

  it.each(["bytes=", "items=0-1", "bytes=10-11", "bytes=4-2", "bytes=0-1,4-5"])(
    "rejects %s",
    (value) => {
      expect(parseAttachmentRange(value, 10)).toBe("invalid");
    },
  );
});
