import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import * as cardMoveRepo from "@kan/db/repository/card-move.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import {
  boards,
  cardActivities,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  labels,
  lists,
  workspaceMembers,
} from "@kan/db/schema";
import * as schema from "@kan/db/schema";

type TestDbClient = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

describe("card move many repository", () => {
  let db: TestDbClient;
  let seeded: Awaited<ReturnType<typeof seedMoveData>>;

  beforeEach(async () => {
    db = await createTestDb();
    seeded = await seedMoveData(db);
  });

  it("moves cards atomically, compacts indices and keeps every member", async () => {
    const memberAssignmentsBefore = await getMemberAssignments(
      db,
      seeded.selectedCardIds,
    );

    const movedCards = await cardMoveRepo.moveMany(db, {
      cardIds: [seeded.secondCard.id, seeded.firstCard.id],
      destinationListId: seeded.destinationList.id,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });

    const destinationCards = await db
      .select({
        publicId: cards.publicId,
        index: cards.index,
        dueDate: cards.dueDate,
        priority: cards.priority,
        colourCode: cards.colourCode,
        startedAt: cards.startedAt,
        completedAt: cards.completedAt,
      })
      .from(cards)
      .where(eq(cards.listId, seeded.destinationList.id))
      .orderBy(asc(cards.index));
    const sourceCards = await db
      .select({
        publicId: cards.publicId,
        listId: cards.listId,
        index: cards.index,
      })
      .from(cards)
      .where(
        inArray(cards.listId, [
          seeded.firstSourceList.id,
          seeded.secondSourceList.id,
        ]),
      )
      .orderBy(asc(cards.listId), asc(cards.index));
    const memberAssignmentsAfter = await getMemberAssignments(
      db,
      seeded.selectedCardIds,
    );
    const remainingLabels = await db
      .select()
      .from(cardsToLabels)
      .where(inArray(cardsToLabels.cardId, seeded.selectedCardIds));
    const activities = await db
      .select({
        type: cardActivities.type,
        cardId: cardActivities.cardId,
        fromListId: cardActivities.fromListId,
        toListId: cardActivities.toListId,
        labelId: cardActivities.labelId,
      })
      .from(cardActivities)
      .where(inArray(cardActivities.cardId, seeded.selectedCardIds));

    expect(movedCards.map((card) => card.publicId)).toEqual([
      seeded.secondCard.publicId,
      seeded.firstCard.publicId,
    ]);
    expect(destinationCards.slice(0, 2)).toEqual([
      {
        publicId: seeded.secondCard.publicId,
        index: 0,
        dueDate: seeded.secondCard.dueDate,
        priority: seeded.secondCard.priority,
        colourCode: seeded.secondCard.colourCode,
        startedAt: seeded.secondCard.startedAt,
        completedAt: null,
      },
      {
        publicId: seeded.firstCard.publicId,
        index: 1,
        dueDate: seeded.firstCard.dueDate,
        priority: seeded.firstCard.priority,
        colourCode: seeded.firstCard.colourCode,
        startedAt: seeded.firstCard.startedAt,
        completedAt: null,
      },
    ]);
    expect(destinationCards[2]).toMatchObject({
      publicId: seeded.destinationCard.publicId,
      index: 2,
    });
    expect(sourceCards).toEqual([
      {
        publicId: seeded.firstSourceCard.publicId,
        listId: seeded.firstSourceList.id,
        index: 0,
      },
      {
        publicId: seeded.secondSourceCard.publicId,
        listId: seeded.secondSourceList.id,
        index: 0,
      },
    ]);
    expect(memberAssignmentsAfter).toEqual(memberAssignmentsBefore);
    expect(remainingLabels).toEqual([]);
    expect(
      activities.filter((activity) => activity.type === "card.updated.list"),
    ).toHaveLength(2);
    expect(
      activities.filter(
        (activity) => activity.type === "card.updated.label.removed",
      ),
    ).toHaveLength(2);
    expect(
      activities
        .filter((activity) => activity.type === "card.updated.list")
        .every(
          (activity) =>
            activity.toListId === seeded.destinationList.id &&
            activity.fromListId !== null,
        ),
    ).toBe(true);
  });

  it("rolls back without changing relations when any card is missing", async () => {
    const cardsBefore = await getCards(db);
    const labelsBefore = await getLabelAssignments(db);
    const membersBefore = await getMemberAssignments(
      db,
      seeded.selectedCardIds,
    );

    await expect(
      cardMoveRepo.moveMany(db, {
        cardIds: [seeded.firstCard.id, 999999],
        destinationListId: seeded.destinationList.id,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).rejects.toThrow("One or more cards were not found");

    expect(await getCards(db)).toEqual(cardsBefore);
    expect(await getLabelAssignments(db)).toEqual(labelsBefore);
    expect(await getMemberAssignments(db, seeded.selectedCardIds)).toEqual(
      membersBefore,
    );
    expect(await db.select().from(cardActivities)).toEqual([]);
  });

  it("updates every card lifecycle transactionally when a non-empty list changes status", async () => {
    await expect(
      listRepo.update(
        db,
        { status: "inProgress" },
        {
          listPublicId: seeded.firstSourceList.publicId,
          expectedWorkspaceId: seeded.workspace.id,
        },
      ),
    ).rejects.toBeInstanceOf(
      listRepo.ListStatusChangeConfirmationRequiredError,
    );

    const [unchangedCard] = await db
      .select({ startedAt: cards.startedAt })
      .from(cards)
      .where(eq(cards.id, seeded.firstSourceCard.id));
    expect(unchangedCard?.startedAt).toBeNull();

    await listRepo.update(
      db,
      { status: "inProgress", confirmCardLifecycleUpdate: true },
      {
        listPublicId: seeded.firstSourceList.publicId,
        expectedWorkspaceId: seeded.workspace.id,
      },
    );
    const [startedCard] = await db
      .select({ startedAt: cards.startedAt, completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.firstSourceCard.id));
    expect(startedCard?.startedAt).toBeInstanceOf(Date);
    expect(startedCard?.completedAt).toBeNull();

    await listRepo.update(
      db,
      { status: "blocked", confirmCardLifecycleUpdate: true },
      {
        listPublicId: seeded.firstSourceList.publicId,
        expectedWorkspaceId: seeded.workspace.id,
      },
    );
    const [blockedCard] = await db
      .select({ startedAt: cards.startedAt, completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.firstSourceCard.id));
    expect(blockedCard?.startedAt).toEqual(startedCard?.startedAt);
    expect(blockedCard?.completedAt).toBeNull();

    await listRepo.update(
      db,
      { status: "done", confirmCardLifecycleUpdate: true },
      {
        listPublicId: seeded.firstSourceList.publicId,
        expectedWorkspaceId: seeded.workspace.id,
      },
    );
    const [completedCard] = await db
      .select({ startedAt: cards.startedAt, completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.firstSourceCard.id));
    expect(completedCard?.startedAt).toEqual(startedCard?.startedAt);
    expect(completedCard?.completedAt).toBeInstanceOf(Date);

    await listRepo.update(
      db,
      { status: "planned", confirmCardLifecycleUpdate: true },
      {
        listPublicId: seeded.firstSourceList.publicId,
        expectedWorkspaceId: seeded.workspace.id,
      },
    );
    const [reopenedCard] = await db
      .select({ startedAt: cards.startedAt, completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.firstSourceCard.id));
    expect(reopenedCard).toEqual({
      startedAt: startedCard?.startedAt,
      completedAt: null,
    });
  });

  it("keeps lifecycle and indices consistent when a move races a list status change", async () => {
    await Promise.all([
      cardMoveRepo.moveMany(db, {
        cardIds: [seeded.firstCard.id],
        destinationListId: seeded.destinationList.id,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
      listRepo.update(
        db,
        { status: "done", confirmCardLifecycleUpdate: true },
        {
          listPublicId: seeded.destinationList.publicId,
          expectedWorkspaceId: seeded.workspace.id,
        },
      ),
    ]);

    const [destination] = await db
      .select({ status: lists.status })
      .from(lists)
      .where(eq(lists.id, seeded.destinationList.id));
    const destinationCards = await db
      .select({
        publicId: cards.publicId,
        index: cards.index,
        completedAt: cards.completedAt,
      })
      .from(cards)
      .where(eq(cards.listId, seeded.destinationList.id))
      .orderBy(asc(cards.index));

    expect(destination?.status).toBe("done");
    expect(destinationCards.map((card) => card.index)).toEqual([0, 1]);
    expect(destinationCards.map((card) => card.publicId)).toContain(
      seeded.firstCard.publicId,
    );
    expect(
      destinationCards.every((card) => card.completedAt instanceof Date),
    ).toBe(true);
  });
});

async function seedMoveData(db: TestDbClient) {
  const { user, workspace } = await seedTestData(db);
  const [sourceBoard, destinationBoard] = await db
    .insert(boards)
    .values([
      {
        publicId: "boardSource1",
        name: "IA",
        slug: "ia",
        workspaceId: workspace.id,
        createdBy: user.id,
      },
      {
        publicId: "boardTarget1",
        name: "Foco",
        slug: "foco",
        workspaceId: workspace.id,
        createdBy: user.id,
      },
    ])
    .returning();

  if (!sourceBoard || !destinationBoard) {
    throw new Error("Failed to seed boards");
  }

  const [firstSourceList, secondSourceList, destinationList] = await db
    .insert(lists)
    .values([
      {
        publicId: "listSource01",
        name: "Por hacer",
        index: 0,
        boardId: sourceBoard.id,
        createdBy: user.id,
        status: "planned",
      },
      {
        publicId: "listSource02",
        name: "En curso",
        index: 1,
        boardId: sourceBoard.id,
        createdBy: user.id,
        status: "inProgress",
      },
      {
        publicId: "listTarget01",
        name: "Recibidas",
        index: 0,
        boardId: destinationBoard.id,
        createdBy: user.id,
        status: "blocked",
      },
    ])
    .returning();

  if (!firstSourceList || !secondSourceList || !destinationList) {
    throw new Error("Failed to seed lists");
  }

  const [
    firstCard,
    firstSourceCard,
    secondCard,
    secondSourceCard,
    destinationCard,
  ] = await db
    .insert(cards)
    .values([
      {
        publicId: "cardMove0001",
        title: "First selected",
        index: 0,
        listId: firstSourceList.id,
        createdBy: user.id,
        dueDate: new Date("2026-08-22T12:00:00.000Z"),
        priority: "urgent",
        colourCode: "#dc2626",
        startedAt: new Date("2026-08-19T09:00:00.000Z"),
      },
      {
        publicId: "cardStay0001",
        title: "First remaining",
        index: 1,
        listId: firstSourceList.id,
        createdBy: user.id,
      },
      {
        publicId: "cardMove0002",
        title: "Second selected",
        index: 0,
        listId: secondSourceList.id,
        createdBy: user.id,
        dueDate: new Date("2026-08-23T15:30:00.000Z"),
        priority: "high",
        colourCode: "#ea580c",
        startedAt: new Date("2026-08-20T08:00:00.000Z"),
      },
      {
        publicId: "cardStay0002",
        title: "Second remaining",
        index: 1,
        listId: secondSourceList.id,
        createdBy: user.id,
      },
      {
        publicId: "cardDest0001",
        title: "Existing destination",
        index: 0,
        listId: destinationList.id,
        createdBy: user.id,
      },
    ])
    .returning();

  if (
    !firstCard ||
    !firstSourceCard ||
    !secondCard ||
    !secondSourceCard ||
    !destinationCard
  ) {
    throw new Error("Failed to seed cards");
  }

  const [label] = await db
    .insert(labels)
    .values({
      publicId: "labelSource1",
      name: "Source label",
      boardId: sourceBoard.id,
      createdBy: user.id,
    })
    .returning();
  const [assignedMember] = await db
    .insert(workspaceMembers)
    .values({
      publicId: "memberAssign",
      email: "assigned@example.com",
      workspaceId: workspace.id,
      createdBy: user.id,
      role: "member",
      status: "active",
    })
    .returning();

  if (!label || !assignedMember) {
    throw new Error("Failed to seed card relations");
  }

  await db.insert(cardsToLabels).values([
    { cardId: firstCard.id, labelId: label.id },
    { cardId: secondCard.id, labelId: label.id },
  ]);
  await db.insert(cardToWorkspaceMembers).values([
    {
      cardId: firstCard.id,
      workspaceMemberId: assignedMember.id,
    },
    {
      cardId: secondCard.id,
      workspaceMemberId: assignedMember.id,
    },
  ]);

  return {
    user,
    workspace,
    sourceBoard,
    destinationBoard,
    firstSourceList,
    secondSourceList,
    destinationList,
    firstCard,
    firstSourceCard,
    secondCard,
    secondSourceCard,
    destinationCard,
    label,
    selectedCardIds: [firstCard.id, secondCard.id],
  };
}

function getCards(db: TestDbClient) {
  return db
    .select({
      id: cards.id,
      listId: cards.listId,
      index: cards.index,
    })
    .from(cards)
    .orderBy(asc(cards.id));
}

function getLabelAssignments(db: TestDbClient) {
  return db
    .select({
      cardId: cardsToLabels.cardId,
      labelId: cardsToLabels.labelId,
    })
    .from(cardsToLabels)
    .orderBy(asc(cardsToLabels.cardId));
}

function getMemberAssignments(db: TestDbClient, cardIds: number[]) {
  return db
    .select({
      cardId: cardToWorkspaceMembers.cardId,
      workspaceMemberId: cardToWorkspaceMembers.workspaceMemberId,
    })
    .from(cardToWorkspaceMembers)
    .where(inArray(cardToWorkspaceMembers.cardId, cardIds))
    .orderBy(asc(cardToWorkspaceMembers.cardId));
}

async function createTestDb(): Promise<TestDbClient> {
  const client = new PGlite({
    extensions: { uuid_ossp, pg_trgm },
  });
  const db = drizzle(client, { schema });

  await migrate(db, {
    migrationsFolder: "../../packages/db/migrations",
  });

  return db as unknown as TestDbClient;
}

async function seedTestData(db: TestDbClient) {
  const [user] = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (!user) throw new Error("Failed to seed user");

  const [workspace] = await db
    .insert(schema.workspaces)
    .values({
      publicId: "wstest123456",
      name: "Test Workspace",
      slug: "test-workspace",
      createdBy: user.id,
      createdAt: new Date(),
    })
    .returning();

  if (!workspace) throw new Error("Failed to seed workspace");

  await db.insert(schema.workspaceMembers).values({
    publicId: "wm1234567890",
    email: user.email,
    workspaceId: workspace.id,
    userId: user.id,
    createdBy: user.id,
    role: "admin",
    status: "active",
    createdAt: new Date(),
  });

  return { user, workspace };
}
