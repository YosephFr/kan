import type { getSourceByWorkspaceId } from "@kan/db/repository/pulse.repo";

export type PulsePeriod = "week" | "month";
export type PulseStatus =
  | "planned"
  | "inProgress"
  | "blocked"
  | "done"
  | "other";
export type PulseAttentionReason =
  | "blocked"
  | "overdue"
  | "stalled"
  | "unassigned";

export type PulseSource = NonNullable<
  Awaited<ReturnType<typeof getSourceByWorkspaceId>>
>;

const DAY_MS = 86_400_000;
const STALE_AFTER_DAYS: Record<Exclude<PulseStatus, "done">, number> = {
  planned: 14,
  inProgress: 3,
  blocked: 2,
  other: 14,
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const classifyListName = (name: string): PulseStatus => {
  const value = normalize(name);

  if (
    /^(listo|lista|hecho|hecha|done|complete|completed|cerrado|cerrada|finalizado|finalizada)$/.test(
      value,
    )
  )
    return "done";
  if (/^(bloqueado|bloqueada|blocked)$/.test(value)) return "blocked";
  if (/^(en curso|in progress|doing|trabajando)$/.test(value))
    return "inProgress";
  if (
    /^(por hacer|por priorizar|esta semana|pendiente|pendientes|backlog|to do|todo|planned)$/.test(
      value,
    )
  )
    return "planned";

  return "other";
};

const startOfUtcDay = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

const startOfUtcWeek = (date: Date, weekStartDay: number) => {
  const start = startOfUtcDay(date);
  const difference = (start.getUTCDay() - weekStartDay + 7) % 7;
  start.setUTCDate(start.getUTCDate() - difference);
  return start;
};

const startOfUtcMonth = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const addUtcDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);

const addUtcMonths = (date: Date, months: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
};

export const buildPulseSummary = (
  source: PulseSource,
  period: PulsePeriod,
  now = new Date(),
) => {
  const listsById = new Map(source.lists.map((list) => [list.id, list]));
  const boardsById = new Map(source.boards.map((board) => [board.id, board]));
  const membersById = new Map(
    source.members.map((member) => [member.id, member]),
  );
  const cardsById = new Map(source.cards.map((card) => [card.id, card]));
  const statusByListId = new Map(
    source.lists.map((list) => [list.id, classifyListName(list.name)]),
  );
  const activitiesByCard = new Map<number, PulseSource["activities"]>();
  const assignmentsByCard = new Map<number, number[]>();

  for (const activity of source.activities) {
    const activities = activitiesByCard.get(activity.cardId) ?? [];
    activities.push(activity);
    activitiesByCard.set(activity.cardId, activities);
  }
  for (const assignment of source.assignments) {
    const memberIds = assignmentsByCard.get(assignment.cardId) ?? [];
    memberIds.push(assignment.memberId);
    assignmentsByCard.set(assignment.cardId, memberIds);
  }

  const periodStart =
    period === "week"
      ? startOfUtcWeek(now, source.workspace.weekStartDay)
      : startOfUtcMonth(now);
  const currentPeriodStart =
    period === "week"
      ? startOfUtcWeek(now, source.workspace.weekStartDay)
      : startOfUtcMonth(now);
  const trendStarts = Array.from({ length: 12 }, (_, index) =>
    period === "week"
      ? addUtcDays(currentPeriodStart, (index - 11) * 7)
      : addUtcMonths(currentPeriodStart, index - 11),
  );
  const completionByCard = new Map<number, Date>();
  const cycleHours: number[] = [];
  let historyStartAt: Date | null = null;

  for (const card of source.cards) {
    if (statusByListId.get(card.listId) !== "done") continue;
    const activities = activitiesByCard.get(card.id) ?? [];
    const completionActivity = [...activities]
      .reverse()
      .find(
        (activity) =>
          activity.toListId !== null &&
          statusByListId.get(activity.toListId) === "done",
      );
    completionByCard.set(
      card.id,
      completionActivity?.createdAt ?? card.createdAt,
    );
  }

  for (const activity of source.activities) {
    if (!historyStartAt || activity.createdAt < historyStartAt)
      historyStartAt = activity.createdAt;
  }

  const deliveredCards = source.cards.filter((card) => {
    const completedAt = completionByCard.get(card.id);
    return (
      completedAt !== undefined &&
      completedAt >= periodStart &&
      completedAt <= now
    );
  });

  for (const card of deliveredCards) {
    const completedAt = completionByCard.get(card.id);
    if (!completedAt) continue;
    const startedAt = [...(activitiesByCard.get(card.id) ?? [])]
      .reverse()
      .find(
        (activity) =>
          activity.createdAt < completedAt &&
          activity.toListId !== null &&
          statusByListId.get(activity.toListId) === "inProgress",
      )?.createdAt;
    if (startedAt)
      cycleHours.push(
        (completedAt.getTime() - startedAt.getTime()) / 3_600_000,
      );
  }

  const statusCounts: Record<PulseStatus, number> = {
    planned: 0,
    inProgress: 0,
    blocked: 0,
    done: 0,
    other: 0,
  };
  const attention = [] as {
    cardPublicId: string;
    cardNumber: number | null;
    title: string;
    boardPublicId: string;
    boardName: string;
    listPublicId: string;
    listName: string;
    status: PulseStatus;
    reasons: PulseAttentionReason[];
    inactiveDays: number;
    dueDate: string | null;
    assignees: string[];
    priority: number;
  }[];
  const stalledCardIds = new Set<number>();
  const openCardIds = new Set<number>();
  const overdueCardIds = new Set<number>();
  const unassignedCardIds = new Set<number>();

  for (const card of source.cards) {
    const status = statusByListId.get(card.listId) ?? "other";
    statusCounts[status] += 1;
    if (status === "done") continue;
    openCardIds.add(card.id);

    const activities = activitiesByCard.get(card.id) ?? [];
    const lastMovedAt = activities.at(-1)?.createdAt ?? card.createdAt;
    const inactiveDays = Math.max(
      0,
      Math.floor((now.getTime() - lastMovedAt.getTime()) / DAY_MS),
    );
    const isStalled = inactiveDays >= STALE_AFTER_DAYS[status];
    const isOverdue = card.dueDate !== null && card.dueDate < now;
    const memberIds = assignmentsByCard.get(card.id) ?? [];
    const isUnassigned = memberIds.length === 0;
    const reasons: PulseAttentionReason[] = [];

    if (status === "blocked") reasons.push("blocked");
    if (isOverdue) reasons.push("overdue");
    if (isStalled) reasons.push("stalled");
    if (isUnassigned) reasons.push("unassigned");
    if (isStalled) stalledCardIds.add(card.id);
    if (isOverdue) overdueCardIds.add(card.id);
    if (isUnassigned) unassignedCardIds.add(card.id);

    if (reasons.length === 0) continue;
    const list = listsById.get(card.listId);
    const board = list ? boardsById.get(list.boardId) : undefined;
    if (!list || !board) continue;
    attention.push({
      cardPublicId: card.publicId,
      cardNumber: card.cardNumber,
      title: card.title,
      boardPublicId: board.publicId,
      boardName: board.name,
      listPublicId: list.publicId,
      listName: list.name,
      status,
      reasons,
      inactiveDays,
      dueDate: card.dueDate?.toISOString() ?? null,
      assignees: memberIds
        .map((id) => {
          const member = membersById.get(id);
          return member?.name ?? member?.email ?? "";
        })
        .filter(Boolean),
      priority:
        (status === "blocked" ? 400 : 0) +
        (isOverdue ? 300 : 0) +
        (isStalled ? 200 + inactiveDays : 0) +
        (isUnassigned ? 100 : 0),
    });
  }

  const workload: {
    memberPublicId: string | null;
    name: string;
    active: number;
    blocked: number;
    stalled: number;
  }[] = source.members.map((member) => {
    const cardIds = source.assignments
      .filter((assignment) => assignment.memberId === member.id)
      .map((assignment) => assignment.cardId);
    return {
      memberPublicId: member.publicId,
      name: member.name ?? member.email,
      active: cardIds.filter((id) => {
        const card = cardsById.get(id);
        const status = card ? statusByListId.get(card.listId) : undefined;
        return status === "inProgress" || status === "blocked";
      }).length,
      blocked: cardIds.filter((id) => {
        const card = cardsById.get(id);
        return card ? statusByListId.get(card.listId) === "blocked" : false;
      }).length,
      stalled: cardIds.filter((id) => stalledCardIds.has(id)).length,
    };
  });
  const unassignedActive = source.cards.filter((card) => {
    const status = statusByListId.get(card.listId);
    return (
      (status === "inProgress" || status === "blocked") &&
      !assignmentsByCard.has(card.id)
    );
  });
  if (unassignedActive.length > 0) {
    workload.push({
      memberPublicId: null,
      name: "",
      active: unassignedActive.length,
      blocked: unassignedActive.filter(
        (card) => statusByListId.get(card.listId) === "blocked",
      ).length,
      stalled: unassignedActive.filter((card) => stalledCardIds.has(card.id))
        .length,
    });
  }

  const openChecklistItems = source.checklistItems.filter((item) =>
    openCardIds.has(item.cardId),
  );
  const completedChecklistItems = openChecklistItems.filter(
    (item) => item.completed,
  ).length;
  const cycleMedian = median(cycleHours);

  return {
    refreshedAt: now.toISOString(),
    period: {
      key: period,
      startsAt: periodStart.toISOString(),
      endsAt: now.toISOString(),
    },
    kpis: {
      delivered: deliveredCards.length,
      stalled: stalledCardIds.size,
      cycleTimeHours:
        cycleMedian === null ? null : Math.round(cycleMedian * 10) / 10,
    },
    totals: {
      cards: source.cards.length,
      open: openCardIds.size,
      blocked: statusCounts.blocked,
      overdue: overdueCardIds.size,
      unassigned: unassignedCardIds.size,
    },
    statuses: (Object.keys(statusCounts) as PulseStatus[]).map((key) => ({
      key,
      count: statusCounts[key],
    })),
    trend: trendStarts.map((startsAt, index) => {
      const endsAt =
        period === "week" ? addUtcDays(startsAt, 7) : addUtcMonths(startsAt, 1);
      return {
        startsAt: startsAt.toISOString(),
        delivered: [...completionByCard.values()].filter(
          (completedAt) => completedAt >= startsAt && completedAt < endsAt,
        ).length,
        current: index === trendStarts.length - 1,
      };
    }),
    workload: workload.sort(
      (a, b) => b.active - a.active || a.name.localeCompare(b.name),
    ),
    checklist: {
      completed: completedChecklistItems,
      total: openChecklistItems.length,
      percent:
        openChecklistItems.length === 0
          ? null
          : Math.round(
              (completedChecklistItems / openChecklistItems.length) * 100,
            ),
    },
    attention: attention
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          b.inactiveDays - a.inactiveDays ||
          a.title.localeCompare(b.title),
      )
      .slice(0, 20)
      .map(({ priority: _priority, ...item }) => item),
    coverage: {
      cards: source.cards.length,
      cardsWithTransitions: activitiesByCard.size,
      cycleSamples: cycleHours.length,
      historyStartAt: historyStartAt?.toISOString() ?? null,
    },
    configuration: {
      plannedStaleDays: STALE_AFTER_DAYS.planned,
      inProgressStaleDays: STALE_AFTER_DAYS.inProgress,
      blockedStaleDays: STALE_AFTER_DAYS.blocked,
    },
    workspace: {
      publicId: source.workspace.publicId,
      name: source.workspace.name,
      cardPrefix: source.workspace.cardPrefix,
    },
  };
};
