import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { NormalizedCardCanvasScene } from "@kan/shared";

import { cardSubtasks } from "./card-pipeline";
import { cardResources } from "./card-resources";
import { cards } from "./cards";
import { users } from "./users";

export const cardCanvasRevisionKinds = ["automatic", "preRestore"] as const;
export type CardCanvasRevisionKind = (typeof cardCanvasRevisionKinds)[number];
export const cardCanvasRevisionKindEnum = pgEnum(
  "card_canvas_revision_kind",
  cardCanvasRevisionKinds,
);

export const cardCanvases = pgTable(
  "card_canvas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .unique()
      .references(() => cards.id, { onDelete: "cascade" }),
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
    check("card_canvas_version_check", sql`${table.version} >= 1`),
    check(
      "card_canvas_bytes_check",
      sql`${table.bytes} >= 0 and ${table.bytes} <= 5242880`,
    ),
    check(
      "card_canvas_element_count_check",
      sql`${table.elementCount} >= 0 and ${table.elementCount} <= 5000`,
    ),
  ],
).enableRLS();

export const cardCanvasRevisions = pgTable(
  "card_canvas_revision",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    canvasId: bigint("canvasId", { mode: "number" })
      .notNull()
      .references(() => cardCanvases.id, { onDelete: "cascade" }),
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
      "card_canvas_revision_version_check",
      sql`${table.sourceVersion} >= 1`,
    ),
    check(
      "card_canvas_revision_bytes_check",
      sql`${table.bytes} >= 0 and ${table.bytes} <= 5242880`,
    ),
    check(
      "card_canvas_revision_element_count_check",
      sql`${table.elementCount} >= 0 and ${table.elementCount} <= 5000`,
    ),
    index("card_canvas_revision_canvas_created_idx").on(
      table.canvasId,
      table.createdAt,
    ),
  ],
).enableRLS();

export const cardCanvasFrames = pgTable(
  "card_canvas_frame",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    canvasId: bigint("canvasId", { mode: "number" })
      .notNull()
      .references(() => cardCanvases.id, { onDelete: "cascade" }),
    elementId: varchar("elementId", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    present: boolean("present").default(true).notNull(),
    subtaskId: bigint("subtaskId", { mode: "number" })
      .unique()
      .references(() => cardSubtasks.id, { onDelete: "set null" }),
    createdBy: uuid("createdBy").references(() => users.id, {
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
    unique("card_canvas_frame_canvas_element_unique").on(
      table.canvasId,
      table.elementId,
    ),
    index("card_canvas_frame_canvas_present_idx").on(
      table.canvasId,
      table.present,
    ),
  ],
).enableRLS();

export const cardCanvasResources = pgTable(
  "card_canvas_resource",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    canvasId: bigint("canvasId", { mode: "number" })
      .notNull()
      .references(() => cardCanvases.id, { onDelete: "cascade" }),
    elementId: varchar("elementId", { length: 255 }).notNull(),
    resourceId: bigint("resourceId", { mode: "number" })
      .notNull()
      .references(() => cardResources.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("card_canvas_resource_canvas_element_unique").on(
      table.canvasId,
      table.elementId,
    ),
    index("card_canvas_resource_resource_idx").on(table.resourceId),
  ],
).enableRLS();

export const cardCanvasesRelations = relations(
  cardCanvases,
  ({ one, many }) => ({
    card: one(cards, {
      fields: [cardCanvases.cardId],
      references: [cards.id],
      relationName: "cardCanvasCard",
    }),
    revisions: many(cardCanvasRevisions),
    frames: many(cardCanvasFrames),
    resources: many(cardCanvasResources),
  }),
);

export const cardCanvasRevisionsRelations = relations(
  cardCanvasRevisions,
  ({ one }) => ({
    canvas: one(cardCanvases, {
      fields: [cardCanvasRevisions.canvasId],
      references: [cardCanvases.id],
      relationName: "cardCanvasRevisionsCanvas",
    }),
  }),
);

export const cardCanvasFramesRelations = relations(
  cardCanvasFrames,
  ({ one }) => ({
    canvas: one(cardCanvases, {
      fields: [cardCanvasFrames.canvasId],
      references: [cardCanvases.id],
      relationName: "cardCanvasFramesCanvas",
    }),
    subtask: one(cardSubtasks, {
      fields: [cardCanvasFrames.subtaskId],
      references: [cardSubtasks.id],
      relationName: "cardCanvasFramesSubtask",
    }),
  }),
);

export const cardCanvasResourcesRelations = relations(
  cardCanvasResources,
  ({ one }) => ({
    canvas: one(cardCanvases, {
      fields: [cardCanvasResources.canvasId],
      references: [cardCanvases.id],
      relationName: "cardCanvasResourcesCanvas",
    }),
    resource: one(cardResources, {
      fields: [cardCanvasResources.resourceId],
      references: [cardResources.id],
      relationName: "cardCanvasResourcesResource",
    }),
  }),
);
