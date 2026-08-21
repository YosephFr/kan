import { describe, expect, it } from "vitest";

import { getBoardResourceCount, getBoardUploadCount } from "./resource-summary";

describe("getBoardUploadCount", () => {
  it("counts each omitted upload across the source board", () => {
    expect(
      getBoardUploadCount([
        {
          cards: [
            { resourceSummary: { uploads: 2 } },
            { resourceSummary: { uploads: 0 } },
          ],
        },
        { cards: [{ resourceSummary: { uploads: 3 } }] },
      ]),
    ).toBe(5);
  });
});

describe("getBoardResourceCount", () => {
  it("sums resources across every card", () => {
    expect(
      getBoardResourceCount([
        {
          cards: [
            { resourceSummary: { total: 4 } },
            { resourceSummary: { total: 1 } },
          ],
        },
        { cards: [{ resourceSummary: { total: 3 } }] },
      ]),
    ).toBe(8);
  });
});
