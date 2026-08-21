import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@kan/db/schema";

export type PipelineTestDbClient = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

export async function createPipelineTestDb(): Promise<PipelineTestDbClient> {
  const client = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "../../packages/db/migrations" });
  return db as unknown as PipelineTestDbClient;
}

export async function seedPipelineData(db: PipelineTestDbClient) {
  const [user] = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      name: "Pipeline User",
      email: "pipeline@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error("User missing");

  const [workspace, otherWorkspace] = await db
    .insert(schema.workspaces)
    .values([
      {
        publicId: "workspace001",
        name: "Workspace",
        slug: "pipeline-workspace",
        createdBy: user.id,
      },
      {
        publicId: "workspace002",
        name: "Other",
        slug: "pipeline-other",
        createdBy: user.id,
      },
    ])
    .returning();
  if (!workspace || !otherWorkspace) throw new Error("Workspace missing");

  const [member, otherMember] = await db
    .insert(schema.workspaceMembers)
    .values([
      {
        publicId: "memberpipe01",
        email: user.email,
        userId: user.id,
        workspaceId: workspace.id,
        createdBy: user.id,
        role: "admin",
        status: "active",
      },
      {
        publicId: "memberpipe02",
        email: user.email,
        userId: user.id,
        workspaceId: otherWorkspace.id,
        createdBy: user.id,
        role: "admin",
        status: "active",
      },
    ])
    .returning();
  if (!member || !otherMember) throw new Error("Member missing");

  const [board] = await db
    .insert(schema.boards)
    .values({
      publicId: "boardpipe001",
      name: "Pipeline Board",
      slug: "pipeline-board",
      workspaceId: workspace.id,
      createdBy: user.id,
      visibility: "public",
    })
    .returning();
  if (!board) throw new Error("Board missing");
  const [list] = await db
    .insert(schema.lists)
    .values({
      publicId: "listpipe0001",
      name: "Planned",
      index: 0,
      boardId: board.id,
      createdBy: user.id,
    })
    .returning();
  if (!list) throw new Error("List missing");
  const [card, emptyCard] = await db
    .insert(schema.cards)
    .values([
      {
        publicId: "cardpipe0001",
        title: "Pipeline card",
        index: 0,
        listId: list.id,
        createdBy: user.id,
      },
      {
        publicId: "cardpipe0002",
        title: "Empty card",
        index: 1,
        listId: list.id,
        createdBy: user.id,
      },
    ])
    .returning();
  if (!card || !emptyCard) throw new Error("Card missing");

  return {
    user,
    workspace,
    otherWorkspace,
    member,
    otherMember,
    board,
    list,
    card,
    emptyCard,
  };
}
