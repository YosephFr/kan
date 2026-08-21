import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardPriority } from "@kan/db/schema";
import {
  cardActivities,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  labels,
  lists,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { deriveCardLifecycle } from "./cardLifecycle";
import {
  assertBoardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export const create = async (
  db: dbClient,
  cardInput: {
    title: string;
    description: string;
    createdBy: string;
    listId: number;
    workspaceId: number;
    position: "start" | "end";
    dueDate?: Date | null;
    priority?: CardPriority;
    colourCode?: string | null;
    initializeLifecycle?: boolean;
    labelIds?: number[];
    workspaceMemberIds?: number[];
  },
) =>
  db.transaction(async (tx) => {
    let index = 0;
    const lifecycleAt = new Date();
    const [destinationList] = await tx
      .select({ boardId: lists.boardId, status: lists.status })
      .from(lists)
      .where(and(eq(lists.id, cardInput.listId), isNull(lists.deletedAt)))
      .limit(1)
      .for("update");

    if (!destinationList) throw new WorkspaceChangedError();
    const lockedCards = await tx
      .select({ id: cards.id, index: cards.index })
      .from(cards)
      .where(and(eq(cards.listId, cardInput.listId), isNull(cards.deletedAt)))
      .orderBy(asc(cards.id))
      .for("update");
    await assertBoardsInWorkspace(
      tx,
      [destinationList.boardId],
      cardInput.workspaceId,
      { workspaceLock: "update" },
    );

    const labelIds = [...new Set(cardInput.labelIds ?? [])].sort(
      (a, b) => a - b,
    );
    const selectedLabels =
      labelIds.length === 0
        ? []
        : await tx
            .select({ id: labels.id })
            .from(labels)
            .where(
              and(
                inArray(labels.id, labelIds),
                eq(labels.boardId, destinationList.boardId),
                isNull(labels.deletedAt),
              ),
            )
            .orderBy(asc(labels.id))
            .for("share");
    if (selectedLabels.length !== labelIds.length) {
      throw new WorkspaceChangedError();
    }

    const memberIds = [...new Set(cardInput.workspaceMemberIds ?? [])].sort(
      (a, b) => a - b,
    );
    const selectedMembers =
      memberIds.length === 0
        ? []
        : await tx
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(
              and(
                inArray(workspaceMembers.id, memberIds),
                eq(workspaceMembers.workspaceId, cardInput.workspaceId),
                eq(workspaceMembers.status, "active"),
                isNull(workspaceMembers.deletedAt),
              ),
            )
            .orderBy(asc(workspaceMembers.id))
            .for("share");
    if (selectedMembers.length !== memberIds.length) {
      throw new WorkspaceChangedError();
    }

    const lifecycle =
      cardInput.initializeLifecycle === false
        ? { startedAt: null, completedAt: null }
        : deriveCardLifecycle({
            destinationStatus: destinationList.status,
            startedAt: null,
            movedAt: lifecycleAt,
          });

    if (cardInput.position === "end") {
      const lastCard = [...lockedCards].sort((a, b) => b.index - a.index)[0];
      if (lastCard) index = lastCard.index + 1;
    }

    const existingCardAtIndex = lockedCards.find(
      (card) => card.index === index,
    );
    if (existingCardAtIndex) {
      await tx.execute(sql`
        UPDATE card
        SET index = index + 1
        WHERE "listId" = ${cardInput.listId} AND index >= ${index} AND "deletedAt" IS NULL;
      `);
    }

    const [counterResult] = await tx
      .update(workspaces)
      .set({ cardCounter: sql`${workspaces.cardCounter} + 1` })
      .where(eq(workspaces.id, cardInput.workspaceId))
      .returning({ cardCounter: workspaces.cardCounter });
    if (!counterResult) throw new WorkspaceChangedError();

    const [createdCard] = await tx
      .insert(cards)
      .values({
        publicId: generateUID(),
        title: cardInput.title,
        description: cardInput.description,
        createdBy: cardInput.createdBy,
        listId: cardInput.listId,
        index,
        cardNumber: counterResult.cardCounter,
        dueDate: cardInput.dueDate ?? null,
        priority: cardInput.priority ?? "none",
        colourCode: cardInput.colourCode ?? null,
        startedAt: lifecycle.startedAt,
        completedAt: lifecycle.completedAt,
      })
      .returning({
        id: cards.id,
        listId: cards.listId,
        publicId: cards.publicId,
        cardNumber: cards.cardNumber,
        priority: cards.priority,
        colourCode: cards.colourCode,
        dueDate: cards.dueDate,
        startedAt: cards.startedAt,
        completedAt: cards.completedAt,
      });
    if (!createdCard) throw new Error("Unable to create card");

    const activities = [
      {
        publicId: generateUID(),
        cardId: createdCard.id,
        type: "card.created" as const,
        createdBy: cardInput.createdBy,
      },
      ...selectedLabels.map((label) => ({
        publicId: generateUID(),
        cardId: createdCard.id,
        type: "card.updated.label.added" as const,
        labelId: label.id,
        createdBy: cardInput.createdBy,
      })),
      ...selectedMembers.map((member) => ({
        publicId: generateUID(),
        cardId: createdCard.id,
        type: "card.updated.member.added" as const,
        workspaceMemberId: member.id,
        createdBy: cardInput.createdBy,
      })),
    ];
    if (selectedLabels.length > 0) {
      await tx.insert(cardsToLabels).values(
        selectedLabels.map((label) => ({
          cardId: createdCard.id,
          labelId: label.id,
        })),
      );
    }
    if (selectedMembers.length > 0) {
      await tx.insert(cardToWorkspaceMembers).values(
        selectedMembers.map((member) => ({
          cardId: createdCard.id,
          workspaceMemberId: member.id,
        })),
      );
    }
    await tx.insert(cardActivities).values(activities);

    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);
    const duplicateIndices = await tx
      .select({ index: cards.index, count: countExpr })
      .from(cards)
      .where(and(eq(cards.listId, createdCard.listId), isNull(cards.deletedAt)))
      .groupBy(cards.listId, cards.index)
      .having(gt(countExpr, 1));
    if (duplicateIndices.length > 0) {
      await tx.execute(sql`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
          FROM "card"
          WHERE "listId" = ${createdCard.listId} AND "deletedAt" IS NULL
        )
        UPDATE "card" c
        SET "index" = o.new_index
        FROM ordered o
        WHERE c.id = o.id;
      `);
      const postFixDupes = await tx
        .select({ index: cards.index, count: countExpr })
        .from(cards)
        .where(
          and(eq(cards.listId, createdCard.listId), isNull(cards.deletedAt)),
        )
        .groupBy(cards.listId, cards.index)
        .having(gt(countExpr, 1));
      if (postFixDupes.length > 0) {
        throw new Error(
          `Invariant violation: duplicate card indices remain after compaction in list ${createdCard.listId}`,
        );
      }
    }

    return createdCard;
  });
