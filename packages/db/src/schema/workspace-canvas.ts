import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { NormalizedCardCanvasScene } from "@kan/shared";

import { cardCanvasRevisionKindEnum } from "./card-canvas";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const workspaceCanvases = pgTable(
  "workspace_canvas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scene: jsonb("scene").$type<NormalizedCardCanvasScene>().notNull(),
    version: integer("version").notNull(),
    hash: varchar("hash", { length: 64 }).notNull(),
    bytes: integer("bytes").notNull(),
    elementCount: integer("elementCount").notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("workspace_canvas_version_check", sql`${table.version} >= 1`),
    check(
      "workspace_canvas_bytes_check",
      sql`${table.bytes} >= 0 and ${table.bytes} <= 5242880`,
    ),
    check(
      "workspace_canvas_element_count_check",
      sql`${table.elementCount} >= 0 and ${table.elementCount} <= 5000`,
    ),
  ],
).enableRLS();

export const workspaceCanvasRevisions = pgTable(
  "workspace_canvas_revision",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    canvasId: bigint("canvasId", { mode: "number" })
      .notNull()
      .references(() => workspaceCanvases.id, { onDelete: "cascade" }),
    sourceVersion: integer("sourceVersion").notNull(),
    kind: cardCanvasRevisionKindEnum("kind").notNull(),
    scene: jsonb("scene").$type<NormalizedCardCanvasScene>().notNull(),
    hash: varchar("hash", { length: 64 }).notNull(),
    bytes: integer("bytes").notNull(),
    elementCount: integer("elementCount").notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "workspace_canvas_revision_version_check",
      sql`${table.sourceVersion} >= 1`,
    ),
    check(
      "workspace_canvas_revision_bytes_check",
      sql`${table.bytes} >= 0 and ${table.bytes} <= 5242880`,
    ),
    check(
      "workspace_canvas_revision_element_count_check",
      sql`${table.elementCount} >= 0 and ${table.elementCount} <= 5000`,
    ),
    index("workspace_canvas_revision_canvas_created_idx").on(
      table.canvasId,
      table.createdAt,
    ),
  ],
).enableRLS();

export const workspaceCanvasesRelations = relations(
  workspaceCanvases,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [workspaceCanvases.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceCanvasWorkspace",
    }),
    revisions: many(workspaceCanvasRevisions),
  }),
);

export const workspaceCanvasRevisionsRelations = relations(
  workspaceCanvasRevisions,
  ({ one }) => ({
    canvas: one(workspaceCanvases, {
      fields: [workspaceCanvasRevisions.canvasId],
      references: [workspaceCanvases.id],
      relationName: "workspaceCanvasRevisionsCanvas",
    }),
  }),
);
