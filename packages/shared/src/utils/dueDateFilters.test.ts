import { afterEach, describe, expect, it, vi } from "vitest";

import { convertDueDateFiltersToRanges } from "./dueDateFilters";

describe("convertDueDateFiltersToRanges", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats deadlines earlier today as overdue", () => {
    const now = new Date("2026-08-20T15:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(convertDueDateFiltersToRanges(["overdue"])).toEqual([
      { endDate: now },
    ]);
  });
});
