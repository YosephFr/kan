import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cardAttachments, cards } from "./cards";
import { users } from "./users";

export const cardResourceKinds = ["upload", "drive"] as const;
export type CardResourceKind = (typeof cardResourceKinds)[number];
export const cardResourceKindEnum = pgEnum(
  "card_resource_kind",
  cardResourceKinds,
);

export const cardResourceDriveTypes = [
  "file",
  "document",
  "spreadsheet",
  "presentation",
] as const;
export type CardResourceDriveType = (typeof cardResourceDriveTypes)[number];
export const cardResourceDriveTypeEnum = pgEnum(
  "card_resource_drive_type",
  cardResourceDriveTypes,
);

export const cardResources = pgTable(
  "card_resource",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    kind: cardResourceKindEnum("kind").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    attachmentId: bigint("attachmentId", { mode: "number" })
      .unique()
      .references(() => cardAttachments.id, { onDelete: "cascade" }),
    driveType: cardResourceDriveTypeEnum("driveType"),
    driveFileId: varchar("driveFileId", { length: 255 }),
    resourceKey: varchar("resourceKey", { length: 255 }),
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
    check(
      "card_resource_kind_payload_check",
      sql`(${table.kind} = 'upload' and ${table.attachmentId} is not null and ${table.driveType} is null and ${table.driveFileId} is null and ${table.resourceKey} is null) or (${table.kind} = 'drive' and ${table.attachmentId} is null and ${table.driveType} is not null and ${table.driveFileId} is not null)`,
    ),
    uniqueIndex("card_resource_drive_active_unique")
      .on(table.cardId, table.driveType, table.driveFileId)
      .where(sql`${table.kind} = 'drive' and ${table.deletedAt} is null`),
    index("card_resource_card_deleted_idx").on(table.cardId, table.deletedAt),
  ],
).enableRLS();

export const cardResourcesRelations = relations(cardResources, ({ one }) => ({
  card: one(cards, {
    fields: [cardResources.cardId],
    references: [cards.id],
    relationName: "cardResourcesCard",
  }),
  attachment: one(cardAttachments, {
    fields: [cardResources.attachmentId],
    references: [cardAttachments.id],
    relationName: "cardResourceAttachment",
  }),
  createdBy: one(users, {
    fields: [cardResources.createdBy],
    references: [users.id],
    relationName: "cardResourcesCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [cardResources.deletedBy],
    references: [users.id],
    relationName: "cardResourcesDeletedByUser",
  }),
}));
