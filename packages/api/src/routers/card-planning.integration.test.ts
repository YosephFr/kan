import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as labelRepo from "@kan/db/repository/label.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
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

describe("card planning repository", () => {
  let db: TestDbClient;
  let seeded: Awaited<ReturnType<typeof seedMoveData>>;

  beforeEach(async () => {
    db = await createTestDb();
    seeded = await seedMoveData(db);
  });

  it("creates templates with list/card styling but without absolute or execution dates", async () => {
    const sourceSnapshot = {
      name: "Source",
      labels: [],
      lists: [
        {
          name: "En progreso",
          index: 0,
          status: "inProgress" as const,
          colourCode: "#0284c7",
          cards: [
            {
              title: "Template task",
              description: "Reusable",
              index: 0,
              priority: "urgent" as const,
              colourCode: "#dc2626",
              dueDate: new Date("2026-09-01T12:00:00.000Z"),
              startedAt: new Date("2026-08-20T08:00:00.000Z"),
              completedAt: new Date("2026-08-20T10:00:00.000Z"),
              labels: [],
              checklists: [],
            },
          ],
        },
      ],
    };

    const template = await boardRepo.createFromSnapshot(db, {
      source: sourceSnapshot,
      workspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      slug: "source-template",
      name: "Source template",
      type: "template",
    });
    const [templateList] = await db
      .select({
        id: lists.id,
        status: lists.status,
        colourCode: lists.colourCode,
      })
      .from(lists)
      .where(eq(lists.boardId, template.id));
    const [templateCard] = templateList
      ? await db
          .select({
            priority: cards.priority,
            colourCode: cards.colourCode,
            dueDate: cards.dueDate,
            startedAt: cards.startedAt,
            completedAt: cards.completedAt,
          })
          .from(cards)
          .where(eq(cards.listId, templateList.id))
      : [];

    expect(templateList).toMatchObject({
      status: "inProgress",
      colourCode: "#0284c7",
    });
    expect(templateCard).toEqual({
      priority: "urgent",
      colourCode: "#dc2626",
      dueDate: null,
      startedAt: null,
      completedAt: null,
    });
  });

  it("filters board cards by the dedicated priority field", async () => {
    const board = await boardRepo.getByPublicId(
      db,
      seeded.sourceBoard.publicId,
      seeded.user.id,
      {
        members: [],
        labels: [],
        lists: [],
        dueDate: [],
        priorities: ["urgent"],
        type: "regular",
      },
    );

    expect(
      board?.lists.flatMap((list) => list.cards.map((card) => card.publicId)),
    ).toEqual([seeded.firstCard.publicId]);
  });

  it("includes a card due exactly at the filter end date", async () => {
    if (!seeded.firstCard.dueDate) throw new Error("Expected seeded due date");

    const board = await boardRepo.getByPublicId(
      db,
      seeded.sourceBoard.publicId,
      seeded.user.id,
      {
        members: [],
        labels: [],
        lists: [],
        dueDate: [{ endDate: seeded.firstCard.dueDate }],
        priorities: [],
        type: "regular",
      },
    );

    expect(
      board?.lists.flatMap((list) => list.cards.map((card) => card.publicId)),
    ).toEqual([seeded.firstCard.publicId]);
  });

  it("backfills the real completion instead of a later done-to-done move", async () => {
    const [firstDoneList, secondDoneList] = await db
      .insert(lists)
      .values([
        {
          publicId: "listDone0001",
          name: "Hecho",
          index: 2,
          boardId: seeded.sourceBoard.id,
          createdBy: seeded.user.id,
          status: "done",
        },
        {
          publicId: "listDone0002",
          name: "Entregado",
          index: 3,
          boardId: seeded.sourceBoard.id,
          createdBy: seeded.user.id,
          status: "done",
        },
      ])
      .returning();

    if (!firstDoneList || !secondDoneList) {
      throw new Error("Failed to seed done lists");
    }

    const firstCompletion = new Date("2026-08-19T12:00:00.000Z");
    const doneToDoneMove = new Date("2026-08-20T12:00:00.000Z");

    await db
      .update(cards)
      .set({ listId: secondDoneList.id, completedAt: null })
      .where(eq(cards.id, seeded.firstSourceCard.id));
    await db.insert(cardActivities).values([
      {
        publicId: "actDone00001",
        type: "card.updated.list" as const,
        cardId: seeded.firstSourceCard.id,
        fromListId: seeded.firstSourceList.id,
        toListId: firstDoneList.id,
        createdBy: seeded.user.id,
        createdAt: firstCompletion,
      },
      {
        publicId: "actDone00002",
        type: "card.updated.list" as const,
        cardId: seeded.firstSourceCard.id,
        fromListId: firstDoneList.id,
        toListId: secondDoneList.id,
        createdBy: seeded.user.id,
        createdAt: doneToDoneMove,
      },
    ]);

    const migrationSql = readFileSync(
      resolve(
        process.cwd(),
        "../db/migrations/20260820120811_AddCardPlanningFields.sql",
      ),
      "utf8",
    );
    const completedAtBackfill = migrationSql
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes('SET "completedAt"'));

    if (!completedAtBackfill)
      throw new Error("Completed-at backfill not found");
    await db.$client.query(completedAtBackfill);

    const [backfilledCard] = await db
      .select({ completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.firstSourceCard.id));

    expect(backfilledCard?.completedAt).toEqual(firstCompletion);
  });

  it("scopes active member lookups to their workspace", async () => {
    const [otherWorkspace] = await db
      .insert(schema.workspaces)
      .values({
        publicId: "wscross12345",
        name: "Other Workspace",
        slug: "other-workspace",
        createdBy: seeded.user.id,
      })
      .returning();

    if (!otherWorkspace) throw new Error("Failed to seed other workspace");

    await db.insert(workspaceMembers).values([
      {
        publicId: "memberCross1",
        email: "cross@example.com",
        workspaceId: otherWorkspace.id,
        createdBy: seeded.user.id,
        role: "member",
        status: "active",
      },
      {
        publicId: "memberPaused",
        email: "paused@example.com",
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        role: "member",
        status: "paused",
      },
      {
        publicId: "memberDelete",
        email: "deleted@example.com",
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        role: "member",
        status: "active",
        deletedAt: new Date(),
      },
    ]);

    expect(
      await workspaceRepo.getMemberByPublicId(
        db,
        "memberCross1",
        seeded.workspace.id,
      ),
    ).toBeUndefined();
    expect(
      await workspaceRepo.getAllMembersByPublicIds(
        db,
        ["memberCross1", "memberPaused", "memberDelete"],
        seeded.workspace.id,
      ),
    ).toEqual([]);
  });

  it("scopes label lookups to the exact board", async () => {
    const [otherBoardLabel] = await db
      .insert(labels)
      .values({
        publicId: "labelOther01",
        name: "Other board label",
        boardId: seeded.destinationBoard.id,
        createdBy: seeded.user.id,
      })
      .returning();

    if (!otherBoardLabel) throw new Error("Failed to seed other label");

    expect(
      await labelRepo.getAllByPublicIdsForBoard(
        db,
        [seeded.label.publicId, otherBoardLabel.publicId],
        seeded.sourceBoard.id,
      ),
    ).toEqual([{ id: seeded.label.id }]);
    expect(
      await labelRepo.getByPublicIdForBoard(
        db,
        otherBoardLabel.publicId,
        seeded.sourceBoard.id,
      ),
    ).toBeUndefined();
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
