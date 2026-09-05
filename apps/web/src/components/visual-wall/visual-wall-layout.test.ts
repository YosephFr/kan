import { describe, expect, it } from "vitest";

import {
  clampVisualWallRect,
  getVisualWallImageDimensions,
  getVisualWallLogicalHeight,
  isFreeformShareUrl,
  normalizeVisualWallRect,
  placeVisualWallImages,
  resizeVisualWallRect,
  VISUAL_WALL_LOGICAL_WIDTH,
  VISUAL_WALL_MAX_LOGICAL_HEIGHT,
} from "./visual-wall-layout";

describe("visual wall layout", () => {
  it("uses natural image proportions instead of a legacy placement box", () => {
    expect(
      getVisualWallImageDimensions({
        width: 320,
        height: 180,
        widthPx: 960,
        heightPx: 1_280,
      }),
    ).toEqual({ width: 960, height: 1_280 });
  });

  it("uses placement dimensions when legacy natural dimensions are unavailable", () => {
    expect(
      getVisualWallImageDimensions({
        width: 320,
        height: 180,
        widthPx: null,
        heightPx: null,
      }),
    ).toEqual({ width: 320, height: 180 });
  });

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

  it("grows panoramic images proportionally to the minimum usable height", () => {
    const panorama = clampVisualWallRect({
      x: 24,
      y: 24,
      width: 320,
      height: 20,
    });
    expect(panorama).toEqual({ x: 24, y: 24, width: 704, height: 44 });
    expect(panorama.width / panorama.height).toBe(16);
  });

  it("preserves the proportions of long screenshots", () => {
    const screenshot = clampVisualWallRect({
      x: 24,
      y: 24,
      width: 120,
      height: 15_360,
    });
    expect(screenshot.width / screenshot.height).toBe(1 / 128);
    expect(screenshot.height).toBe(15_360);
  });

  it("shrinks tall images proportionally at the safe vertical boundary", () => {
    const screenshot = clampVisualWallRect({
      x: 24,
      y: 100,
      width: 120,
      height: 2_000_000,
    });
    expect(screenshot).toEqual({
      x: 24,
      y: 0,
      width: 60,
      height: 1_000_000,
    });
    expect(screenshot.width / screenshot.height).toBe(120 / 2_000_000);
  });

  it("keeps the ratio when a resize handle crosses the opposite corner", () => {
    const resized = resizeVisualWallRect(
      { x: 24, y: 24, width: 320, height: 160 },
      -1_000,
      -1_000,
    );
    expect(resized).toEqual({ x: 24, y: 24, width: 120, height: 60 });
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

  it("places panoramas and long screenshots with their actual proportions", () => {
    const placed = placeVisualWallImages(
      [],
      [
        { width: 1_600, height: 100 },
        { width: 10, height: 1_280 },
      ],
    );
    expect(placed[0]?.width).toBe(704);
    expect(placed[0]?.height).toBe(44);
    expect(placed[1]?.width).toBe(320);
    expect(placed[1]?.height).toBe(40_960);
  });

  it("places uploaded images with integer dimensions accepted by the API", () => {
    const placed = placeVisualWallImages([], [{ width: 1_280, height: 723 }]);
    expect(placed[0]).toEqual({ x: 24, y: 24, width: 320, height: 181 });
    expect(
      placed.every((image) => Object.values(image).every(Number.isInteger)),
    ).toBe(true);
  });

  it("keeps wrapped rows bounded when existing work reaches the vertical limit", () => {
    const placed = placeVisualWallImages(
      [{ x: 0, y: 999_900, width: 600, height: 100 }],
      Array.from({ length: 4 }, () => ({ width: 1_600, height: 900 })),
    );
    expect(
      placed.every(
        (image) =>
          image.y >= 0 &&
          image.y + image.height <= VISUAL_WALL_MAX_LOGICAL_HEIGHT,
      ),
    ).toBe(true);
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
