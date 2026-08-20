import { describe, expect, it } from "vitest";

import type { PortfolioSource } from "./portfolio-metrics";
import {
  buildPortfolioDetail,
  buildPortfolioSummary,
} from "./portfolio-metrics";

const now = new Date("2026-07-31T12:00:00.000Z");

const source = {
  workspaces: [
    {
      id: 1,
      publicId: "workspace1234",
      name: "Imanleads",
      logo: null,
      weekStartDay: 1,
      cardPrefix: "IMA",
    },
    {
      id: 2,
      publicId: "workspace5678",
      name: "Simplifies",
      logo: null,
      weekStartDay: 1,
      cardPrefix: "SIM",
    },
  ],
  boards: [
    { id: 10, publicId: "board123456", name: "IA", workspaceId: 1 },
    { id: 20, publicId: "board654321", name: "Operación", workspaceId: 2 },
  ],
  lists: [
    {
      id: 100,
      publicId: "planned12345",
      name: "Por hacer",
      boardId: 10,
      status: "planned",
    },
    {
      id: 101,
      publicId: "progress1234",
      name: "En curso",
      boardId: 10,
      status: "inProgress",
    },
    {
      id: 102,
      publicId: "done12345678",
      name: "Listo",
      boardId: 10,
      status: "done",
    },
    {
      id: 200,
      publicId: "planned54321",
      name: "Pendiente",
      boardId: 20,
      status: "planned",
    },
    {
      id: 201,
      publicId: "progress5432",
      name: "En curso",
      boardId: 20,
      status: "inProgress",
    },
    {
      id: 202,
      publicId: "done87654321",
      name: "Hecho",
      boardId: 20,
      status: "done",
    },
  ],
  cards: [
    {
      id: 1000,
      publicId: "card10000000",
      title: "Preparar campaña",
      cardNumber: 1,
      listId: 101,
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      dueDate: null,
      priority: "urgent",
      startedAt: new Date("2026-07-30T12:00:00.000Z"),
      completedAt: null,
    },
    {
      id: 1001,
      publicId: "card10100000",
      title: "Publicar campaña",
      cardNumber: 2,
      listId: 102,
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      dueDate: null,
      priority: "none",
      startedAt: new Date("2026-07-20T12:00:00.000Z"),
      completedAt: new Date("2026-07-29T12:00:00.000Z"),
    },
    {
      id: 1002,
      publicId: "card10200000",
      title: "Definir propuesta",
      cardNumber: 3,
      listId: 100,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      dueDate: null,
      priority: "none",
      startedAt: null,
      completedAt: null,
    },
    {
      id: 2000,
      publicId: "card20000000",
      title: "Cerrar conciliación",
      cardNumber: 1,
      listId: 202,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      dueDate: null,
      priority: "none",
      startedAt: new Date("2026-07-01T12:00:00.000Z"),
      completedAt: new Date("2026-07-10T12:00:00.000Z"),
    },
    {
      id: 2001,
      publicId: "card20100000",
      title: "Revisar adelantos",
      cardNumber: 2,
      listId: 201,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      dueDate: new Date("2026-07-30T12:00:00.000Z"),
      priority: "high",
      startedAt: new Date("2026-07-01T12:00:00.000Z"),
      completedAt: null,
    },
  ],
  activities: [
    {
      cardId: 1000,
      fromListId: 100,
      toListId: 101,
      createdBy: "user-christan",
      createdAt: new Date("2026-07-30T12:00:00.000Z"),
    },
    {
      cardId: 1001,
      fromListId: 101,
      toListId: 102,
      createdBy: "user-franco",
      createdAt: new Date("2026-07-29T12:00:00.000Z"),
    },
    {
      cardId: 2000,
      fromListId: 201,
      toListId: 202,
      createdBy: "user-christan",
      createdAt: new Date("2026-07-10T12:00:00.000Z"),
    },
    {
      cardId: 2001,
      fromListId: 200,
      toListId: 201,
      createdBy: "user-franco",
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
    },
  ],
  members: [
    {
      id: 5000,
      publicId: "memberchr123",
      userId: "user-christan",
      workspaceId: 1,
      name: "Christan",
      email: "christan@example.com",
      image: null,
    },
    {
      id: 5001,
      publicId: "memberfra123",
      userId: "user-franco",
      workspaceId: 1,
      name: "Franco",
      email: "franco@example.com",
      image: null,
    },
    {
      id: 6000,
      publicId: "memberchr456",
      userId: "user-christan",
      workspaceId: 2,
      name: "Christan",
      email: "christan@example.com",
      image: null,
    },
    {
      id: 6001,
      publicId: "memberfra456",
      userId: "user-franco",
      workspaceId: 2,
      name: "Franco",
      email: "franco@example.com",
      image: null,
    },
  ],
  assignments: [
    { cardId: 1000, memberId: 5001 },
    { cardId: 1001, memberId: 5001 },
    { cardId: 1002, memberId: 5000 },
    { cardId: 2000, memberId: 6000 },
    { cardId: 2001, memberId: 6001 },
  ],
} as PortfolioSource;

describe("buildPortfolioSummary", () => {
  it("compares accessible companies and attributes weekly movement to its actor", () => {
    const result = buildPortfolioSummary(source, "week", now);

    expect(result.period.startsAt).toBe("2026-07-27T00:00:00.000Z");
    expect(result.totals).toEqual({
      companies: 2,
      advanced: 2,
      delivered: 1,
      stalled: 2,
      open: 3,
    });
    expect(result.companies).toEqual([
      expect.objectContaining({
        publicId: "workspace1234",
        name: "Imanleads",
        advanced: 2,
        delivered: 1,
        stalled: 1,
        open: 2,
      }),
      expect.objectContaining({
        publicId: "workspace5678",
        name: "Simplifies",
        advanced: 0,
        delivered: 0,
        stalled: 1,
        open: 1,
      }),
    ]);
    expect(result.team).toEqual([
      expect.objectContaining({
        name: "Christan",
        companies: [
          expect.objectContaining({
            workspacePublicId: "workspace1234",
            memberPublicId: "memberchr123",
            advanced: 1,
            delivered: 0,
          }),
          expect.objectContaining({
            workspacePublicId: "workspace5678",
            memberPublicId: "memberchr456",
            advanced: 0,
            delivered: 0,
          }),
        ],
      }),
      expect.objectContaining({
        name: "Franco",
        companies: [
          expect.objectContaining({
            workspacePublicId: "workspace1234",
            memberPublicId: "memberfra123",
            advanced: 1,
            delivered: 1,
          }),
          expect.objectContaining({
            workspacePublicId: "workspace5678",
            memberPublicId: "memberfra456",
            advanced: 0,
            delivered: 0,
          }),
        ],
      }),
    ]);
    expect(result.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardPublicId: "card10000000",
          workspacePublicId: "workspace1234",
          reasons: ["urgent"],
          cardPriority: "urgent",
        }),
        expect.objectContaining({
          cardPublicId: "card20100000",
          workspacePublicId: "workspace5678",
          reasons: ["overdue", "stalled"],
          cardPriority: "high",
        }),
        expect.objectContaining({
          cardPublicId: "card10200000",
          workspacePublicId: "workspace1234",
          reasons: ["stalled"],
          cardPriority: "none",
        }),
      ]),
    );
    expect(result.coverage).toEqual({
      cards: 5,
      cardsWithTransitions: 4,
      periodTransitions: 2,
      attributedPeriodTransitions: 2,
    });
  });

  it("uses the full current month without treating old movement as weekly progress", () => {
    const result = buildPortfolioSummary(source, "month", now);

    expect(result.period.startsAt).toBe("2026-07-01T00:00:00.000Z");
    expect(result.totals.advanced).toBe(4);
    expect(result.totals.delivered).toBe(2);
    expect(
      result.team.find((member) => member.name === "Christan")?.totalAdvanced,
    ).toBe(2);
  });

  it("does not mark a newly started old card as stalled", () => {
    const result = buildPortfolioSummary(
      {
        ...source,
        activities: source.activities.map((activity) =>
          activity.cardId === 1000
            ? {
                ...activity,
                createdAt: new Date("2026-07-20T12:00:00.000Z"),
              }
            : activity,
        ),
      } as PortfolioSource,
      "week",
      now,
    );

    expect(result.totals.stalled).toBe(2);
    expect(
      result.attention.find((item) => item.cardPublicId === "card10000000")
        ?.reasons,
    ).toEqual(["urgent"]);
  });
});

describe("buildPortfolioDetail", () => {
  it("drills into one employee's advanced cards in one company", () => {
    const result = buildPortfolioDetail(
      source,
      {
        metric: "advanced",
        period: "week",
        workspacePublicId: "workspace1234",
        memberPublicId: "memberchr123",
      },
      now,
    );

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        cardPublicId: "card10000000",
        workspaceName: "Imanleads",
        fromListName: "Por hacer",
        toListName: "En curso",
        changedBy: "Christan",
      }),
    ]);
  });

  it("returns the exact stalled cards behind a company statistic", () => {
    const result = buildPortfolioDetail(
      source,
      {
        metric: "stalled",
        period: "week",
        workspacePublicId: "workspace1234",
      },
      now,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        cardPublicId: "card10200000",
        inactiveDays: 30,
        status: "planned",
      }),
    );
  });
});
