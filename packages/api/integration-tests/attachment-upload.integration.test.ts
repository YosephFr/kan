import { readFile } from "node:fs/promises";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as cardAttachmentRepo from "@kan/db/repository/cardAttachment.repo";
import {
  boards,
  cardActivities,
  cardAttachments,
  cardAttachmentUploadSessions,
  cardResources,
  cards,
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb } from "./test-db";

const ownerId = "70c36a50-c047-4540-aa6d-c81d6ff2455d";

const requireValue = <T>(value: T | null | undefined, name: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${name} to be created`);
  }
  return value;
};

async function seedAttachmentFixture(db: TestDbClient) {
  await db.insert(users).values({
    id: ownerId,
    name: "Owner",
    email: "attachment-owner@example.com",
    emailVerified: true,
  });
  const [workspaceResult, targetWorkspaceResult] = await db
    .insert(workspaces)
    .values([
      {
        publicId: "attachws0001",
        name: "Attachment workspace",
        slug: "attachment-workspace",
        createdBy: ownerId,
      },
      {
        publicId: "attachws0002",
        name: "Target workspace",
        slug: "attachment-target",
        createdBy: ownerId,
      },
    ])
    .returning();
  const workspace = requireValue(workspaceResult, "workspace");
  const targetWorkspace = requireValue(
    targetWorkspaceResult,
    "target workspace",
  );
  await db.insert(workspaceMembers).values({
    publicId: "attachmem001",
    email: "attachment-owner@example.com",
    userId: ownerId,
    workspaceId: workspace.id,
    createdBy: ownerId,
    role: "admin",
    status: "active",
  });
  const [boardResult] = await db
    .insert(boards)
    .values({
      publicId: "attachboard1",
      name: "Attachments",
      slug: "attachments",
      workspaceId: workspace.id,
      createdBy: ownerId,
    })
    .returning();
  const board = requireValue(boardResult, "board");
  const [listResult, otherListResult] = await db
    .insert(lists)
    .values([
      {
        publicId: "attachlist01",
        name: "Files",
        index: 0,
        boardId: board.id,
        createdBy: ownerId,
      },
      {
        publicId: "attachlist02",
        name: "Other files",
        index: 1,
        boardId: board.id,
        createdBy: ownerId,
      },
    ])
    .returning();
  const list = requireValue(listResult, "list");
  const otherList = requireValue(otherListResult, "other list");
  const [cardResult, otherCardResult] = await db
    .insert(cards)
    .values([
      {
        publicId: "attachcard01",
        title: "Files",
        index: 0,
        listId: list.id,
        createdBy: ownerId,
      },
      {
        publicId: "attachcard02",
        title: "Other files",
        index: 1,
        listId: list.id,
        createdBy: ownerId,
      },
    ])
    .returning();
  return {
    board,
    card: requireValue(cardResult, "card"),
    list,
    otherCard: requireValue(otherCardResult, "other card"),
    otherList,
    targetWorkspace,
    workspace,
  };
}

function sessionInput(
  fixture: Awaited<ReturnType<typeof seedAttachmentFixture>>,
  publicId: string,
) {
  return {
    publicId,
    cardId: fixture.card.id,
    workspaceId: fixture.workspace.id,
    userId: ownerId,
    s3Key: `.uploads/${publicId}/file.pdf`,
    filename: "file.pdf",
    originalFilename: "file.pdf",
    contentType: "application/pdf",
    size: 5,
    sha256: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    publicVisibilityAcknowledged: false,
  };
}

describe("attachment upload session repository", () => {
  let db: TestDbClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("claims a session once before creating exactly one attachment", async () => {
    const fixture = await seedAttachmentFixture(db);
    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploadonce01"),
    );

    const claim = await cardAttachmentRepo.claimUploadSessionForConfirmation(
      db,
      {
        publicId: "uploadonce01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        claimExpiresAt: new Date(Date.now() + 60_000),
      },
    );
    const duplicateClaim =
      await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
        publicId: "uploadonce01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken02",
        claimExpiresAt: new Date(Date.now() + 60_000),
      });

    expect(claim.status).toBe("claimed");
    expect(duplicateClaim.status).toBe("unavailable");
    const consumed =
      await cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploadonce01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey001",
        publicVisibilityAcknowledged: false,
      });
    expect(consumed.status).toBe("created");
    await expect(
      cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploadonce01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey002",
        publicVisibilityAcknowledged: false,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });

    const persisted = await db
      .select({ publicId: cardAttachments.publicId })
      .from(cardAttachments)
      .where(eq(cardAttachments.cardId, fixture.card.id));
    expect(persisted).toHaveLength(1);
  });

  it("returns the existing upload only for an exact session, card, and user retry", async () => {
    const fixture = await seedAttachmentFixture(db);
    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploadidem01"),
    );
    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploadidem01",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken01",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    const created =
      await cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploadidem01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey001",
        publicVisibilityAcknowledged: false,
      });
    if (created.status !== "created") throw new Error("Upload was not created");

    const replay = await cardAttachmentRepo.claimUploadSessionForConfirmation(
      db,
      {
        publicId: "uploadidem01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken02",
        claimExpiresAt: new Date(Date.now() + 60_000),
      },
    );
    expect(replay).toEqual({
      status: "already_created",
      attachment: {
        publicId: created.attachment.publicId,
        filename: created.attachment.filename,
        originalFilename: created.attachment.originalFilename,
        contentType: created.attachment.contentType,
        size: created.attachment.size,
        createdAt: created.attachment.createdAt,
      },
    });
    await expect(
      cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
        publicId: "uploadidem01",
        cardId: fixture.otherCard.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken03",
        claimExpiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
        publicId: "uploadidem01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: "5b78bf04-ad4e-44fe-88f7-50634350dfeb",
        claimToken: "claimtoken04",
        claimExpiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ status: "unavailable" });

    const persistedAttachments = await db
      .select({ publicId: cardAttachments.publicId })
      .from(cardAttachments)
      .where(eq(cardAttachments.uploadSessionId, created.attachment.id));
    const persistedResources = await db
      .select({ publicId: cardResources.publicId })
      .from(cardResources)
      .where(eq(cardResources.publicId, created.attachment.publicId));
    const persistedActivities = await db
      .select({ publicId: cardActivities.publicId })
      .from(cardActivities)
      .where(
        and(
          eq(cardActivities.cardId, fixture.card.id),
          eq(cardActivities.type, "card.updated.attachment.added"),
        ),
      );
    const persistedSessions = await db
      .select({ publicId: cardAttachmentUploadSessions.publicId })
      .from(cardAttachmentUploadSessions)
      .where(eq(cardAttachmentUploadSessions.publicId, "uploadidem01"));

    expect(persistedAttachments).toHaveLength(1);
    expect(persistedResources).toHaveLength(1);
    expect(persistedActivities).toHaveLength(1);
    expect(persistedSessions).toHaveLength(1);
  });

  it("rechecks visibility at confirmation and creates the upload resource once", async () => {
    const fixture = await seedAttachmentFixture(db);
    await expect(
      cardAttachmentRepo.createUploadSession(
        db,
        sessionInput(fixture, "uploadack001"),
      ),
    ).resolves.toMatchObject({ status: "created" });
    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploadack001",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken01",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .update(boards)
      .set({ visibility: "public" })
      .where(eq(boards.id, fixture.board.id));

    await expect(
      cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploadack001",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey001",
        publicVisibilityAcknowledged: false,
      }),
    ).resolves.toEqual({ status: "public_ack_required" });

    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploadack001",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken02",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    const created =
      await cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploadack001",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken02",
        finalS3Key: ".objects/objectkey001",
        publicVisibilityAcknowledged: true,
      });
    if (created.status !== "created") throw new Error("Upload was not created");
    expect(
      await db
        .select({ publicId: cardResources.publicId })
        .from(cardResources)
        .where(eq(cardResources.publicId, created.attachment.publicId)),
    ).toEqual([{ publicId: created.attachment.publicId }]);
  });

  it("rechecks the board workspace immediately before persistence", async () => {
    const fixture = await seedAttachmentFixture(db);
    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploadguard1"),
    );
    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploadguard1",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken01",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .update(boards)
      .set({ workspaceId: fixture.targetWorkspace.id })
      .where(eq(boards.id, fixture.board.id));

    await expect(
      cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploadguard1",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey001",
        publicVisibilityAcknowledged: false,
      }),
    ).resolves.toMatchObject({ status: "workspace_mismatch" });
    const [persisted] = await db
      .select({ count: sql<number>`count(*)` })
      .from(cardAttachments);
    expect(Number(persisted?.count ?? 0)).toBe(0);
  });

  it("locks the card's current list after a legitimate same-workspace move", async () => {
    const fixture = await seedAttachmentFixture(db);
    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploadmove01"),
    );
    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploadmove01",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken01",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .update(cards)
      .set({ listId: fixture.otherList.id })
      .where(eq(cards.id, fixture.card.id));

    await expect(
      cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploadmove01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey001",
        publicVisibilityAcknowledged: false,
      }),
    ).resolves.toMatchObject({ status: "created" });
  });

  it("limits abandoned pending sessions per card", async () => {
    const fixture = await seedAttachmentFixture(db);
    for (let index = 0; index < 5; index += 1) {
      await expect(
        cardAttachmentRepo.createUploadSession(
          db,
          sessionInput(fixture, `uploadlim0${index}`),
        ),
      ).resolves.toMatchObject({ status: "created" });
    }
    await expect(
      cardAttachmentRepo.createUploadSession(
        db,
        sessionInput(fixture, "uploadlim05"),
      ),
    ).resolves.toMatchObject({ status: "card_limit" });
  });

  it("keeps previous-workspace sessions in the sender quota without blocking the current card", async () => {
    const fixture = await seedAttachmentFixture(db);
    for (let index = 0; index < 5; index += 1) {
      await cardAttachmentRepo.createUploadSession(
        db,
        sessionInput(fixture, `uploadold0${index}`),
      );
      await cardAttachmentRepo.createUploadSession(db, {
        ...sessionInput(fixture, `uploadoth0${index}`),
        cardId: fixture.otherCard.id,
      });
    }
    const newOwnerId = "b061ec60-c5af-41a6-a917-71d9ef02cf7b";
    await db.insert(users).values({
      id: newOwnerId,
      name: "New owner",
      email: "new-attachment-owner@example.com",
      emailVerified: true,
    });
    await db
      .update(boards)
      .set({ workspaceId: fixture.targetWorkspace.id })
      .where(eq(boards.id, fixture.board.id));

    await expect(
      cardAttachmentRepo.createUploadSession(db, {
        ...sessionInput(fixture, "uploadnew001"),
        workspaceId: fixture.targetWorkspace.id,
        userId: newOwnerId,
      }),
    ).resolves.toMatchObject({ status: "created" });

    await expect(
      cardAttachmentRepo.createUploadSession(db, {
        ...sessionInput(fixture, "uploadowner1"),
        workspaceId: fixture.targetWorkspace.id,
      }),
    ).resolves.toMatchObject({ status: "user_limit" });

    const pending = await db
      .select({
        publicId: cardAttachmentUploadSessions.publicId,
        userId: cardAttachmentUploadSessions.userId,
      })
      .from(cardAttachmentUploadSessions)
      .where(isNull(cardAttachmentUploadSessions.consumedAt));
    expect(
      pending.filter((session) => session.userId === ownerId),
    ).toHaveLength(10);
    expect(pending).toContainEqual({
      publicId: "uploadnew001",
      userId: newOwnerId,
    });
  });

  it("deletes only an owned, unissued session after presigning fails", async () => {
    const fixture = await seedAttachmentFixture(db);
    const otherUserId = "ec6528cc-8093-4114-9731-d05d6ebf77cc";
    await db.insert(users).values({
      id: otherUserId,
      name: "Other user",
      email: "other-attachment-user@example.com",
      emailVerified: true,
    });
    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploaduniss1"),
    );

    await expect(
      cardAttachmentRepo.deleteUnissuedUploadSession(db, {
        publicId: "uploaduniss1",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: otherUserId,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    await expect(
      cardAttachmentRepo.deleteUnissuedUploadSession(db, {
        publicId: "uploaduniss1",
        cardId: fixture.otherCard.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    await expect(
      cardAttachmentRepo.deleteUnissuedUploadSession(db, {
        publicId: "uploaduniss1",
        cardId: fixture.card.id,
        workspaceId: fixture.targetWorkspace.id,
        userId: ownerId,
      }),
    ).resolves.toMatchObject({ status: "workspace_mismatch" });

    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploaduniss1",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken01",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      cardAttachmentRepo.deleteUnissuedUploadSession(db, {
        publicId: "uploaduniss1",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    await cardAttachmentRepo.releaseUploadSessionClaim(db, {
      publicId: "uploaduniss1",
      claimToken: "claimtoken01",
    });
    await expect(
      cardAttachmentRepo.deleteUnissuedUploadSession(db, {
        publicId: "uploaduniss1",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
      }),
    ).resolves.toMatchObject({
      status: "deleted",
      session: { publicId: "uploaduniss1" },
    });

    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploadused01"),
    );
    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploadused01",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken02",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
      sessionPublicId: "uploadused01",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken02",
      finalS3Key: ".objects/objectkey009",
      publicVisibilityAcknowledged: false,
    });
    await expect(
      cardAttachmentRepo.deleteUnissuedUploadSession(db, {
        publicId: "uploadused01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("denies delete when a legacy record points at another card's key", async () => {
    const fixture = await seedAttachmentFixture(db);
    await db.insert(cardAttachments).values({
      publicId: "badlegacy001",
      cardId: fixture.card.id,
      filename: "file.pdf",
      originalFilename: "file.pdf",
      contentType: "application/pdf",
      size: 5,
      s3Key: `${fixture.workspace.publicId}/${fixture.otherCard.publicId}/file.pdf`,
      createdBy: ownerId,
    });

    await expect(
      cardAttachmentRepo.softDeleteWithWorkspaceGuard(db, {
        attachmentPublicId: "badlegacy001",
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        deletedAt: new Date(),
      }),
    ).resolves.toMatchObject({ status: "invalid_storage" });
    const [record] = await db
      .select({ deletedAt: cardAttachments.deletedAt })
      .from(cardAttachments)
      .where(eq(cardAttachments.publicId, "badlegacy001"));
    expect(record?.deletedAt).toBeNull();
  });

  it("soft-deletes a valid legacy record with one removal activity", async () => {
    const fixture = await seedAttachmentFixture(db);
    await db.insert(cardAttachments).values({
      publicId: "goodlegacy01",
      cardId: fixture.card.id,
      filename: "file.pdf",
      originalFilename: "file.pdf",
      contentType: "application/pdf",
      size: 5,
      s3Key: `former-workspace/${fixture.card.publicId}/file.pdf`,
      createdBy: ownerId,
    });

    await expect(
      cardAttachmentRepo.softDeleteWithWorkspaceGuard(db, {
        attachmentPublicId: "goodlegacy01",
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        deletedAt: new Date(),
      }),
    ).resolves.toMatchObject({ status: "deleted" });
    const activities = await db
      .select({ type: cardActivities.type })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, fixture.card.id));
    expect(activities).toEqual([{ type: "card.updated.attachment.removed" }]);
  });

  it("quarantines cross-card legacy keys while preserving moved-workspace keys", async () => {
    const fixture = await seedAttachmentFixture(db);
    await db.insert(cardAttachments).values([
      {
        publicId: "legacynum001",
        cardId: fixture.card.id,
        filename: "numeric.pdf",
        originalFilename: "numeric.pdf",
        contentType: "application/pdf",
        size: 5,
        s3Key: `${fixture.workspace.id}/${fixture.card.publicId}/numeric.pdf`,
        createdBy: ownerId,
      },
      {
        publicId: "legacypub001",
        cardId: fixture.card.id,
        filename: "public.pdf",
        originalFilename: "public.pdf",
        contentType: "application/pdf",
        size: 5,
        s3Key: `${fixture.workspace.publicId}/${fixture.card.publicId}/public.pdf`,
        createdBy: ownerId,
      },
      {
        publicId: "legacymov001",
        cardId: fixture.card.id,
        filename: "moved.pdf",
        originalFilename: "moved.pdf",
        contentType: "application/pdf",
        size: 5,
        s3Key: `former-workspace/${fixture.card.publicId}/moved.pdf`,
        createdBy: ownerId,
      },
      {
        publicId: "legacybad001",
        cardId: fixture.card.id,
        filename: "bad.pdf",
        originalFilename: "bad.pdf",
        contentType: "application/pdf",
        size: 5,
        s3Key: `${fixture.workspace.publicId}/${fixture.otherCard.publicId}/bad.pdf`,
        createdBy: ownerId,
      },
    ]);

    const migration = await readFile(
      new URL(
        "../../db/migrations/20260821131033_ClaimAndQuarantineAttachmentUploads.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const quarantineStatement = migration
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes('UPDATE "card_attachment"'));
    if (!quarantineStatement)
      throw new Error("Quarantine migration is missing");
    await db.execute(sql.raw(quarantineStatement));

    const records = await db
      .select({
        publicId: cardAttachments.publicId,
        deletedAt: cardAttachments.deletedAt,
        quarantinedAt: cardAttachments.storageQuarantinedAt,
      })
      .from(cardAttachments)
      .where(
        and(
          inArray(cardAttachments.publicId, [
            "legacynum001",
            "legacypub001",
            "legacymov001",
            "legacybad001",
          ]),
          isNull(cardAttachments.uploadSessionId),
        ),
      );
    const byId = new Map(records.map((record) => [record.publicId, record]));

    expect(byId.get("legacynum001")?.deletedAt).toBeNull();
    expect(byId.get("legacypub001")?.deletedAt).toBeNull();
    expect(byId.get("legacymov001")?.deletedAt).toBeNull();
    expect(byId.get("legacybad001")?.deletedAt).toBeInstanceOf(Date);
    expect(byId.get("legacybad001")?.quarantinedAt).toBeInstanceOf(Date);
  });

  it("does not leave unconsumed sessions attached to confirmed records", async () => {
    const fixture = await seedAttachmentFixture(db);
    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploadstate1"),
    );
    const [pending] = await db
      .select({ consumedAt: cardAttachmentUploadSessions.consumedAt })
      .from(cardAttachmentUploadSessions)
      .where(eq(cardAttachmentUploadSessions.publicId, "uploadstate1"));
    expect(pending?.consumedAt).toBeNull();
  });

  it("keeps a confirmed attachment verifiable after its uploader is deleted", async () => {
    const fixture = await seedAttachmentFixture(db);
    await cardAttachmentRepo.createUploadSession(
      db,
      sessionInput(fixture, "uploaduser01"),
    );
    await cardAttachmentRepo.claimUploadSessionForConfirmation(db, {
      publicId: "uploaduser01",
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      userId: ownerId,
      claimToken: "claimtoken01",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    const created =
      await cardAttachmentRepo.consumeClaimedUploadSessionAndCreate(db, {
        sessionPublicId: "uploaduser01",
        cardId: fixture.card.id,
        workspaceId: fixture.workspace.id,
        userId: ownerId,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey001",
        publicVisibilityAcknowledged: false,
      });
    if (created.status !== "created")
      throw new Error("Attachment was not created");

    await db.delete(users).where(eq(users.id, ownerId));
    const stored = await cardAttachmentRepo.getByPublicId(
      db,
      created.attachment.publicId,
    );

    expect(stored?.uploadSession?.consumedAt).toBeInstanceOf(Date);
    expect(
      stored && cardAttachmentRepo.hasValidAttachmentStorageOwnership(stored),
    ).toBe(true);
  });
});
