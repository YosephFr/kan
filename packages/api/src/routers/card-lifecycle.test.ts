import { describe, expect, it } from "vitest";

import { deriveCardLifecycle } from "@kan/db/repository/card.repo";
import { inferListStatus } from "@kan/db/repository/list.repo";

describe("card lifecycle", () => {
  const movedAt = new Date("2026-08-20T12:00:00.000Z");
  const startedAt = new Date("2026-08-19T12:00:00.000Z");
  const completedAt = new Date("2026-08-20T10:00:00.000Z");

  it("starts execution when a card first enters an in-progress list", () => {
    expect(
      deriveCardLifecycle({
        destinationStatus: "inProgress",
        startedAt: null,
        movedAt,
      }),
    ).toEqual({ startedAt: movedAt, completedAt: null });
  });

  it("completes, preserves the original start and clears completion on reopen", () => {
    expect(
      deriveCardLifecycle({
        currentStatus: "inProgress",
        destinationStatus: "done",
        startedAt,
        movedAt,
      }),
    ).toEqual({ startedAt, completedAt: movedAt });

    expect(
      deriveCardLifecycle({
        currentStatus: "done",
        destinationStatus: "planned",
        startedAt,
        completedAt,
        movedAt,
      }),
    ).toEqual({ startedAt, completedAt: null });
  });

  it("does not reset completion while moving between done lists", () => {
    expect(
      deriveCardLifecycle({
        currentStatus: "done",
        destinationStatus: "done",
        startedAt,
        completedAt,
        movedAt,
      }),
    ).toEqual({ startedAt, completedAt });

    expect(
      deriveCardLifecycle({
        currentStatus: "done",
        destinationStatus: "done",
        startedAt: null,
        completedAt: null,
        movedAt,
      }),
    ).toEqual({ startedAt: null, completedAt: null });
  });
});

describe("list status inference", () => {
  it.each([
    ["Por hacer", "planned"],
    ["En progreso", "inProgress"],
    ["Estancado", "blocked"],
    ["Hecho", "done"],
    ["Ideas", null],
  ] as const)("maps %s safely", (name, status) => {
    expect(inferListStatus(name)).toBe(status);
  });
});
