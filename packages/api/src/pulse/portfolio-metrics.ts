import type { getPortfolioSourceByUserId } from "@kan/db/repository/pulse.repo";

import type { PulseAttentionReason, PulsePeriod } from "./metrics";
import { classifyListName, latestDate, STALE_AFTER_DAYS } from "./metrics";

export type PortfolioMetric = "advanced" | "delivered" | "stalled" | "open";
export type PortfolioSource = Awaited<
  ReturnType<typeof getPortfolioSourceByUserId>
>;

interface PortfolioDetailInput {
  metric: PortfolioMetric;
  period: PulsePeriod;
  workspacePublicId?: string;
  memberPublicId?: string;
}

const DAY_MS = 86_400_000;

const startOfPeriod = (date: Date, period: PulsePeriod) => {
  if (period === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const difference = (start.getUTCDay() - 1 + 7) % 7;
  start.setUTCDate(start.getUTCDate() - difference);
  return start;
};

const preparePortfolio = (
  source: PortfolioSource,
  period: PulsePeriod,
  now: Date,
) => {
  const periodStart = startOfPeriod(now, period);
  const workspaceById = new Map(
    source.workspaces.map((workspace) => [workspace.id, workspace]),
  );
  const boardById = new Map(source.boards.map((board) => [board.id, board]));
  const listById = new Map(source.lists.map((list) => [list.id, list]));
  const cardById = new Map(source.cards.map((card) => [card.id, card]));
  const memberById = new Map(
    source.members.map((member) => [member.id, member]),
  );
  const statusByListId = new Map(
    source.lists.map((list) => [
      list.id,
      list.status ?? classifyListName(list.name),
    ]),
  );
  const workspaceIdByCardId = new Map<number, number>();
  const activitiesByCardId = new Map<number, PortfolioSource["activities"]>();
  const assignmentsByCardId = new Map<number, number[]>();
  const subtaskBlockedCardIds = new Set<number>();
  const subtaskOverdueCardIds = new Set<number>();
  const actorByWorkspaceAndUserId = new Map<
    string,
    PortfolioSource["members"][number]
  >();

  for (const card of source.cards) {
    const list = listById.get(card.listId);
    const board = list ? boardById.get(list.boardId) : undefined;
    if (board) workspaceIdByCardId.set(card.id, board.workspaceId);
  }

  for (const activity of source.activities) {
    const activities = activitiesByCardId.get(activity.cardId) ?? [];
    activities.push(activity);
    activitiesByCardId.set(activity.cardId, activities);
  }

  for (const assignment of source.assignments) {
    const memberIds = assignmentsByCardId.get(assignment.cardId) ?? [];
    memberIds.push(assignment.memberId);
    assignmentsByCardId.set(assignment.cardId, memberIds);
  }
  for (const signal of source.subtaskSignals) {
    if (signal.blocked) subtaskBlockedCardIds.add(signal.cardId);
    if (signal.dueDate && signal.dueDate <= now) {
      subtaskOverdueCardIds.add(signal.cardId);
    }
  }

  for (const member of source.members) {
    if (member.userId)
      actorByWorkspaceAndUserId.set(
        `${member.workspaceId}:${member.userId}`,
        member,
      );
  }

  const periodActivities = source.activities.filter(
    (activity) =>
      activity.createdAt >= periodStart && activity.createdAt <= now,
  );
  const advancedCardIds = new Set(
    periodActivities.map((activity) => activity.cardId),
  );
  const deliveredActivities = periodActivities.filter(
    (activity) =>
      activity.toListId !== null &&
      statusByListId.get(activity.toListId) === "done" &&
      (activity.fromListId === null ||
        statusByListId.get(activity.fromListId) !== "done"),
  );
  const deliveredCardIds = new Set([
    ...deliveredActivities.map((activity) => activity.cardId),
    ...source.cards
      .filter(
        (card) =>
          card.completedAt !== null &&
          card.completedAt >= periodStart &&
          card.completedAt <= now,
      )
      .map((card) => card.id),
  ]);
  const openCardIds = new Set<number>();
  const stalledCardIds = new Set<number>();
  const inactiveDaysByCardId = new Map<number, number>();

  for (const card of source.cards) {
    const status = statusByListId.get(card.listId) ?? "other";
    if (status === "done") continue;
    openCardIds.add(card.id);
    const lastMovedAt = latestDate(
      card.createdAt,
      card.startedAt,
      activitiesByCardId.get(card.id)?.at(-1)?.createdAt,
    );
    const inactiveDays = Math.max(
      0,
      Math.floor((now.getTime() - lastMovedAt.getTime()) / DAY_MS),
    );
    inactiveDaysByCardId.set(card.id, inactiveDays);
    if (inactiveDays >= STALE_AFTER_DAYS[status]) stalledCardIds.add(card.id);
  }

  const actorForActivity = (
    activity: PortfolioSource["activities"][number],
  ) => {
    const workspaceId = workspaceIdByCardId.get(activity.cardId);
    if (!workspaceId || !activity.createdBy) return undefined;
    return actorByWorkspaceAndUserId.get(
      `${workspaceId}:${activity.createdBy}`,
    );
  };

  return {
    periodStart,
    workspaceById,
    boardById,
    listById,
    cardById,
    memberById,
    statusByListId,
    workspaceIdByCardId,
    activitiesByCardId,
    assignmentsByCardId,
    subtaskBlockedCardIds,
    subtaskOverdueCardIds,
    periodActivities,
    advancedCardIds,
    deliveredActivities,
    deliveredCardIds,
    openCardIds,
    stalledCardIds,
    inactiveDaysByCardId,
    actorForActivity,
  };
};

export const buildPortfolioSummary = (
  source: PortfolioSource,
  period: PulsePeriod,
  now = new Date(),
) => {
  const prepared = preparePortfolio(source, period, now);
  const advancedByMemberId = new Map<number, Set<number>>();
  const deliveredByMemberId = new Map<number, Set<number>>();

  for (const activity of prepared.periodActivities) {
    const actor = prepared.actorForActivity(activity);
    if (!actor) continue;
    const cardIds = advancedByMemberId.get(actor.id) ?? new Set<number>();
    cardIds.add(activity.cardId);
    advancedByMemberId.set(actor.id, cardIds);
  }

  for (const activity of prepared.deliveredActivities) {
    const actor = prepared.actorForActivity(activity);
    if (!actor) continue;
    const cardIds = deliveredByMemberId.get(actor.id) ?? new Set<number>();
    cardIds.add(activity.cardId);
    deliveredByMemberId.set(actor.id, cardIds);
  }

  const companies = source.workspaces.map((workspace) => {
    const boardIds = new Set(
      source.boards
        .filter((board) => board.workspaceId === workspace.id)
        .map((board) => board.id),
    );
    const listIds = new Set(
      source.lists
        .filter((list) => boardIds.has(list.boardId))
        .map((list) => list.id),
    );
    const cardIds = source.cards
      .filter((card) => listIds.has(card.listId))
      .map((card) => card.id);

    return {
      publicId: workspace.publicId,
      name: workspace.name,
      logo: workspace.logo,
      cardPrefix: workspace.cardPrefix,
      boards: boardIds.size,
      cards: cardIds.length,
      advanced: cardIds.filter((cardId) => prepared.advancedCardIds.has(cardId))
        .length,
      delivered: cardIds.filter((cardId) =>
        prepared.deliveredCardIds.has(cardId),
      ).length,
      stalled: cardIds.filter((cardId) => prepared.stalledCardIds.has(cardId))
        .length,
      open: cardIds.filter((cardId) => prepared.openCardIds.has(cardId)).length,
    };
  });

  const membersByUserId = new Map<
    string,
    {
      name: string;
      image: string | null;
      members: PortfolioSource["members"];
    }
  >();

  for (const member of source.members) {
    if (!member.userId) continue;
    const person = membersByUserId.get(member.userId) ?? {
      name: member.name ?? member.email,
      image: member.image,
      members: [],
    };
    person.members.push(member);
    if (!person.image && member.image) person.image = member.image;
    membersByUserId.set(member.userId, person);
  }

  const team = [...membersByUserId.values()]
    .map((person) => {
      const memberByWorkspaceId = new Map(
        person.members.map((member) => [member.workspaceId, member]),
      );
      const companyMetrics = source.workspaces.flatMap((workspace) => {
        const member = memberByWorkspaceId.get(workspace.id);
        if (!member) return [];
        return [
          {
            workspacePublicId: workspace.publicId,
            workspaceName: workspace.name,
            memberPublicId: member.publicId,
            advanced: advancedByMemberId.get(member.id)?.size ?? 0,
            delivered: deliveredByMemberId.get(member.id)?.size ?? 0,
          },
        ];
      });

      return {
        publicId: person.members[0]?.publicId ?? person.name,
        name: person.name,
        image: person.image,
        totalAdvanced: companyMetrics.reduce(
          (total, company) => total + company.advanced,
          0,
        ),
        totalDelivered: companyMetrics.reduce(
          (total, company) => total + company.delivered,
          0,
        ),
        companies: companyMetrics,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const attention = source.cards
    .flatMap((card) => {
      const status = prepared.statusByListId.get(card.listId) ?? "other";
      if (status === "done") return [];

      const list = prepared.listById.get(card.listId);
      const board = list ? prepared.boardById.get(list.boardId) : undefined;
      const workspace = board
        ? prepared.workspaceById.get(board.workspaceId)
        : undefined;
      if (!list || !board || !workspace) return [];

      const lastMovedAt = latestDate(
        card.createdAt,
        card.startedAt,
        prepared.activitiesByCardId.get(card.id)?.at(-1)?.createdAt,
      );
      const inactiveDays = Math.max(
        0,
        Math.floor((now.getTime() - lastMovedAt.getTime()) / DAY_MS),
      );
      const isStalled = inactiveDays >= STALE_AFTER_DAYS[status];
      const isOverdue = card.dueDate !== null && card.dueDate <= now;
      const memberIds = prepared.assignmentsByCardId.get(card.id) ?? [];
      const reasons: PulseAttentionReason[] = [];

      if (card.priority === "urgent") reasons.push("urgent");
      if (status === "blocked") reasons.push("blocked");
      if (isOverdue) reasons.push("overdue");
      if (prepared.subtaskBlockedCardIds.has(card.id)) {
        reasons.push("subtaskBlocked");
      }
      if (prepared.subtaskOverdueCardIds.has(card.id)) {
        reasons.push("subtaskOverdue");
      }
      if (isStalled) reasons.push("stalled");
      if (memberIds.length === 0) reasons.push("unassigned");
      if (reasons.length === 0) return [];

      return [
        {
          cardPublicId: card.publicId,
          cardNumber: card.cardNumber,
          title: card.title,
          workspacePublicId: workspace.publicId,
          workspaceName: workspace.name,
          workspaceLogo: workspace.logo,
          cardPrefix: workspace.cardPrefix,
          boardName: board.name,
          listName: list.name,
          reasons,
          inactiveDays,
          dueDate: card.dueDate?.toISOString() ?? null,
          assignees: memberIds
            .map((memberId) => {
              const member = prepared.memberById.get(memberId);
              return member?.name ?? member?.email ?? "";
            })
            .filter(Boolean),
          cardPriority: card.priority,
          score:
            (card.priority === "urgent" ? 500 : 0) +
            (status === "blocked" ? 400 : 0) +
            (isOverdue ? 300 : 0) +
            (prepared.subtaskBlockedCardIds.has(card.id) ? 350 : 0) +
            (prepared.subtaskOverdueCardIds.has(card.id) ? 250 : 0) +
            (isStalled ? 200 + inactiveDays : 0) +
            (memberIds.length === 0 ? 100 : 0),
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.inactiveDays - a.inactiveDays ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 20)
    .map(({ score: _score, ...item }) => item);

  return {
    refreshedAt: now.toISOString(),
    period: {
      key: period,
      startsAt: prepared.periodStart.toISOString(),
      endsAt: now.toISOString(),
    },
    totals: {
      companies: source.workspaces.length,
      advanced: prepared.advancedCardIds.size,
      delivered: prepared.deliveredCardIds.size,
      stalled: prepared.stalledCardIds.size,
      open: prepared.openCardIds.size,
    },
    companies,
    team,
    attention,
    coverage: {
      cards: source.cards.length,
      cardsWithTransitions: prepared.activitiesByCardId.size,
      periodTransitions: prepared.periodActivities.length,
      attributedPeriodTransitions: prepared.periodActivities.filter(
        (activity) => prepared.actorForActivity(activity) !== undefined,
      ).length,
    },
    configuration: {
      plannedStaleDays: STALE_AFTER_DAYS.planned,
      inProgressStaleDays: STALE_AFTER_DAYS.inProgress,
      blockedStaleDays: STALE_AFTER_DAYS.blocked,
    },
  };
};

export const buildPortfolioDetail = (
  source: PortfolioSource,
  input: PortfolioDetailInput,
  now = new Date(),
) => {
  const prepared = preparePortfolio(source, input.period, now);
  const selectedWorkspace = input.workspacePublicId
    ? source.workspaces.find(
        (workspace) => workspace.publicId === input.workspacePublicId,
      )
    : undefined;
  const selectedMember = input.memberPublicId
    ? source.members.find((member) => member.publicId === input.memberPublicId)
    : undefined;

  const cards = source.cards.flatMap((card) => {
    const workspaceId = prepared.workspaceIdByCardId.get(card.id);
    const workspace = workspaceId
      ? prepared.workspaceById.get(workspaceId)
      : undefined;
    const list = prepared.listById.get(card.listId);
    const board = list ? prepared.boardById.get(list.boardId) : undefined;
    if (!workspace || !list || !board) return [];
    if (selectedWorkspace && workspace.id !== selectedWorkspace.id) return [];

    const cardActivities = prepared.activitiesByCardId.get(card.id) ?? [];
    const matchingPeriodActivities = cardActivities.filter((activity) => {
      if (activity.createdAt < prepared.periodStart || activity.createdAt > now)
        return false;
      if (
        selectedMember &&
        (selectedMember.workspaceId !== workspace.id ||
          activity.createdBy !== selectedMember.userId)
      )
        return false;
      if (input.metric !== "delivered") return true;
      return (
        activity.toListId !== null &&
        prepared.statusByListId.get(activity.toListId) === "done" &&
        (activity.fromListId === null ||
          prepared.statusByListId.get(activity.fromListId) !== "done")
      );
    });
    const memberIds = prepared.assignmentsByCardId.get(card.id) ?? [];
    const matchesSelectedAssignee =
      !selectedMember || memberIds.includes(selectedMember.id);
    const completedInPeriod =
      card.completedAt !== null &&
      card.completedAt >= prepared.periodStart &&
      card.completedAt <= now;

    const matches =
      input.metric === "advanced"
        ? matchingPeriodActivities.length > 0
        : input.metric === "delivered"
          ? matchingPeriodActivities.length > 0 ||
            (!selectedMember && completedInPeriod)
          : input.metric === "stalled"
            ? prepared.stalledCardIds.has(card.id) && matchesSelectedAssignee
            : prepared.openCardIds.has(card.id) && matchesSelectedAssignee;
    if (!matches) return [];

    const activity =
      matchingPeriodActivities.at(-1) ?? cardActivities.at(-1) ?? null;
    const actor = activity ? prepared.actorForActivity(activity) : undefined;

    return [
      {
        cardPublicId: card.publicId,
        cardNumber: card.cardNumber,
        title: card.title,
        workspacePublicId: workspace.publicId,
        workspaceName: workspace.name,
        workspaceLogo: workspace.logo,
        cardPrefix: workspace.cardPrefix,
        boardPublicId: board.publicId,
        boardName: board.name,
        listPublicId: list.publicId,
        listName: list.name,
        status: prepared.statusByListId.get(list.id) ?? "other",
        fromListName:
          activity?.fromListId === null || activity === null
            ? null
            : (prepared.listById.get(activity.fromListId)?.name ?? null),
        toListName:
          activity?.toListId === null || activity === null
            ? null
            : (prepared.listById.get(activity.toListId)?.name ?? null),
        changedBy: actor?.name ?? actor?.email ?? null,
        lastChangedAt:
          activity?.createdAt.toISOString() ??
          (completedInPeriod ? card.completedAt?.toISOString() : null) ??
          null,
        inactiveDays: prepared.inactiveDaysByCardId.get(card.id) ?? 0,
        assignees: memberIds
          .map((memberId) => {
            const member = prepared.memberById.get(memberId);
            return member?.name ?? member?.email ?? "";
          })
          .filter(Boolean),
      },
    ];
  });

  cards.sort((a, b) => {
    if (input.metric === "stalled")
      return b.inactiveDays - a.inactiveDays || a.title.localeCompare(b.title);
    return (
      (b.lastChangedAt ?? "").localeCompare(a.lastChangedAt ?? "") ||
      a.title.localeCompare(b.title)
    );
  });

  return {
    refreshedAt: now.toISOString(),
    period: {
      key: input.period,
      startsAt: prepared.periodStart.toISOString(),
      endsAt: now.toISOString(),
    },
    metric: input.metric,
    workspace: selectedWorkspace
      ? {
          publicId: selectedWorkspace.publicId,
          name: selectedWorkspace.name,
          logo: selectedWorkspace.logo,
        }
      : null,
    member: selectedMember
      ? {
          publicId: selectedMember.publicId,
          name: selectedMember.name ?? selectedMember.email,
        }
      : null,
    total: cards.length,
    truncated: cards.length > 200,
    items: cards.slice(0, 200),
  };
};
