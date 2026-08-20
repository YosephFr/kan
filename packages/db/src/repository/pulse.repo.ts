import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardActivities,
  cards,
  cardToWorkspaceMembers,
  checklistItems,
  checklists,
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

export const getSourceByWorkspaceId = async (
  db: dbClient,
  workspaceId: number,
) => {
  const [workspace] = await db
    .select({
      publicId: workspaces.publicId,
      name: workspaces.name,
      weekStartDay: workspaces.weekStartDay,
      cardPrefix: workspaces.cardPrefix,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);

  if (!workspace) return null;

  const boardRows = await db
    .select({
      id: boards.id,
      publicId: boards.publicId,
      name: boards.name,
    })
    .from(boards)
    .where(
      and(
        eq(boards.workspaceId, workspaceId),
        eq(boards.type, "regular"),
        eq(boards.isArchived, false),
        isNull(boards.deletedAt),
      ),
    )
    .orderBy(asc(boards.name));

  const memberRows = await db
    .select({
      id: workspaceMembers.id,
      publicId: workspaceMembers.publicId,
      name: users.name,
      email: workspaceMembers.email,
    })
    .from(workspaceMembers)
    .leftJoin(users, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .orderBy(asc(users.name), asc(workspaceMembers.email));

  if (boardRows.length === 0) {
    return {
      workspace,
      boards: boardRows,
      lists: [],
      cards: [],
      activities: [],
      members: memberRows,
      assignments: [],
      checklistItems: [],
    };
  }

  const listRows = await db
    .select({
      id: lists.id,
      publicId: lists.publicId,
      name: lists.name,
      boardId: lists.boardId,
      status: lists.status,
    })
    .from(lists)
    .where(
      and(
        inArray(
          lists.boardId,
          boardRows.map((board) => board.id),
        ),
        isNull(lists.deletedAt),
      ),
    )
    .orderBy(asc(lists.index));

  if (listRows.length === 0) {
    return {
      workspace,
      boards: boardRows,
      lists: listRows,
      cards: [],
      activities: [],
      members: memberRows,
      assignments: [],
      checklistItems: [],
    };
  }

  const cardRows = await db
    .select({
      id: cards.id,
      publicId: cards.publicId,
      title: cards.title,
      cardNumber: cards.cardNumber,
      listId: cards.listId,
      createdAt: cards.createdAt,
      dueDate: cards.dueDate,
      priority: cards.priority,
      startedAt: cards.startedAt,
      completedAt: cards.completedAt,
    })
    .from(cards)
    .where(
      and(
        inArray(
          cards.listId,
          listRows.map((list) => list.id),
        ),
        isNull(cards.deletedAt),
      ),
    );

  if (cardRows.length === 0) {
    return {
      workspace,
      boards: boardRows,
      lists: listRows,
      cards: cardRows,
      activities: [],
      members: memberRows,
      assignments: [],
      checklistItems: [],
    };
  }

  const cardIds = cardRows.map((card) => card.id);

  const [activityRows, assignmentRows, checklistItemRows] = await Promise.all([
    db
      .select({
        cardId: cardActivities.cardId,
        fromListId: cardActivities.fromListId,
        toListId: cardActivities.toListId,
        createdAt: cardActivities.createdAt,
      })
      .from(cardActivities)
      .where(
        and(
          inArray(cardActivities.cardId, cardIds),
          eq(cardActivities.type, "card.updated.list"),
        ),
      )
      .orderBy(asc(cardActivities.createdAt)),
    db
      .select({
        cardId: cardToWorkspaceMembers.cardId,
        memberId: cardToWorkspaceMembers.workspaceMemberId,
      })
      .from(cardToWorkspaceMembers)
      .innerJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .where(
        and(
          inArray(cardToWorkspaceMembers.cardId, cardIds),
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      ),
    db
      .select({
        cardId: checklists.cardId,
        completed: checklistItems.completed,
      })
      .from(checklists)
      .innerJoin(checklistItems, eq(checklistItems.checklistId, checklists.id))
      .where(
        and(
          inArray(checklists.cardId, cardIds),
          isNull(checklists.deletedAt),
          isNull(checklistItems.deletedAt),
        ),
      ),
  ]);

  return {
    workspace,
    boards: boardRows,
    lists: listRows,
    cards: cardRows,
    activities: activityRows,
    members: memberRows,
    assignments: assignmentRows,
    checklistItems: checklistItemRows,
  };
};

export const getPortfolioSourceByUserId = async (
  db: dbClient,
  userId: string,
) => {
  const workspaceRows = await db
    .select({
      id: workspaces.id,
      publicId: workspaces.publicId,
      name: workspaces.name,
      logo: workspaces.logo,
      weekStartDay: workspaces.weekStartDay,
      cardPrefix: workspaces.cardPrefix,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .orderBy(
      desc(workspaceMembers.sidebarPinned),
      asc(workspaceMembers.sidebarPosition),
      asc(workspaceMembers.createdAt),
    );

  if (workspaceRows.length === 0) {
    return {
      workspaces: workspaceRows,
      boards: [],
      lists: [],
      cards: [],
      activities: [],
      members: [],
      assignments: [],
    };
  }

  const workspaceIds = workspaceRows.map((workspace) => workspace.id);
  const [boardRows, memberRows] = await Promise.all([
    db
      .select({
        id: boards.id,
        publicId: boards.publicId,
        name: boards.name,
        workspaceId: boards.workspaceId,
      })
      .from(boards)
      .where(
        and(
          inArray(boards.workspaceId, workspaceIds),
          eq(boards.type, "regular"),
          eq(boards.isArchived, false),
          isNull(boards.deletedAt),
        ),
      )
      .orderBy(asc(boards.name)),
    db
      .select({
        id: workspaceMembers.id,
        publicId: workspaceMembers.publicId,
        userId: workspaceMembers.userId,
        workspaceId: workspaceMembers.workspaceId,
        name: users.name,
        email: workspaceMembers.email,
        image: users.image,
      })
      .from(workspaceMembers)
      .leftJoin(users, eq(workspaceMembers.userId, users.id))
      .where(
        and(
          inArray(workspaceMembers.workspaceId, workspaceIds),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .orderBy(asc(users.name), asc(workspaceMembers.email)),
  ]);

  if (boardRows.length === 0) {
    return {
      workspaces: workspaceRows,
      boards: boardRows,
      lists: [],
      cards: [],
      activities: [],
      members: memberRows,
      assignments: [],
    };
  }

  const listRows = await db
    .select({
      id: lists.id,
      publicId: lists.publicId,
      name: lists.name,
      boardId: lists.boardId,
      status: lists.status,
    })
    .from(lists)
    .where(
      and(
        inArray(
          lists.boardId,
          boardRows.map((board) => board.id),
        ),
        isNull(lists.deletedAt),
      ),
    )
    .orderBy(asc(lists.index));

  if (listRows.length === 0) {
    return {
      workspaces: workspaceRows,
      boards: boardRows,
      lists: listRows,
      cards: [],
      activities: [],
      members: memberRows,
      assignments: [],
    };
  }

  const cardRows = await db
    .select({
      id: cards.id,
      publicId: cards.publicId,
      title: cards.title,
      cardNumber: cards.cardNumber,
      listId: cards.listId,
      createdAt: cards.createdAt,
      dueDate: cards.dueDate,
      priority: cards.priority,
      startedAt: cards.startedAt,
      completedAt: cards.completedAt,
    })
    .from(cards)
    .where(
      and(
        inArray(
          cards.listId,
          listRows.map((list) => list.id),
        ),
        isNull(cards.deletedAt),
      ),
    );

  if (cardRows.length === 0) {
    return {
      workspaces: workspaceRows,
      boards: boardRows,
      lists: listRows,
      cards: cardRows,
      activities: [],
      members: memberRows,
      assignments: [],
    };
  }

  const cardIds = cardRows.map((card) => card.id);
  const [activityRows, assignmentRows] = await Promise.all([
    db
      .select({
        cardId: cardActivities.cardId,
        fromListId: cardActivities.fromListId,
        toListId: cardActivities.toListId,
        createdBy: cardActivities.createdBy,
        createdAt: cardActivities.createdAt,
      })
      .from(cardActivities)
      .where(
        and(
          inArray(cardActivities.cardId, cardIds),
          eq(cardActivities.type, "card.updated.list"),
        ),
      )
      .orderBy(asc(cardActivities.createdAt)),
    db
      .select({
        cardId: cardToWorkspaceMembers.cardId,
        memberId: cardToWorkspaceMembers.workspaceMemberId,
      })
      .from(cardToWorkspaceMembers)
      .innerJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .where(
        and(
          inArray(cardToWorkspaceMembers.cardId, cardIds),
          inArray(workspaceMembers.workspaceId, workspaceIds),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      ),
  ]);

  return {
    workspaces: workspaceRows,
    boards: boardRows,
    lists: listRows,
    cards: cardRows,
    activities: activityRows,
    members: memberRows,
    assignments: assignmentRows,
  };
};
