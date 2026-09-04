import { describe, expect, it } from "vitest";

import {
  clampVisualWallRect,
  getVisualWallLogicalHeight,
  isFreeformShareUrl,
  normalizeVisualWallRect,
  placeVisualWallImages,
  resizeVisualWallRect,
  VISUAL_WALL_LOGICAL_WIDTH,
  VISUAL_WALL_MAX_LOGICAL_HEIGHT,
} from "./visual-wall-layout";

describe("visual wall layout", () => {
  it("keeps moved images inside the fixed horizontal track", () => {
    expect(
      clampVisualWallRect({ x: 1_150, y: -40, width: 300, height: 150 }),
    ).toEqual({ x: 900, y: 0, width: 300, height: 150 });
  });

  it("shrinks over-wide images proportionally", () => {
    expect(
      clampVisualWallRect({ x: 0, y: 20, width: 2_400, height: 1_200 }),
    ).toEqual({
      x: 0,
      y: 20,
      width: VISUAL_WALL_LOGICAL_WIDTH,
      height: 600,
    });
  });

  it("resizes without changing the aspect ratio", () => {
    const resized = resizeVisualWallRect(
      { x: 0, y: 0, width: 400, height: 200 },
      100,
      50,
    );
    expect(resized.width / resized.height).toBe(2);
    expect(resized.width).toBe(500);
  });

  it("normalizes pointer coordinates to bounded integers before saving", () => {
    const normalized = normalizeVisualWallRect({
      x: 1_149.7,
      y: 20.4,
      width: 300.2,
      height: 150.1,
    });
    expect(normalized).toEqual({ x: 900, y: 20, width: 300, height: 150 });
    expect(Object.values(normalized).every(Number.isInteger)).toBe(true);
  });

  it("prevents items from crossing the safe vertical limit", () => {
    const normalized = normalizeVisualWallRect({
      x: 0,
      y: 999_999,
      width: 300,
      height: 300,
    });
    expect(normalized.y + normalized.height).toBe(
      VISUAL_WALL_MAX_LOGICAL_HEIGHT,
    );
  });

  it("keeps API-safe boxes for ultra-wide and ultra-tall images", () => {
    const wide = normalizeVisualWallRect({
      x: 0,
      y: 0,
      width: 1_200,
      height: 0.5,
    });
    const tall = normalizeVisualWallRect({
      x: 0,
      y: 100,
      width: 120,
      height: 2_000_000,
    });
    expect(wide.height).toBe(44);
    expect(tall.height).toBeGreaterThanOrEqual(44);
    expect(tall.y + tall.height).toBeLessThanOrEqual(
      VISUAL_WALL_MAX_LOGICAL_HEIGHT,
    );
  });

  it("grows vertically with the lowest image", () => {
    expect(getVisualWallLogicalHeight([{ y: 1_000, height: 300 }])).toBe(1_460);
  });

  it("places new images below existing work without horizontal overflow", () => {
    const placed = placeVisualWallImages(
      [{ x: 0, y: 0, width: 600, height: 400 }],
      Array.from({ length: 4 }, () => ({ width: 1_600, height: 900 })),
    );
    expect(placed[0]?.y).toBe(448);
    expect(placed[3]?.y).toBeGreaterThan(placed[0]?.y ?? 0);
    expect(placed.every((item) => item.x + item.width <= 1_200)).toBe(true);
  });

  it("accepts only direct HTTPS iCloud Freeform share links", () => {
    expect(
      isFreeformShareUrl(
        "https://www.icloud.com/freeform/030IeLb0loqzSMI4Y7hlN6wyg#CURSO_KING",
      ),
    ).toBe(true);
    expect(isFreeformShareUrl("https://icloud.com/freeform/1234567890")).toBe(
      false,
    );
    expect(
      isFreeformShareUrl(
        "https://www.icloud.com/freeform/1234567890?secret=value",
      ),
    ).toBe(false);
    expect(
      isFreeformShareUrl("https://www.icloud.com.evil.test/freeform/x"),
    ).toBe(false);
    expect(isFreeformShareUrl("https://www.icloud.com:444/freeform/x")).toBe(
      false,
    );
    expect(
      isFreeformShareUrl(
        "https://www.icloud.com:443/freeform/030IeLb0loqzSMI4Y7hlN6wyg",
      ),
    ).toBe(false);
    expect(isFreeformShareUrl("http://www.icloud.com/freeform/x")).toBe(false);
  });
});
