import { describe, expect, it, vi } from "vitest";

import { applySavedVisualWallChange } from "./visual-wall-cache";

const snapshot = {
  exists: true,
  version: 4,
  updatedAt: new Date("2026-09-04T12:00:00Z"),
  items: [{ publicId: "image0000001", x: 24 }],
};
const saved = { version: 5, updatedAt: new Date("2026-09-04T12:01:00Z") };

describe("applySavedVisualWallChange", () => {
  it("applies an acknowledged mutation without another snapshot request", () => {
    const result = applySavedVisualWallChange(snapshot, saved, (current) => ({
      ...current,
      items: current.items.map((item) => ({ ...item, x: 240 })),
    }));

    expect(result).toEqual({
      ...snapshot,
      ...saved,
      items: [{ publicId: "image0000001", x: 240 }],
    });
    expect(snapshot.items[0]?.x).toBe(24);
  });

  it("preserves a newer remote snapshot without replaying an old patch", () => {
    const newer = { ...snapshot, version: 6 };
    const update = vi.fn();

    expect(applySavedVisualWallChange(newer, saved, update)).toBe(newer);
    expect(update).not.toHaveBeenCalled();
  });

  it("requires a fresh snapshot if intervening revisions are missing", () => {
    const update = vi.fn();

    expect(
      applySavedVisualWallChange(snapshot, { ...saved, version: 7 }, update),
    ).toBeUndefined();
    expect(
      applySavedVisualWallChange(undefined, saved, update),
    ).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("marks a lazily created wall as existing after its first save", () => {
    const result = applySavedVisualWallChange(
      { ...snapshot, exists: false, version: 0 },
      { ...saved, version: 1 },
      (current) => current,
    );

    expect(result?.exists).toBe(true);
    expect(result?.version).toBe(1);
  });
});
