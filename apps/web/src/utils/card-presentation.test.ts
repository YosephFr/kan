import { describe, expect, it } from "vitest";

import {
  getChecklistProgress,
  getDeadlineProgress,
  isCardPriority,
} from "./card-presentation";

describe("isCardPriority", () => {
  it("accepts only supported priority query values", () => {
    expect(["urgent", "unknown", "none"].filter(isCardPriority)).toEqual([
      "urgent",
      "none",
    ]);
  });
});

describe("getChecklistProgress", () => {
  it("returns no progress when every checklist is empty", () => {
    expect(getChecklistProgress([{ items: [] }])).toBeNull();
  });

  it("combines items across checklists", () => {
    expect(
      getChecklistProgress([
        { items: [{ completed: true }, { completed: false }] },
        { items: [{ completed: true }] },
      ]),
    ).toEqual({ completed: 2, total: 3, percentage: 67 });
  });
});

describe("getDeadlineProgress", () => {
  const startedAt = new Date("2026-08-20T12:00:00.000Z");
  const dueDate = new Date("2026-08-22T12:00:00.000Z");

  it("requires both start and due date", () => {
    expect(getDeadlineProgress({ dueDate })).toBeNull();
  });

  it("marks the final day as due soon", () => {
    expect(
      getDeadlineProgress({
        startedAt,
        dueDate,
        now: new Date("2026-08-21T18:00:00.000Z"),
      }),
    ).toEqual({ percentage: 63, state: "dueSoon" });
  });

  it("freezes completion on time", () => {
    expect(
      getDeadlineProgress({
        startedAt,
        dueDate,
        completedAt: new Date("2026-08-21T12:00:00.000Z"),
        now: new Date("2026-08-25T12:00:00.000Z"),
      }),
    ).toEqual({ percentage: 50, state: "completedOnTime" });
  });

  it("marks a late completion independently from the current time", () => {
    expect(
      getDeadlineProgress({
        startedAt,
        dueDate,
        completedAt: new Date("2026-08-23T12:00:00.000Z"),
        now: new Date("2026-08-20T12:00:00.000Z"),
      }),
    ).toEqual({ percentage: 100, state: "completedLate" });
  });

  it("becomes overdue at the exact due time", () => {
    expect(getDeadlineProgress({ startedAt, dueDate, now: dueDate })).toEqual({
      percentage: 100,
      state: "overdue",
    });
  });
});
