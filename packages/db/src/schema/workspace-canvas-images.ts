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

import { users } from "./users";
import { workspaceCanvases } from "./workspace-canvas";
import { workspaces } from "./workspaces";

export const workspaceCanvasImageUploadSessions = pgTable(
  "workspace_canvas_image_upload_session",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("userId").references(() => users.id, {
      onDelete: "set null",
    }),
    s3Key: varchar("s3Key", { length: 500 }).notNull().unique(),
    filename: varchar("filename", { length: 255 }).notNull(),
    originalFilename: varchar("originalFilename", { length: 255 }).notNull(),
    contentType: varchar("contentType", { length: 100 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    claimToken: varchar("claimToken", { length: 12 }),
    claimExpiresAt: timestamp("claimExpiresAt", { withTimezone: true }),
    consumedAt: timestamp("consumedAt", { withTimezone: true }),
    storageDeletedAt: timestamp("storageDeletedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "workspace_canvas_image_upload_size_check",
      sql`${table.size} > 0 and ${table.size} <= 10485760`,
    ),
    check(
      "workspace_canvas_image_upload_type_check",
      sql`${table.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    index("workspace_canvas_image_upload_expires_idx").on(table.expiresAt),
    index("workspace_canvas_image_upload_storage_gc_idx").on(
      table.workspaceId,
      table.storageDeletedAt,
      table.expiresAt,
    ),
    index("workspace_canvas_image_upload_pending_workspace_idx")
      .on(table.workspaceId, table.expiresAt)
      .where(sql`${table.consumedAt} is null`),
    index("workspace_canvas_image_upload_pending_user_idx")
      .on(table.userId, table.expiresAt)
      .where(sql`${table.consumedAt} is null`),
  ],
).enableRLS();

export const workspaceCanvasImages = pgTable(
  "workspace_canvas_image",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    originalFilename: varchar("originalFilename", { length: 255 }).notNull(),
    contentType: varchar("contentType", { length: 100 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    s3Key: varchar("s3Key", { length: 500 }).notNull().unique(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    uploadSessionId: bigint("uploadSessionId", { mode: "number" })
      .unique()
      .references(() => workspaceCanvasImageUploadSessions.id, {
        onDelete: "set null",
      }),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sharedAt: timestamp("sharedAt", { withTimezone: true }),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    storageDeletedAt: timestamp("storageDeletedAt", { withTimezone: true }),
    deletedBy: uuid("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "workspace_canvas_image_size_check",
      sql`${table.size} > 0 and ${table.size} <= 10485760`,
    ),
    check(
      "workspace_canvas_image_type_check",
      sql`${table.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    index("workspace_canvas_image_workspace_deleted_idx").on(
      table.workspaceId,
      table.deletedAt,
    ),
    index("workspace_canvas_image_workspace_shared_idx").on(
      table.workspaceId,
      table.sharedAt,
      table.deletedAt,
    ),
    index("workspace_canvas_image_storage_gc_idx").on(
      table.workspaceId,
      table.storageDeletedAt,
      table.deletedAt,
    ),
  ],
).enableRLS();

export const workspaceCanvasImageStorageDeletions = pgTable(
  "workspace_canvas_image_storage_deletion",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    s3Key: varchar("s3Key", { length: 500 }).notNull().unique(),
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
      "workspace_canvas_image_storage_deletion_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    index("workspace_canvas_image_storage_deletion_pending_idx").on(
      table.completedAt,
      table.availableAt,
      table.createdAt,
    ),
  ],
).enableRLS();

export const workspaceCanvasImageReferences = pgTable(
  "workspace_canvas_image_reference",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    canvasId: bigint("canvasId", { mode: "number" })
      .notNull()
      .references(() => workspaceCanvases.id, { onDelete: "cascade" }),
    elementId: varchar("elementId", { length: 255 }).notNull(),
    imageId: bigint("imageId", { mode: "number" })
      .notNull()
      .references(() => workspaceCanvasImages.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("workspace_canvas_image_reference_element_unique").on(
      table.canvasId,
      table.elementId,
    ),
    index("workspace_canvas_image_reference_image_idx").on(table.imageId),
  ],
).enableRLS();

export const workspaceCanvasImageUploadSessionsRelations = relations(
  workspaceCanvasImageUploadSessions,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceCanvasImageUploadSessions.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceCanvasImageUploadWorkspace",
    }),
    user: one(users, {
      fields: [workspaceCanvasImageUploadSessions.userId],
      references: [users.id],
      relationName: "workspaceCanvasImageUploadUser",
    }),
  }),
);

export const workspaceCanvasImagesRelations = relations(
  workspaceCanvasImages,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [workspaceCanvasImages.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceCanvasImageWorkspace",
    }),
    uploadSession: one(workspaceCanvasImageUploadSessions, {
      fields: [workspaceCanvasImages.uploadSessionId],
      references: [workspaceCanvasImageUploadSessions.id],
      relationName: "workspaceCanvasImageUploadSession",
    }),
    references: many(workspaceCanvasImageReferences),
  }),
);

export const workspaceCanvasImageReferencesRelations = relations(
  workspaceCanvasImageReferences,
  ({ one }) => ({
    canvas: one(workspaceCanvases, {
      fields: [workspaceCanvasImageReferences.canvasId],
      references: [workspaceCanvases.id],
      relationName: "workspaceCanvasImageReferenceCanvas",
    }),
    image: one(workspaceCanvasImages, {
      fields: [workspaceCanvasImageReferences.imageId],
      references: [workspaceCanvasImages.id],
      relationName: "workspaceCanvasImageReferenceImage",
    }),
  }),
);
