import { describe, expect, it } from "vitest";

import type { PulseSource } from "./metrics";
import { buildPulseSummary, classifyListName } from "./metrics";

const now = new Date("2026-07-21T12:00:00.000Z");

const source = {
  workspace: {
    publicId: "workspace1234",
    name: "Imanleads",
    weekStartDay: 1,
    cardPrefix: "IMA",
  },
  boards: [{ id: 1, publicId: "board123456", name: "IA" }],
  lists: [
    { id: 10, publicId: "planned12345", name: "Por hacer", boardId: 1 },
    { id: 11, publicId: "progress1234", name: "En curso", boardId: 1 },
    { id: 12, publicId: "blocked12345", name: "Bloqueado", boardId: 1 },
    { id: 13, publicId: "done12345678", name: "Listo", boardId: 1 },
  ],
  cards: [
    {
      id: 100,
      publicId: "card10000000",
      title: "Plan antiguo",
      cardNumber: 1,
      listId: 10,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      dueDate: null,
    },
    {
      id: 101,
      publicId: "card10100000",
      title: "Implementación",
      cardNumber: 2,
      listId: 11,
      createdAt: new Date("2026-07-10T12:00:00.000Z"),
      dueDate: new Date("2026-07-19T12:00:00.000Z"),
    },
    {
      id: 102,
      publicId: "card10200000",
      title: "Dependencia externa",
      cardNumber: 3,
      listId: 12,
      createdAt: new Date("2026-07-18T10:00:00.000Z"),
      dueDate: null,
    },
    {
      id: 103,
      publicId: "card10300000",
      title: "Entrega semanal",
      cardNumber: 4,
      listId: 13,
      createdAt: new Date("2026-07-15T12:00:00.000Z"),
      dueDate: null,
    },
    {
      id: 104,
      publicId: "card10400000",
      title: "Entrega importada",
      cardNumber: 5,
      listId: 13,
      createdAt: new Date("2026-01-10T12:00:00.000Z"),
      dueDate: null,
    },
    {
      id: 105,
      publicId: "card10500000",
      title: "Plan reciente",
      cardNumber: 6,
      listId: 10,
      createdAt: new Date("2026-07-21T10:00:00.000Z"),
      dueDate: null,
    },
  ],
  activities: [
    {
      cardId: 101,
      fromListId: 10,
      toListId: 11,
      createdAt: new Date("2026-07-15T12:00:00.000Z"),
    },
    {
      cardId: 102,
      fromListId: 11,
      toListId: 12,
      createdAt: new Date("2026-07-18T10:00:00.000Z"),
    },
    {
      cardId: 103,
      fromListId: 10,
      toListId: 11,
      createdAt: new Date("2026-07-18T12:00:00.000Z"),
    },
    {
      cardId: 103,
      fromListId: 11,
      toListId: 13,
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
    },
  ],
  members: [
    { id: 1, publicId: "member123456", name: "Ana", email: "ana@example.com" },
    {
      id: 2,
      publicId: "member654321",
      name: "Beto",
      email: "beto@example.com",
    },
  ],
  assignments: [
    { cardId: 101, memberId: 1 },
    { cardId: 102, memberId: 1 },
    { cardId: 102, memberId: 2 },
    { cardId: 105, memberId: 2 },
  ],
  checklistItems: [
    { cardId: 101, completed: true },
    { cardId: 101, completed: false },
    { cardId: 102, completed: true },
    { cardId: 103, completed: true },
  ],
} as PulseSource;

describe("classifyListName", () => {
  it.each([
    ["Por hacer", "planned"],
    ["Esta semana", "planned"],
    ["En curso", "inProgress"],
    ["Bloqueado", "blocked"],
    ["Listo ✅", "done"],
    ["Validación", "other"],
  ] as const)("maps %s to %s", (name, status) => {
    expect(classifyListName(name)).toBe(status);
  });
});

describe("buildPulseSummary", () => {
  it("builds an actionable weekly snapshot without ranking output", () => {
    const result = buildPulseSummary(source, "week", now);

    expect(result.period.startsAt).toBe("2026-07-20T00:00:00.000Z");
    expect(result.kpis).toEqual({
      delivered: 1,
      stalled: 3,
      cycleTimeHours: 48,
    });
    expect(result.totals).toEqual({
      cards: 6,
      open: 4,
      blocked: 1,
      overdue: 1,
      unassigned: 1,
    });
    expect(result.statuses).toEqual([
      { key: "planned", count: 2 },
      { key: "inProgress", count: 1 },
      { key: "blocked", count: 1 },
      { key: "done", count: 2 },
      { key: "other", count: 0 },
    ]);
    expect(result.checklist).toEqual({ completed: 2, total: 3, percent: 67 });
    expect(result.workload).toEqual([
      {
        memberPublicId: "member123456",
        name: "Ana",
        active: 2,
        blocked: 1,
        stalled: 2,
      },
      {
        memberPublicId: "member654321",
        name: "Beto",
        active: 1,
        blocked: 1,
        stalled: 1,
      },
    ]);
    expect(result.attention[0]?.title).toBe("Dependencia externa");
    expect(
      result.attention.find((item) => item.cardPublicId === "card10100000")
        ?.reasons,
    ).toEqual(["overdue", "stalled"]);
    expect(result.coverage).toEqual({
      cards: 6,
      cardsWithTransitions: 3,
      cycleSamples: 1,
      historyStartAt: "2026-07-15T12:00:00.000Z",
    });
    expect(result.trend).toHaveLength(12);
    expect(result.trend.at(-1)?.delivered).toBe(1);
  });

  it("switches the period and trend grain to months", () => {
    const result = buildPulseSummary(source, "month", now);

    expect(result.period.startsAt).toBe("2026-07-01T00:00:00.000Z");
    expect(result.trend).toHaveLength(12);
    expect(result.trend[0]?.startsAt).toBe("2025-08-01T00:00:00.000Z");
    expect(result.trend.at(-1)?.delivered).toBe(1);
  });

  it("reports missing cycle evidence instead of inventing a duration", () => {
    const result = buildPulseSummary(
      { ...source, activities: [] } as PulseSource,
      "week",
      now,
    );

    expect(result.kpis.cycleTimeHours).toBeNull();
    expect(result.coverage.cycleSamples).toBe(0);
  });
});
