import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cardResources } from "./card-resources";
import { cards } from "./cards";
import { users } from "./users";
import { workspaceCanvasImages } from "./workspace-canvas-images";
import { workspaces } from "./workspaces";

const visualWallColumns = () => ({
  version: integer("version").notNull(),
  freeformUrl: varchar("freeformUrl", { length: 2048 }),
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
});

const visualWallItemColumns = () => ({
  publicId: varchar("publicId", { length: 12 }).notNull().unique(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  zIndex: integer("zIndex").notNull(),
  legacyElementId: varchar("legacyElementId", { length: 255 }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  deletedAt: timestamp("deletedAt", { withTimezone: true }),
});

export const workspaceVisualWalls = pgTable(
  "workspace_visual_wall",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ...visualWallColumns(),
  },
  (table) => [
    check("workspace_visual_wall_version_check", sql`${table.version} >= 1`),
  ],
).enableRLS();

export const workspaceVisualWallItems = pgTable(
  "workspace_visual_wall_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    wallId: bigint("wallId", { mode: "number" })
      .notNull()
      .references(() => workspaceVisualWalls.id, { onDelete: "cascade" }),
    imageId: bigint("imageId", { mode: "number" })
      .notNull()
      .references(() => workspaceCanvasImages.id, { onDelete: "restrict" }),
    ...visualWallItemColumns(),
  },
  (table) => [
    check(
      "workspace_visual_wall_item_x_check",
      sql`${table.x} >= 0 and ${table.x} <= 1156`,
    ),
    check(
      "workspace_visual_wall_item_y_check",
      sql`${table.y} >= 0 and ${table.y} <= 999956`,
    ),
    check(
      "workspace_visual_wall_item_width_check",
      sql`${table.width} >= 44 and ${table.width} <= 1200 and ${table.x} + ${table.width} <= 1200`,
    ),
    check(
      "workspace_visual_wall_item_height_check",
      sql`${table.height} >= 44 and ${table.height} <= 1000000 and ${table.y} + ${table.height} <= 1000000`,
    ),
    check(
      "workspace_visual_wall_item_z_index_check",
      sql`${table.zIndex} >= 0 and ${table.zIndex} <= 2147483647`,
    ),
    unique("workspace_visual_wall_item_legacy_unique").on(
      table.wallId,
      table.legacyElementId,
    ),
    index("workspace_visual_wall_item_wall_z_idx").on(
      table.wallId,
      table.zIndex,
      table.id,
    ).where(sql`${table.deletedAt} is null`),
    index("workspace_visual_wall_item_image_idx")
      .on(table.imageId)
      .where(sql`${table.deletedAt} is null`),
  ],
).enableRLS();

export const cardVisualWalls = pgTable(
  "card_visual_wall",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .unique()
      .references(() => cards.id, { onDelete: "cascade" }),
    ...visualWallColumns(),
  },
  (table) => [
    check("card_visual_wall_version_check", sql`${table.version} >= 1`),
  ],
).enableRLS();

export const cardVisualWallItems = pgTable(
  "card_visual_wall_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    wallId: bigint("wallId", { mode: "number" })
      .notNull()
      .references(() => cardVisualWalls.id, { onDelete: "cascade" }),
    resourceId: bigint("resourceId", { mode: "number" })
      .notNull()
      .references(() => cardResources.id, { onDelete: "cascade" }),
    ...visualWallItemColumns(),
  },
  (table) => [
    check(
      "card_visual_wall_item_x_check",
      sql`${table.x} >= 0 and ${table.x} <= 1156`,
    ),
    check(
      "card_visual_wall_item_y_check",
      sql`${table.y} >= 0 and ${table.y} <= 999956`,
    ),
    check(
      "card_visual_wall_item_width_check",
      sql`${table.width} >= 44 and ${table.width} <= 1200 and ${table.x} + ${table.width} <= 1200`,
    ),
    check(
      "card_visual_wall_item_height_check",
      sql`${table.height} >= 44 and ${table.height} <= 1000000 and ${table.y} + ${table.height} <= 1000000`,
    ),
    check(
      "card_visual_wall_item_z_index_check",
      sql`${table.zIndex} >= 0 and ${table.zIndex} <= 2147483647`,
    ),
    unique("card_visual_wall_item_legacy_unique").on(
      table.wallId,
      table.legacyElementId,
    ),
    index("card_visual_wall_item_wall_z_idx").on(
      table.wallId,
      table.zIndex,
      table.id,
    ).where(sql`${table.deletedAt} is null`),
    index("card_visual_wall_item_resource_idx")
      .on(table.resourceId)
      .where(sql`${table.deletedAt} is null`),
  ],
).enableRLS();

export const cardVisualWallPreviews = pgTable(
  "card_visual_wall_preview",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    resourceId: bigint("resourceId", { mode: "number" })
      .notNull()
      .unique()
      .references(() => cardResources.id, { onDelete: "cascade" }),
    s3Key: varchar("s3Key", { length: 500 }).notNull().unique(),
    contentType: varchar("contentType", { length: 100 })
      .notNull()
      .default("image/webp"),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    storageDeletedAt: timestamp("storageDeletedAt", { withTimezone: true }),
  },
  (table) => [
    check(
      "card_visual_wall_preview_type_check",
      sql`${table.contentType} = 'image/webp'`,
    ),
    check(
      "card_visual_wall_preview_size_check",
      sql`${table.size} > 0 and ${table.size} <= 768000`,
    ),
    check(
      "card_visual_wall_preview_dimensions_check",
      sql`${table.width} between 1 and 1280 and ${table.height} between 1 and 1280`,
    ),
    check(
      "card_visual_wall_preview_sha_check",
      sql`${table.sha256} ~ '^[a-f0-9]{64}$'`,
    ),
    index("card_visual_wall_preview_gc_idx").on(
      table.storageDeletedAt,
      table.deletedAt,
    ),
  ],
).enableRLS();

export const cardVisualWallPreviewStorageDeletions = pgTable(
  "card_visual_wall_preview_storage_deletion",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    s3Key: varchar("s3Key", { length: 500 }).notNull().unique(),
    size: bigint("size", { mode: "number" }),
    attempts: integer("attempts").default(0).notNull(),
    lastAttemptAt: timestamp("lastAttemptAt", { withTimezone: true }),
    availableAt: timestamp("availableAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "card_visual_wall_preview_storage_deletion_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "card_visual_wall_preview_storage_deletion_size_check",
      sql`${table.size} is null or ${table.size} > 0`,
    ),
    index("card_visual_wall_preview_storage_deletion_pending_idx").on(
      table.completedAt,
      table.availableAt,
    ),
  ],
).enableRLS();

export const workspaceVisualWallsRelations = relations(
  workspaceVisualWalls,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [workspaceVisualWalls.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceVisualWallWorkspace",
    }),
    items: many(workspaceVisualWallItems),
  }),
);

export const workspaceVisualWallItemsRelations = relations(
  workspaceVisualWallItems,
  ({ one }) => ({
    wall: one(workspaceVisualWalls, {
      fields: [workspaceVisualWallItems.wallId],
      references: [workspaceVisualWalls.id],
      relationName: "workspaceVisualWallItemsWall",
    }),
    image: one(workspaceCanvasImages, {
      fields: [workspaceVisualWallItems.imageId],
      references: [workspaceCanvasImages.id],
      relationName: "workspaceVisualWallItemsImage",
    }),
  }),
);

export const cardVisualWallsRelations = relations(
  cardVisualWalls,
  ({ one, many }) => ({
    card: one(cards, {
      fields: [cardVisualWalls.cardId],
      references: [cards.id],
      relationName: "cardVisualWallCard",
    }),
    items: many(cardVisualWallItems),
  }),
);

export const cardVisualWallItemsRelations = relations(
  cardVisualWallItems,
  ({ one }) => ({
    wall: one(cardVisualWalls, {
      fields: [cardVisualWallItems.wallId],
      references: [cardVisualWalls.id],
      relationName: "cardVisualWallItemsWall",
    }),
    resource: one(cardResources, {
      fields: [cardVisualWallItems.resourceId],
      references: [cardResources.id],
      relationName: "cardVisualWallItemsResource",
    }),
  }),
);

export const cardVisualWallPreviewsRelations = relations(
  cardVisualWallPreviews,
  ({ one }) => ({
    resource: one(cardResources, {
      fields: [cardVisualWallPreviews.resourceId],
      references: [cardResources.id],
      relationName: "cardVisualWallPreviewResource",
    }),
  }),
);
