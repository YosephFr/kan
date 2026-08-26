import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";
import * as canvasRepo from "@kan/db/repository/workspaceCanvas.repo";
import * as canvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  workspaceCanvases,
  workspaceCanvasRevisions,
  workspaceMemberPermissions,
  workspaceMembers,
  workspaceRolePermissions,
  workspaceRoles,
  workspaces,
} from "@kan/db/schema";
import { CardCanvasSceneError } from "@kan/shared";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

const scene = (text: string) => ({
  elements: [{ id: `text-${text}`, type: "text", text }],
  appState: {},
});

describe("workspace canvas repository", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("enforces lazy creation, CAS, revisions and transactional boundaries", async () => {
    await expect(
      canvasRepo.getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).resolves.toBeNull();
    expect(await db.select().from(workspaceCanvases)).toHaveLength(0);

    const created = await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: scene("uno"),
      actorId: seeded.user.id,
    });
    expect(created).toMatchObject({ status: "saved", version: 1 });

    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: scene("dos"),
        actorId: seeded.user.id,
      }),
    ).resolves.toEqual({
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: 1,
    });
    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: scene("uno"),
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "unchanged", version: 1 });

    const saved = await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 1,
      scene: scene("dos"),
      actorId: seeded.user.id,
    });
    expect(saved).toMatchObject({ status: "saved", version: 2 });
    if (created.status === "conflict" || saved.status === "conflict") {
      throw new Error("Unexpected conflict");
    }
    await db.insert(workspaceCanvasRevisions).values({
      publicId: "revision0001",
      canvasId: saved.canvasId,
      sourceVersion: 1,
      kind: "automatic",
      scene: scene("uno"),
      hash: created.hash,
      bytes: created.bytes,
      elementCount: created.elementCount,
      createdBy: seeded.user.id,
    });
    await expect(
      canvasRepo.restore(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        revisionPublicId: "revision0001",
        expectedVersion: 2,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 3 });
    expect(
      await db
        .select({ kind: workspaceCanvasRevisions.kind })
        .from(workspaceCanvasRevisions)
        .where(eq(workspaceCanvasRevisions.kind, "preRestore")),
    ).toHaveLength(1);

    await db.insert(workspaceMemberPermissions).values({
      workspaceMemberId: seeded.member.id,
      permission: "workspace:edit",
      granted: false,
    });
    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 3,
        scene: scene("tres"),
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(WorkspacePermissionChangedError);

    await db
      .update(workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(workspaces.id, seeded.workspace.id));
    await expect(
      canvasRepo.getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
  });

  it("serializes concurrent first saves into one save and one CAS conflict", async () => {
    const results = await Promise.all([
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: scene("primero"),
        actorId: seeded.user.id,
      }),
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: scene("segundo"),
        actorId: seeded.user.id,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "conflict",
      "saved",
    ]);
    expect(results.find((result) => result.status === "conflict")).toEqual({
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: 1,
    });
    await expect(db.select().from(workspaceCanvases)).resolves.toHaveLength(1);
  });

  it("rejects external links without creating the lazy canvas", async () => {
    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: {
          elements: [
            {
              id: "external-link",
              type: "text",
              text: "Sitio",
              link: "https://example.com/private?token=secret",
            },
          ],
          appState: {},
        },
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(CardCanvasSceneError);
    await expect(db.select().from(workspaceCanvases)).resolves.toHaveLength(0);
  });

  it("revalidates vertical-track bounds when restoring a revision", async () => {
    const created = await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: scene("válida"),
      actorId: seeded.user.id,
    });
    if (created.status === "conflict") throw new Error("Unexpected conflict");
    await db.insert(workspaceCanvasRevisions).values({
      publicId: "badbounds001",
      canvasId: created.canvasId,
      sourceVersion: 1,
      kind: "automatic",
      scene: {
        elements: [
          {
            id: "outside-track",
            type: "rectangle",
            x: -1,
            y: 0,
            width: 10,
            height: 10,
          },
        ],
        appState: {},
      },
      hash: "9".repeat(64),
      bytes: 100,
      elementCount: 1,
      createdBy: seeded.user.id,
    });
    await expect(
      canvasRepo.restore(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        revisionPublicId: "badbounds001",
        expectedVersion: 1,
        actorId: seeded.user.id,
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CANVAS_OUT_OF_BOUNDS" });
    await expect(
      canvasRepo.getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ version: 1, elementCount: 1 });
  });

  it("revalidates view permission inside canvas and image-list reads", async () => {
    await db.insert(workspaceMemberPermissions).values({
      workspaceMemberId: seeded.member.id,
      permission: "workspace:view",
      granted: false,
    });
    await expect(
      canvasRepo.getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(WorkspacePermissionChangedError);
    await expect(
      canvasImageRepo.listByWorkspacePublicId(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        userId: seeded.user.id,
        imagePublicIds: [],
      }),
    ).rejects.toBeInstanceOf(WorkspacePermissionChangedError);
  });

  it("rejects a custom role that belongs to another workspace", async () => {
    const [foreignRole] = await db
      .insert(workspaceRoles)
      .values({
        publicId: "foreignrole1",
        workspaceId: seeded.otherWorkspace.id,
        name: "Foreign editor",
        hierarchyLevel: 50,
      })
      .returning();
    if (!foreignRole) throw new Error("Role missing");
    await db.insert(workspaceRolePermissions).values({
      workspaceRoleId: foreignRole.id,
      permission: "workspace:edit",
      granted: true,
    });
    await db
      .update(workspaceMembers)
      .set({ roleId: foreignRole.id })
      .where(eq(workspaceMembers.id, seeded.member.id));

    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "forbidden" });
  });
});
