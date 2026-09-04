import { describe, expect, it } from "vitest";

import { freeformUrlSchema, visualWallPlacementSchema } from "./visual-wall";

describe("visual wall schemas", () => {
  it("accepts a canonical iCloud Freeform share link", () => {
    expect(
      freeformUrlSchema.parse(
        "https://www.icloud.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg#CURSO_KING",
      ),
    ).toBe(
      "https://www.icloud.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg#CURSO_KING",
    );
  });

  it.each([
    "http://www.icloud.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg",
    "https://www.icloud.com:443/freeform/030IeLb0loqzSMI4Y7hlN6wyg",
    "https://www.icloud.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg?token=private",
    "https://icloud.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg",
    "https://example.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg",
  ])("rejects a non-canonical Freeform link", (value) => {
    expect(freeformUrlSchema.safeParse(value).success).toBe(false);
  });

  it("keeps wall coordinates bounded to safe integers", () => {
    expect(
      visualWallPlacementSchema.safeParse({
        x: 0,
        y: 0,
        width: 1_200,
        height: 44,
        zIndex: 0,
      }).success,
    ).toBe(true);
    expect(
      visualWallPlacementSchema.safeParse({
        x: Number.NaN,
        y: 0,
        width: 300,
        height: 200,
        zIndex: 0,
      }).success,
    ).toBe(false);
  });
});
