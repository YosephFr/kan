import { asc, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as boardCreateRepo from "@kan/db/repository/boardCreate.repo";
import * as boardReadRepo from "@kan/db/repository/boardRead.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as cardDuplicateRepo from "@kan/db/repository/cardDuplicate.repo";
import * as cardPipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as cardReadRepo from "@kan/db/repository/cardRead.repo";
import * as labelRepo from "@kan/db/repository/label.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import {
  boards,
  cardActivities,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  labels,
  lists,
  workspaces,
} from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("workspace transaction boundaries", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("creates a card, associations and activities in one guarded transaction", async () => {
    const [label] = await db
      .insert(labels)
      .values({
        publicId: "labelpipe001",
        name: "Atomic",
        colourCode: "#0d9488",
        boardId: seeded.board.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!label) throw new Error("Label missing");

    const created = await cardRepo.create(db, {
      title: "Atomic card",
      description: "",
      createdBy: seeded.user.id,
      listId: seeded.list.id,
      workspaceId: seeded.workspace.id,
      position: "end",
      labelIds: [label.id],
      workspaceMemberIds: [seeded.member.id],
    });

    expect(
      await db
        .select()
        .from(cardsToLabels)
        .where(eq(cardsToLabels.cardId, created.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(cardToWorkspaceMembers)
        .where(eq(cardToWorkspaceMembers.cardId, created.id)),
    ).toHaveLength(1);
    const activities = await db
      .select({ type: cardActivities.type })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, created.id));
    expect(activities.map((activity) => activity.type)).toEqual([
      "card.created",
      "card.updated.label.added",
      "card.updated.member.added",
    ]);
  });

  it("rejects stale target workspace before card counter or card changes", async () => {
    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, seeded.board.id));
    const [counterBefore] = await db
      .select({ cardCounter: workspaces.cardCounter })
      .from(workspaces)
      .where(eq(workspaces.id, seeded.workspace.id));
    const [cardsBefore] = await db.select({ count: count() }).from(cards);

    await expect(
      cardRepo.create(db, {
        title: "Must not exist",
        description: "",
        createdBy: seeded.user.id,
        listId: seeded.list.id,
        workspaceId: seeded.workspace.id,
        position: "end",
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);

    const [counterAfter] = await db
      .select({ cardCounter: workspaces.cardCounter })
      .from(workspaces)
      .where(eq(workspaces.id, seeded.workspace.id));
    const [cardsAfter] = await db.select({ count: count() }).from(cards);
    expect(counterAfter).toEqual(counterBefore);
    expect(cardsAfter).toEqual(cardsBefore);
  });

  it("creates board setup atomically and rolls back every row on child failure", async () => {
    const created = await boardCreateRepo.createWithSetup(db, {
      name: "Atomic setup",
      slug: "atomic-setup",
      createdBy: seeded.user.id,
      workspaceId: seeded.workspace.id,
      lists: [{ name: "Por hacer" }, { name: "Hecho" }],
      labels: [{ name: "Alta", colourCode: "#dc2626" }],
    });
    expect(
      await db.select().from(lists).where(eq(lists.boardId, created.id)),
    ).toHaveLength(2);
    expect(
      await db.select().from(labels).where(eq(labels.boardId, created.id)),
    ).toHaveLength(1);

    await expect(
      boardCreateRepo.createWithSetup(db, {
        name: "Rolled back",
        slug: "rolled-back",
        createdBy: seeded.user.id,
        workspaceId: seeded.workspace.id,
        lists: [{ name: "Por hacer" }],
        labels: [
          {
            publicId: "duplicated001",
            name: "One",
            colourCode: "#dc2626",
          },
          {
            publicId: "duplicated001",
            name: "Two",
            colourCode: "#0284c7",
          },
        ],
      }),
    ).rejects.toThrow();
    expect(
      await db.select().from(boards).where(eq(boards.slug, "rolled-back")),
    ).toHaveLength(0);
  });

  it("guards imported cards and label relationships against moved boards", async () => {
    const [targetBoard] = await db
      .insert(boards)
      .values({
        publicId: "boardbulk001",
        name: "Bulk",
        slug: "bulk",
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!targetBoard) throw new Error("Target board missing");
    const [targetList] = await db
      .insert(lists)
      .values({
        publicId: "listbulk0001",
        name: "Bulk",
        index: 0,
        boardId: targetBoard.id,
        createdBy: seeded.user.id,
      })
      .returning();
    const [foreignLabel] = await db
      .insert(labels)
      .values({
        publicId: "labelbulk001",
        name: "Foreign",
        colourCode: "#dc2626",
        boardId: targetBoard.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!targetList || !foreignLabel) throw new Error("Target setup missing");

    await expect(
      cardRepo.bulkCreateCardLabelRelationships(
        db,
        [{ cardId: seeded.card.id, labelId: foreignLabel.id }],
        { expectedWorkspaceId: seeded.workspace.id },
      ),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);

    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, targetBoard.id));
    const [counterBefore] = await db
      .select({ cardCounter: workspaces.cardCounter })
      .from(workspaces)
      .where(eq(workspaces.id, seeded.workspace.id));
    await expect(
      cardRepo.bulkCreate(db, [
        {
          publicId: "cardbulk0001",
          title: "Must not exist",
          description: "",
          createdBy: seeded.user.id,
          listId: targetList.id,
          workspaceId: seeded.workspace.id,
          index: 0,
        },
      ]),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
    const [counterAfter] = await db
      .select({ cardCounter: workspaces.cardCounter })
      .from(workspaces)
      .where(eq(workspaces.id, seeded.workspace.id));
    expect(counterAfter).toEqual(counterBefore);
    expect(
      await db.select().from(cards).where(eq(cards.listId, targetList.id)),
    ).toHaveLength(0);
  });

  it("duplicates from a coherent source and clamps an oversized index", async () => {
    const duplicated = await cardDuplicateRepo.duplicateCard(db, {
      sourceCardPublicId: seeded.card.publicId,
      targetListPublicId: seeded.list.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      index: 999,
      copyLabels: true,
      copyMembers: true,
      copyChecklists: true,
      copyPipeline: true,
      publicVisibilityAcknowledged: true,
    });
    if (duplicated.status !== "duplicated") {
      throw new Error("Duplicate unexpectedly required acknowledgement");
    }
    const ordered = await db
      .select({ publicId: cards.publicId, index: cards.index })
      .from(cards)
      .where(eq(cards.listId, seeded.list.id))
      .orderBy(asc(cards.index));
    expect(ordered.map((card) => card.index)).toEqual([0, 1, 2]);
    expect(ordered[2]?.publicId).toBe(duplicated.publicId);
  });

  it("rolls back card reordering when a combined scalar update fails", async () => {
    const [activityCountBefore] = await db
      .select({ count: count() })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, seeded.card.id));
    await expect(
      cardRepo.reorder(db, {
        cardId: seeded.card.id,
        newIndex: 1,
        newListId: undefined,
        expectedWorkspaceId: seeded.workspace.id,
        updates: { priority: "invalid" as never },
        activities: [
          {
            type: "card.updated.index",
            createdBy: seeded.user.id,
            fromIndex: 0,
            toIndex: 1,
          },
        ],
      }),
    ).rejects.toThrow();
    const ordered = await db
      .select({ publicId: cards.publicId, index: cards.index })
      .from(cards)
      .where(eq(cards.listId, seeded.list.id))
      .orderBy(asc(cards.index));
    expect(ordered).toEqual([
      { publicId: seeded.card.publicId, index: 0 },
      { publicId: seeded.emptyCard.publicId, index: 1 },
    ]);
    const [activityCountAfter] = await db
      .select({ count: count() })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, seeded.card.id));
    expect(activityCountAfter).toEqual(activityCountBefore);
  });

  it("rolls back scalar changes when their activity cannot be written", async () => {
    await expect(
      cardRepo.update(
        db,
        { title: "Must roll back" },
        {
          cardPublicId: seeded.card.publicId,
          expectedWorkspaceId: seeded.workspace.id,
          activities: [{ type: "invalid" as never, createdBy: seeded.user.id }],
        },
      ),
    ).rejects.toThrow();
    const [card] = await db
      .select({ title: cards.title })
      .from(cards)
      .where(eq(cards.id, seeded.card.id));
    expect(card?.title).toBe(seeded.card.title);
  });

  it("writes the archive activity in the card deletion transaction", async () => {
    await cardRepo.softDelete(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      deletedAt: new Date(),
      deletedBy: seeded.user.id,
    });
    const activities = await db
      .select({ type: cardActivities.type })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, seeded.card.id));
    expect(
      activities.some((activity) => activity.type === "card.archived"),
    ).toBe(true);
  });

  it("rejects duplicate when the target board changed workspace", async () => {
    const [targetBoard] = await db
      .insert(boards)
      .values({
        publicId: "boardtarget1",
        name: "Target",
        slug: "target",
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!targetBoard) throw new Error("Target board missing");
    const [targetList] = await db
      .insert(lists)
      .values({
        publicId: "listtarget01",
        name: "Target",
        index: 0,
        boardId: targetBoard.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!targetList) throw new Error("Target list missing");
    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, targetBoard.id));

    await expect(
      cardDuplicateRepo.duplicateCard(db, {
        sourceCardPublicId: seeded.card.publicId,
        targetListPublicId: targetList.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        copyLabels: false,
        copyMembers: false,
        copyChecklists: false,
        copyPipeline: false,
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
    const [cardCount] = await db
      .select({ count: count() })
      .from(cards)
      .where(eq(cards.listId, targetList.id));
    expect(cardCount?.count).toBe(0);
  });

  it("rejects duplicate when the source board changed workspace", async () => {
    const [targetBoard] = await db
      .insert(boards)
      .values({
        publicId: "boardsrc0001",
        name: "Target",
        slug: "source-target",
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!targetBoard) throw new Error("Target board missing");
    const [targetList] = await db
      .insert(lists)
      .values({
        publicId: "listsrc00001",
        name: "Target",
        index: 0,
        boardId: targetBoard.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!targetList) throw new Error("Target list missing");
    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, seeded.board.id));

    await expect(
      cardDuplicateRepo.duplicateCard(db, {
        sourceCardPublicId: seeded.card.publicId,
        targetListPublicId: targetList.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        copyLabels: false,
        copyMembers: false,
        copyChecklists: false,
        copyPipeline: false,
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
    expect(
      await db.select().from(cards).where(eq(cards.listId, targetList.id)),
    ).toHaveLength(0);
  });

  it("rechecks public visibility for every card and board snapshot", async () => {
    await db
      .update(boards)
      .set({ visibility: "private" })
      .where(eq(boards.id, seeded.board.id));
    const expected = WorkspaceChangedError;

    await expect(
      cardReadRepo.getDetailSnapshot(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: true,
      }),
    ).rejects.toBeInstanceOf(expected);
    await expect(
      cardActivityRepo.getPaginatedActivitiesGuarded(db, {
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: true,
      }),
    ).rejects.toBeInstanceOf(expected);
    await expect(
      cardPipelineRepo.getByCardPublicIdGuarded(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: true,
      }),
    ).rejects.toBeInstanceOf(expected);
    await expect(
      boardReadRepo.getBySlugGuarded(db, {
        boardSlug: seeded.board.slug,
        expectedWorkspaceId: seeded.workspace.id,
        filters: {
          members: [],
          labels: [],
          lists: [],
          dueDate: [],
          priorities: [],
        },
      }),
    ).rejects.toBeInstanceOf(expected);
  });

  it("clones the live locked board instead of an external snapshot", async () => {
    const [firstLabel, secondLabel] = await db
      .insert(labels)
      .values([
        {
          publicId: "labelclone01",
          name: "First",
          colourCode: "#0284c7",
          boardId: seeded.board.id,
          createdBy: seeded.user.id,
        },
        {
          publicId: "labelclone02",
          name: "Second",
          colourCode: "#dc2626",
          boardId: seeded.board.id,
          createdBy: seeded.user.id,
        },
      ])
      .returning();
    if (!firstLabel || !secondLabel) throw new Error("Source labels missing");
    await db.insert(cardsToLabels).values({
      cardId: seeded.card.id,
      labelId: secondLabel.id,
    });
    const cloned = await boardRepo.createFromSnapshot(db, {
      workspaceId: seeded.workspace.id,
      expectedSourceWorkspaceId: seeded.workspace.id,
      sourceBoardId: seeded.board.id,
      createdBy: seeded.user.id,
      slug: "live-clone",
      name: "Live clone",
      type: "regular",
    });
    const cloneLists = await db
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.boardId, cloned.id));
    const cloneCards = await db
      .select({ id: cards.id, title: cards.title })
      .from(cards)
      .where(eq(cards.listId, cloneLists[0]?.id ?? -1))
      .orderBy(asc(cards.index));
    expect(cloneCards.map((card) => card.title)).toEqual([
      seeded.card.title,
      seeded.emptyCard.title,
    ]);
    const clonedCard = cloneCards.find(
      (card) => card.title === seeded.card.title,
    );
    if (!clonedCard) throw new Error("Cloned card missing");
    const clonedCardLabels = await db
      .select({ name: labels.name })
      .from(cardsToLabels)
      .innerJoin(labels, eq(cardsToLabels.labelId, labels.id))
      .where(eq(cardsToLabels.cardId, clonedCard.id));
    expect(clonedCardLabels).toEqual([{ name: secondLabel.name }]);
  });

  it("rejects stale list and label commands after a board move", async () => {
    const [label] = await db
      .insert(labels)
      .values({
        publicId: "labelmoved01",
        name: "Moved",
        colourCode: "#0d9488",
        boardId: seeded.board.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!label) throw new Error("Label missing");
    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, seeded.board.id));

    await expect(
      listRepo.create(db, {
        name: "Stale",
        boardId: seeded.board.id,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
    await expect(
      labelRepo.getByPublicIdGuarded(db, {
        labelPublicId: label.publicId,
        expectedWorkspaceId: seeded.workspace.id,
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
  });
});
