import { createHash } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardMoveRepo from "@kan/db/repository/card-move.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardDuplicateRepo from "@kan/db/repository/cardDuplicate.repo";
import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";
import { PublicVisibilityAcknowledgementError } from "@kan/db/repository/cardResourceVisibility.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as subtaskResourceRepo from "@kan/db/repository/cardSubtaskResource.repo";
import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";
import {
  boards,
  cardAttachments,
  cardResources,
  cards,
  cardSubtaskResources,
  cardSubtasks,
  lists,
  workspaceMemberPermissions,
  workspaces,
} from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("card resource repository", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  async function createSourceSubtask() {
    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    if (initialized.status !== "initialized") {
      throw new Error("Pipeline missing");
    }
    const planned = initialized.stages.find(
      (stage) => stage.status === "planned",
    );
    if (!planned) throw new Error("Planned stage missing");
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: planned.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Resource task",
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask missing");
    }
    return created.subtask;
  }

  async function createDrive() {
    const created = await cardResourceRepo.createDrive(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Launch brief",
      driveType: "document",
      driveFileId: "DriveFileId12345",
      resourceKey: "secureResourceKey",
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: true,
    });
    if (created.status !== "created") throw new Error("Drive resource missing");
    return created.publicId;
  }

  async function createWeb() {
    const [resource] = await db
      .insert(cardResources)
      .values({
        publicId: "webresource1",
        cardId: seeded.card.id,
        kind: "web",
        title: "Market research",
        webUrl: "https://example.com/research",
        webUrlHash: "a".repeat(64),
        webDescription: "Research context",
        webSiteName: "Example",
        webImageUrl: "https://cdn.example.com/private-preview.png",
        createdBy: seeded.user.id,
      })
      .returning({ publicId: cardResources.publicId });
    if (!resource) throw new Error("Web resource missing");
    return resource.publicId;
  }

  async function makeSourcePrivateAndCreatePublicTarget() {
    await db
      .update(boards)
      .set({ visibility: "private" })
      .where(eq(boards.id, seeded.board.id));
    const [targetBoard] = await db
      .insert(boards)
      .values({
        publicId: "boardpub0001",
        name: "Public target",
        slug: "public-target",
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        visibility: "public",
      })
      .returning();
    if (!targetBoard) throw new Error("Target board missing");
    const [targetList] = await db
      .insert(lists)
      .values({
        publicId: "listpub00001",
        name: "Public list",
        index: 0,
        boardId: targetBoard.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!targetList) throw new Error("Target list missing");
    return { targetBoard, targetList };
  }

  it("enforces card scope, in-use confirmation and concurrent deletion", async () => {
    const subtask = await createSourceSubtask();
    const resourcePublicId = await createDrive();
    expect(
      await subtaskResourceRepo.linkResource(db, {
        subtaskPublicId: subtask.publicId,
        resourcePublicId,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).toMatchObject({ status: "linked" });
    expect(
      await subtaskResourceRepo.linkResource(db, {
        subtaskPublicId: subtask.publicId,
        resourcePublicId: "missingres01",
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).toEqual({ status: "resource_invalid" });
    expect(
      await cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
        resourcePublicId,
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
        removeReferences: false,
      }),
    ).toEqual({
      status: "in_use",
      referenceCount: 1,
      visualWallReferenceCount: 0,
    });

    const results = await Promise.all([
      cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
        resourcePublicId,
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
        removeReferences: true,
      }),
      cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
        resourcePublicId,
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
        removeReferences: true,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "deleted",
      "not_found",
    ]);
    expect(
      await db
        .select()
        .from(cardSubtaskResources)
        .where(isNull(cardSubtaskResources.deletedAt)),
    ).toHaveLength(0);
  });

  it("rejects deletion when card edit permission was revoked", async () => {
    const resourcePublicId = await createDrive();
    await db.insert(workspaceMemberPermissions).values({
      workspaceMemberId: seeded.member.id,
      permission: "card:edit",
      granted: false,
    });

    await expect(
      cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
        resourcePublicId,
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
        removeReferences: true,
      }),
    ).rejects.toBeInstanceOf(WorkspacePermissionChangedError);
    await expect(
      cardResourceRepo.getByPublicId(db, resourcePublicId),
    ).resolves.not.toBeNull();
  });

  it("rejects resources from another card or workspace", async () => {
    const subtask = await createSourceSubtask();
    const sameWorkspaceResource = await cardResourceRepo.createDrive(db, {
      cardId: seeded.emptyCard.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Other card",
      driveType: "file",
      driveFileId: "OtherCardDrive123",
      resourceKey: null,
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: true,
    });
    if (sameWorkspaceResource.status !== "created") {
      throw new Error("Same-workspace resource missing");
    }
    await expect(
      subtaskResourceRepo.linkResource(db, {
        subtaskPublicId: subtask.publicId,
        resourcePublicId: sameWorkspaceResource.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "resource_invalid" });

    const [otherBoard] = await db
      .insert(boards)
      .values({
        publicId: "boardother01",
        name: "Other board",
        slug: "other-board-resource",
        workspaceId: seeded.otherWorkspace.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!otherBoard) throw new Error("Other board missing");
    const [otherList] = await db
      .insert(lists)
      .values({
        publicId: "listother001",
        name: "Other list",
        index: 0,
        boardId: otherBoard.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!otherList) throw new Error("Other list missing");
    const [otherCard] = await db
      .insert(cards)
      .values({
        publicId: "cardother001",
        title: "Other card",
        index: 0,
        listId: otherList.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!otherCard) throw new Error("Other card missing");
    const otherWorkspaceResource = await cardResourceRepo.createDrive(db, {
      cardId: otherCard.id,
      expectedWorkspaceId: seeded.otherWorkspace.id,
      title: "Other workspace",
      driveType: "file",
      driveFileId: "OtherWorkspaceDrive123",
      resourceKey: null,
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: false,
    });
    if (otherWorkspaceResource.status !== "created") {
      throw new Error("Other-workspace resource missing");
    }
    await expect(
      subtaskResourceRepo.linkResource(db, {
        subtaskPublicId: subtask.publicId,
        resourcePublicId: otherWorkspaceResource.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "resource_invalid" });
  });

  it("upgrades a deduplicated Drive link with a validated resource key", async () => {
    const first = await cardResourceRepo.createDrive(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Original title",
      driveType: "document",
      driveFileId: "StableDriveFile123",
      resourceKey: null,
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: true,
    });
    const upgraded = await cardResourceRepo.createDrive(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Updated title",
      driveType: "document",
      driveFileId: "StableDriveFile123",
      resourceKey: "New_Resource_Key",
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: true,
    });

    expect(first.status).toBe("created");
    expect(upgraded).toEqual({
      status: "existing",
      publicId: first.status === "created" ? first.publicId : "",
    });
    expect(await cardResourceRepo.listByCardId(db, seeded.card.id)).toEqual([
      expect.objectContaining({
        title: "Updated title",
        resourceKey: "New_Resource_Key",
      }),
    ]);
  });

  it("requires public acknowledgement and deduplicates the normalized web URL hash", async () => {
    const input = {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      webUrl: "https://example.com/research?source=kan",
      fallbackTitle: "example.com",
      createdBy: seeded.user.id,
    };
    await expect(
      cardResourceRepo.reserveWeb(db, {
        ...input,
        publicVisibilityAcknowledged: false,
      }),
    ).resolves.toEqual({ status: "public_ack_required" });

    const first = await cardResourceRepo.reserveWeb(db, {
      ...input,
      publicVisibilityAcknowledged: true,
    });
    if (first.status !== "created") throw new Error("Web resource missing");
    await cardResourceRepo.updateWebMetadata(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      resourcePublicId: first.publicId,
      title: "Research",
      description: "Context",
      siteName: "Example",
      imageUrl: "https://cdn.example.com/preview.png",
    });
    const duplicate = await cardResourceRepo.reserveWeb(db, {
      ...input,
      publicVisibilityAcknowledged: true,
    });

    expect(duplicate).toEqual({
      status: "existing",
      publicId: first.publicId,
    });
    expect(await cardResourceRepo.listByCardId(db, seeded.card.id)).toEqual([
      expect.objectContaining({
        kind: "web",
        title: "Research",
        webUrl: input.webUrl,
        webUrlHash: createHash("sha256").update(input.webUrl).digest("hex"),
        webDescription: "Context",
        webImageUrl: "https://cdn.example.com/preview.png",
      }),
    ]);
  });

  it("grants exactly one unfurl winner for concurrent identical reservations", async () => {
    const webUrl = "https://example.com/concurrent-research";
    let metadataFetches = 0;
    const reserveAndUnfurl = async () => {
      const reservation = await cardResourceRepo.reserveWeb(db, {
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.workspace.id,
        webUrl,
        fallbackTitle: "example.com",
        createdBy: seeded.user.id,
        publicVisibilityAcknowledged: true,
      });
      if (reservation.status === "created") {
        metadataFetches += 1;
        await cardResourceRepo.updateWebMetadata(db, {
          cardId: seeded.card.id,
          expectedWorkspaceId: seeded.workspace.id,
          resourcePublicId: reservation.publicId,
          title: "Concurrent research",
          description: "Fetched once",
          siteName: "Example",
          imageUrl: null,
        });
      }
      return reservation;
    };

    const reservations = await Promise.all(
      Array.from({ length: 8 }, () => reserveAndUnfurl()),
    );

    const created = reservations.filter(({ status }) => status === "created");
    const existing = reservations.filter(({ status }) => status === "existing");
    expect([metadataFetches, created.length, existing.length]).toEqual([
      1, 1, 7,
    ]);
    expect(await cardResourceRepo.listByCardId(db, seeded.card.id)).toEqual([
      expect.objectContaining({ webDescription: "Fetched once" }),
    ]);
  });

  it("allows exactly 100 active web resources and rejects number 101", async () => {
    const existing = Array.from({ length: 99 }, (_, index) => {
      const webUrl = `https://example.com/resource/${index}`;
      return {
        publicId: `webcap${String(index).padStart(6, "0")}`,
        cardId: seeded.card.id,
        kind: "web" as const,
        title: `Resource ${index}`,
        webUrl,
        webUrlHash: createHash("sha256").update(webUrl).digest("hex"),
        createdBy: seeded.user.id,
      };
    });
    await db.insert(cardResources).values(existing);
    const concurrent = await Promise.all(
      [99, 100].map((index) =>
        cardResourceRepo.reserveWeb(db, {
          cardId: seeded.card.id,
          expectedWorkspaceId: seeded.workspace.id,
          webUrl: `https://example.com/resource/${index}`,
          fallbackTitle: `Resource ${index}`,
          createdBy: seeded.user.id,
          publicVisibilityAcknowledged: true,
        }),
      ),
    );

    expect(concurrent.map((result) => result.status).sort()).toEqual([
      "created",
      "limit_reached",
    ]);
    await expect(
      cardResourceRepo.reserveWeb(db, {
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.workspace.id,
        webUrl: "https://example.com/new-resource",
        fallbackTitle: "example.com",
        createdBy: seeded.user.id,
        publicVisibilityAcknowledged: true,
      }),
    ).resolves.toEqual({ status: "limit_reached" });
    expect(
      (await cardResourceRepo.getSummaryByCardId(db, seeded.card.id)).webLinks,
    ).toBe(100);
  });

  it("rejects web reservation after the card leaves the authorized workspace", async () => {
    await expect(
      cardResourceRepo.reserveWeb(db, {
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.otherWorkspace.id,
        webUrl: "https://example.com/research",
        fallbackTitle: "example.com",
        createdBy: seeded.user.id,
        publicVisibilityAcknowledged: true,
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
  });

  it("reads preview context only while the whole resource hierarchy is active", async () => {
    const created = await cardResourceRepo.reserveWeb(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      webUrl: "https://example.com/research",
      fallbackTitle: "example.com",
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: true,
    });
    if (created.status !== "created") throw new Error("Web resource missing");
    await cardResourceRepo.updateWebMetadata(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      resourcePublicId: created.publicId,
      title: "Research",
      description: null,
      siteName: "Example",
      imageUrl: "https://cdn.example.com/preview.png",
    });
    await expect(
      cardResourceRepo.getWebPreviewContextByPublicId(db, created.publicId),
    ).resolves.toMatchObject({
      publicId: created.publicId,
      workspaceId: seeded.workspace.id,
      boardVisibility: "public",
      imageUrl: "https://cdn.example.com/preview.png",
    });

    await db
      .update(workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(workspaces.id, seeded.workspace.id));
    await expect(
      cardResourceRepo.getWebPreviewContextByPublicId(db, created.publicId),
    ).resolves.toBeNull();
  });

  it("requires acknowledgement before publishing a board with resources", async () => {
    await db
      .update(boards)
      .set({ visibility: "private" })
      .where(eq(boards.id, seeded.board.id));
    await createDrive();

    await expect(
      boardRepo.update(db, {
        boardPublicId: seeded.board.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        name: undefined,
        slug: undefined,
        visibility: "public",
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toBeInstanceOf(PublicVisibilityAcknowledgementError);
    expect(
      (
        await db
          .select({ visibility: boards.visibility })
          .from(boards)
          .where(eq(boards.id, seeded.board.id))
      )[0]?.visibility,
    ).toBe("private");

    await expect(
      boardRepo.update(db, {
        boardPublicId: seeded.board.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        name: undefined,
        slug: undefined,
        visibility: "public",
        publicVisibilityAcknowledged: true,
      }),
    ).resolves.toMatchObject({ publicId: seeded.board.publicId });
  });

  it("requires acknowledgement before moving one resource card into public", async () => {
    const { targetList } = await makeSourcePrivateAndCreatePublicTarget();
    await createDrive();

    await expect(
      cardRepo.reorder(db, {
        cardId: seeded.card.id,
        newListId: targetList.id,
        newIndex: 0,
        expectedWorkspaceId: seeded.workspace.id,
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toBeInstanceOf(PublicVisibilityAcknowledgementError);
    expect(
      (
        await db
          .select({ listId: cards.listId })
          .from(cards)
          .where(eq(cards.id, seeded.card.id))
      )[0]?.listId,
    ).toBe(seeded.list.id);

    await expect(
      cardRepo.reorder(db, {
        cardId: seeded.card.id,
        newListId: targetList.id,
        newIndex: 0,
        expectedWorkspaceId: seeded.workspace.id,
        publicVisibilityAcknowledged: true,
      }),
    ).resolves.toMatchObject({ publicId: seeded.card.publicId });
  });

  it("requires acknowledgement before moving resource cards in bulk", async () => {
    const { targetList } = await makeSourcePrivateAndCreatePublicTarget();
    await createDrive();

    await expect(
      cardMoveRepo.moveMany(db, {
        cardIds: [seeded.card.id],
        destinationListId: targetList.id,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toBeInstanceOf(PublicVisibilityAcknowledgementError);
    await expect(
      cardMoveRepo.moveMany(db, {
        cardIds: [seeded.card.id],
        destinationListId: targetList.id,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        publicVisibilityAcknowledged: true,
      }),
    ).resolves.toHaveLength(1);
  });

  it("requires acknowledgement before duplicating Drive into public", async () => {
    const { targetList } = await makeSourcePrivateAndCreatePublicTarget();
    await createDrive();
    const duplicateInput = {
      sourceCardPublicId: seeded.card.publicId,
      targetListPublicId: targetList.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
      copyPipeline: false,
    };

    await expect(
      cardDuplicateRepo.duplicateCard(db, {
        ...duplicateInput,
        publicVisibilityAcknowledged: false,
      }),
    ).resolves.toEqual({ status: "public_ack_required" });
    expect(
      await db.select().from(cards).where(eq(cards.listId, targetList.id)),
    ).toHaveLength(0);
    await expect(
      cardDuplicateRepo.duplicateCard(db, {
        ...duplicateInput,
        publicVisibilityAcknowledged: true,
      }),
    ).resolves.toMatchObject({ status: "duplicated" });
  });

  it("dual-reads a legacy attachment relation during the rollout window", async () => {
    const subtask = await createSourceSubtask();
    const [attachment] = await db
      .insert(cardAttachments)
      .values({
        publicId: "legacyup0001",
        cardId: seeded.card.id,
        filename: "legacy.png",
        originalFilename: "legacy.png",
        contentType: "image/png",
        size: 20,
        s3Key: `${seeded.workspace.publicId}/${seeded.card.publicId}/legacy.png`,
        createdBy: seeded.user.id,
      })
      .returning({ id: cardAttachments.id });
    if (!attachment) throw new Error("Legacy attachment missing");
    const [resource] = await db
      .select({ id: cardResources.id })
      .from(cardResources)
      .where(eq(cardResources.publicId, "legacyup0001"));
    if (!resource) throw new Error("Transitional trigger did not run");
    const [storedSubtask] = await db
      .select({ id: cardSubtasks.id })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, subtask.publicId));
    if (!storedSubtask) throw new Error("Stored subtask missing");
    await db.insert(cardSubtaskResources).values({
      publicId: "legacyrel001",
      subtaskId: storedSubtask.id,
      resourceId: null,
      attachmentId: attachment.id,
      createdBy: seeded.user.id,
    });

    await expect(
      subtaskResourceRepo.linkResource(db, {
        subtaskPublicId: subtask.publicId,
        resourcePublicId: "legacyup0001",
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "existing" });
    const pipeline = await pipelineRepo.getByCardPublicId(
      db,
      seeded.card.publicId,
    );
    expect(
      pipeline?.status === "ready"
        ? pipeline.stages.flatMap((stage) => stage.subtasks)[0]?.resources
        : [],
    ).toEqual([
      expect.objectContaining({ publicId: "legacyup0001", kind: "upload" }),
    ]);
    await expect(
      cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
        resourcePublicId: "legacyup0001",
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
        removeReferences: false,
      }),
    ).resolves.toEqual({
      status: "in_use",
      referenceCount: 1,
      visualWallReferenceCount: 0,
    });
    await expect(
      cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
        resourcePublicId: "legacyup0001",
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
        removeReferences: true,
      }),
    ).resolves.toMatchObject({ status: "deleted" });
    const [deletedResource] = await db
      .select({
        deletedAt: cardResources.deletedAt,
        deletedBy: cardResources.deletedBy,
      })
      .from(cardResources)
      .where(eq(cardResources.id, resource.id));
    expect(deletedResource?.deletedAt).toBeInstanceOf(Date);
    expect(deletedResource?.deletedBy).toBe(seeded.user.id);
    expect(
      (
        await db
          .select({ deletedAt: cardAttachments.deletedAt })
          .from(cardAttachments)
          .where(eq(cardAttachments.id, attachment.id))
      )[0]?.deletedAt,
    ).toBeInstanceOf(Date);
  });

  it("clones Drive and web links with subtask relations while omitting each upload once", async () => {
    const subtask = await createSourceSubtask();
    const drivePublicId = await createDrive();
    const webPublicId = await createWeb();
    await subtaskResourceRepo.linkResource(db, {
      subtaskPublicId: subtask.publicId,
      resourcePublicId: drivePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    await subtaskResourceRepo.linkResource(db, {
      subtaskPublicId: subtask.publicId,
      resourcePublicId: webPublicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    const [attachment] = await db
      .insert(cardAttachments)
      .values({
        publicId: "uploadres001",
        cardId: seeded.card.id,
        filename: "brief.pdf",
        originalFilename: "brief.pdf",
        contentType: "application/pdf",
        size: 100,
        s3Key: ".objects/uploadres001",
        createdBy: seeded.user.id,
      })
      .returning({ id: cardAttachments.id });
    if (!attachment) throw new Error("Upload missing");
    expect(
      await db
        .select({ publicId: cardResources.publicId })
        .from(cardResources)
        .where(eq(cardResources.attachmentId, attachment.id)),
    ).toEqual([{ publicId: "uploadres001" }]);
    await subtaskResourceRepo.linkResource(db, {
      subtaskPublicId: subtask.publicId,
      resourcePublicId: "uploadres001",
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });

    const duplicated = await cardDuplicateRepo.duplicateCard(db, {
      sourceCardPublicId: seeded.card.publicId,
      targetListPublicId: seeded.list.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
      copyPipeline: true,
      publicVisibilityAcknowledged: true,
    });
    if (duplicated.status !== "duplicated") {
      throw new Error("Duplicate unexpectedly required acknowledgement");
    }
    expect(duplicated.skippedResourceCount).toBe(1);
    const [copy] = await db
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.publicId, duplicated.publicId));
    if (!copy) throw new Error("Duplicate missing");
    const copiedResources = await cardResourceRepo.listByCardId(db, copy.id);
    expect(copiedResources).toHaveLength(2);
    expect(copiedResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "drive", title: "Launch brief" }),
        expect.objectContaining({
          kind: "web",
          title: "Market research",
          webUrl: "https://example.com/research",
          webUrlHash: "a".repeat(64),
          webDescription: "Research context",
          webSiteName: "Example",
          webImageUrl: "https://cdn.example.com/private-preview.png",
        }),
      ]),
    );
    const pipeline = await pipelineRepo.getByCardPublicId(
      db,
      duplicated.publicId,
    );
    if (!pipeline || pipeline.status !== "ready") {
      throw new Error("Cloned pipeline missing");
    }
    expect(
      pipeline.stages.flatMap((stage) => stage.subtasks)[0]?.resources,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "drive", title: "Launch brief" }),
        expect.objectContaining({ kind: "web", title: "Market research" }),
      ]),
    );
    await expect(
      cardResourceRepo.getSummaryByCardId(db, copy.id),
    ).resolves.toEqual({ total: 2, uploads: 0, driveLinks: 1, webLinks: 1 });
  });
});
