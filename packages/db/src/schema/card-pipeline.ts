import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cardResources } from "./card-resources";
import { cardAttachments, cardPriorityEnum, cards } from "./cards";
import { users } from "./users";
import { workspaceMembers } from "./workspaces";

export const cardPipelineStageStatuses = [
  "planned",
  "inProgress",
  "blocked",
  "done",
] as const;

export type CardPipelineStageStatus =
  (typeof cardPipelineStageStatuses)[number];

export const cardPipelineStageStatusEnum = pgEnum(
  "card_pipeline_stage_status",
  cardPipelineStageStatuses,
);

export const cardPipelineStages = pgTable(
  "card_pipeline_stage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    status: cardPipelineStageStatusEnum("status").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    colourCode: varchar("colourCode", { length: 7 }),
    index: integer("index").notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }),
  },
  (table) => [
    unique("card_pipeline_stage_id_card_unique").on(table.id, table.cardId),
    unique("card_pipeline_stage_card_status_unique").on(
      table.cardId,
      table.status,
    ),
    unique("card_pipeline_stage_card_index_unique").on(
      table.cardId,
      table.index,
    ),
  ],
).enableRLS();

export const cardSubtasks = pgTable(
  "card_subtask",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    stageId: bigint("stageId", { mode: "number" }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    priority: cardPriorityEnum("priority").default("none").notNull(),
    dueDate: timestamp("dueDate", { withTimezone: true }),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    ownerWorkspaceMemberId: bigint("ownerWorkspaceMemberId", {
      mode: "number",
    }).references(() => workspaceMembers.id, { onDelete: "set null" }),
    index: integer("index").notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    deletedBy: uuid("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    foreignKey({
      name: "card_subtask_stage_card_fk",
      columns: [table.stageId, table.cardId],
      foreignColumns: [cardPipelineStages.id, cardPipelineStages.cardId],
    }).onDelete("cascade"),
    uniqueIndex("card_subtask_stage_index_active_unique")
      .on(table.stageId, table.index)
      .where(sql`${table.deletedAt} is null`),
    index("card_subtask_card_deleted_idx").on(table.cardId, table.deletedAt),
    index("card_subtask_owner_deleted_idx").on(
      table.ownerWorkspaceMemberId,
      table.deletedAt,
    ),
    index("card_subtask_due_active_idx")
      .on(table.dueDate)
      .where(sql`${table.dueDate} is not null and ${table.deletedAt} is null`),
  ],
).enableRLS();

export const cardSubtaskChecklistItems = pgTable(
  "card_subtask_checklist_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    subtaskId: bigint("subtaskId", { mode: "number" })
      .notNull()
      .references(() => cardSubtasks.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    completed: boolean("completed").default(false).notNull(),
    index: integer("index").notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    deletedBy: uuid("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("card_subtask_checklist_index_active_unique")
      .on(table.subtaskId, table.index)
      .where(sql`${table.deletedAt} is null`),
    index("card_subtask_checklist_subtask_deleted_idx").on(
      table.subtaskId,
      table.deletedAt,
    ),
  ],
).enableRLS();

export const cardSubtaskResources = pgTable(
  "card_subtask_resource",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    subtaskId: bigint("subtaskId", { mode: "number" })
      .notNull()
      .references(() => cardSubtasks.id, { onDelete: "cascade" }),
    resourceId: bigint("resourceId", { mode: "number" }).references(
      () => cardResources.id,
      { onDelete: "cascade" },
    ),
    attachmentId: bigint("attachmentId", { mode: "number" }).references(
      () => cardAttachments.id,
      { onDelete: "cascade" },
    ),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    deletedBy: uuid("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("card_subtask_resource_active_unique")
      .on(table.subtaskId, table.resourceId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("card_subtask_resource_attachment_active_unique")
      .on(table.subtaskId, table.attachmentId)
      .where(sql`${table.deletedAt} is null`),
    index("card_subtask_resource_subtask_deleted_idx").on(
      table.subtaskId,
      table.deletedAt,
    ),
  ],
).enableRLS();

export const cardPipelineStagesRelations = relations(
  cardPipelineStages,
  ({ one, many }) => ({
    card: one(cards, {
      fields: [cardPipelineStages.cardId],
      references: [cards.id],
      relationName: "cardPipelineStagesCard",
    }),
    subtasks: many(cardSubtasks),
  }),
);

export const cardSubtasksRelations = relations(
  cardSubtasks,
  ({ one, many }) => ({
    card: one(cards, {
      fields: [cardSubtasks.cardId],
      references: [cards.id],
      relationName: "cardSubtasksCard",
    }),
    stage: one(cardPipelineStages, {
      fields: [cardSubtasks.stageId],
      references: [cardPipelineStages.id],
      relationName: "cardSubtasksStage",
    }),
    owner: one(workspaceMembers, {
      fields: [cardSubtasks.ownerWorkspaceMemberId],
      references: [workspaceMembers.id],
      relationName: "cardSubtasksOwner",
    }),
    createdBy: one(users, {
      fields: [cardSubtasks.createdBy],
      references: [users.id],
      relationName: "cardSubtasksCreatedByUser",
    }),
    deletedBy: one(users, {
      fields: [cardSubtasks.deletedBy],
      references: [users.id],
      relationName: "cardSubtasksDeletedByUser",
    }),
    checklistItems: many(cardSubtaskChecklistItems),
    resources: many(cardSubtaskResources),
  }),
);

export const cardSubtaskChecklistItemsRelations = relations(
  cardSubtaskChecklistItems,
  ({ one }) => ({
    subtask: one(cardSubtasks, {
      fields: [cardSubtaskChecklistItems.subtaskId],
      references: [cardSubtasks.id],
      relationName: "cardSubtaskChecklistItemsSubtask",
    }),
    createdBy: one(users, {
      fields: [cardSubtaskChecklistItems.createdBy],
      references: [users.id],
      relationName: "cardSubtaskChecklistItemsCreatedByUser",
    }),
    deletedBy: one(users, {
      fields: [cardSubtaskChecklistItems.deletedBy],
      references: [users.id],
      relationName: "cardSubtaskChecklistItemsDeletedByUser",
    }),
  }),
);

export const cardSubtaskResourcesRelations = relations(
  cardSubtaskResources,
  ({ one }) => ({
    subtask: one(cardSubtasks, {
      fields: [cardSubtaskResources.subtaskId],
      references: [cardSubtasks.id],
      relationName: "cardSubtaskResourcesSubtask",
    }),
    attachment: one(cardAttachments, {
      fields: [cardSubtaskResources.attachmentId],
      references: [cardAttachments.id],
      relationName: "cardSubtaskResourcesAttachment",
    }),
    resource: one(cardResources, {
      fields: [cardSubtaskResources.resourceId],
      references: [cardResources.id],
      relationName: "cardSubtaskResourcesResource",
    }),
    createdBy: one(users, {
      fields: [cardSubtaskResources.createdBy],
      references: [users.id],
      relationName: "cardSubtaskResourcesCreatedByUser",
    }),
    deletedBy: one(users, {
      fields: [cardSubtaskResources.deletedBy],
      references: [users.id],
      relationName: "cardSubtaskResourcesDeletedByUser",
    }),
  }),
);
