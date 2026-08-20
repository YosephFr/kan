import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@kan/db/schema";

export type TestDbClient = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

const requireValue = <T>(value: T | null | undefined, name: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${name} to be created`);
  }

  return value;
};

/**
 * Creates a fresh in-memory PGlite database for testing.
 * Each call returns an isolated database instance with migrations applied.
 */
export async function createTestDb(): Promise<TestDbClient> {
  const client = new PGlite({
    extensions: { uuid_ossp, pg_trgm },
  });

  const db = drizzle(client, { schema });

  // Run migrations
  await migrate(db, { migrationsFolder: "../../packages/db/migrations" });

  return db as unknown as TestDbClient;
}

/**
 * Seeds a test database with a workspace and user for testing.
 * Returns the created entities for use in tests.
 */
export async function seedTestData(db: TestDbClient) {
  // Create a test user
  const [userResult] = await db
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
  const user = requireValue(userResult, "test user");

  // Create a test workspace (publicId must be exactly 12 chars)
  const [workspaceResult] = await db
    .insert(schema.workspaces)
    .values({
      publicId: "wstest123456",
      name: "Test Workspace",
      slug: "test-workspace",
      createdBy: user.id,
      createdAt: new Date(),
    })
    .returning();
  const workspace = requireValue(workspaceResult, "test workspace");

  // Add user as admin member of workspace
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
