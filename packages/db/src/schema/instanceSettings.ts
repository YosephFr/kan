import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const instanceSettings = pgTable("instance_settings", {
  id: integer("id").primaryKey().default(1),
  brandName: varchar("brandName", { length: 64 }).notNull().default("kan.bn"),
  brandLogo: text("brandLogo"),
  loginTitle: varchar("loginTitle", { length: 120 }),
  loginDescription: varchar("loginDescription", { length: 280 }),
  updatedBy: uuid("updatedBy").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}).enableRLS();
