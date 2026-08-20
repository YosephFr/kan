CREATE TYPE "public"."card_priority" AS ENUM('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."list_status" AS ENUM('planned', 'inProgress', 'blocked', 'done', 'other');--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.priority' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.colourCode' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'card.priority.urgent';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'card.due.soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'card.due.overdue';--> statement-breakpoint
ALTER TABLE "card_activity" ALTER COLUMN "fromDueDate" SET DATA TYPE timestamp with time zone USING "fromDueDate" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "card_activity" ALTER COLUMN "toDueDate" SET DATA TYPE timestamp with time zone USING "toDueDate" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "card" ALTER COLUMN "dueDate" SET DATA TYPE timestamp with time zone USING "dueDate" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "fromPriority" "card_priority";--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "toPriority" "card_priority";--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "fromColourCode" varchar(7);--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "toColourCode" varchar(7);--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "priority" "card_priority" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "colourCode" varchar(7);--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "startedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "completedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "list" ADD COLUMN "status" "list_status";--> statement-breakpoint
ALTER TABLE "list" ADD COLUMN "colourCode" varchar(7);--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "dedupeKey" varchar(255);--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_dedupeKey_unique" UNIQUE("dedupeKey");--> statement-breakpoint
CREATE INDEX "card_due_date_active_idx" ON "card" USING btree ("dueDate") WHERE "card"."dueDate" is not null and "card"."deletedAt" is null;--> statement-breakpoint
UPDATE "list"
SET "status" = CASE lower(btrim("name"))
  WHEN 'por hacer' THEN 'planned'::"list_status"
  WHEN 'en progreso' THEN 'inProgress'::"list_status"
  WHEN 'estancado' THEN 'blocked'::"list_status"
  WHEN 'hecho' THEN 'done'::"list_status"
  ELSE NULL
END
WHERE lower(btrim("name")) IN ('por hacer', 'en progreso', 'estancado', 'hecho');--> statement-breakpoint
UPDATE "card" AS c
SET "startedAt" = history."startedAt"
FROM (
  SELECT ca."cardId", min(ca."createdAt") AS "startedAt"
  FROM "card_activity" AS ca
  INNER JOIN "list" AS destination ON destination.id = ca."toListId"
  WHERE ca."type" = 'card.updated.list'
    AND destination."status" = 'inProgress'
  GROUP BY ca."cardId"
) AS history
WHERE c.id = history."cardId";--> statement-breakpoint
UPDATE "card" AS c
SET "completedAt" = history."completedAt"
FROM (
  SELECT ca."cardId", max(ca."createdAt") AS "completedAt"
  FROM "card_activity" AS ca
  INNER JOIN "list" AS destination ON destination.id = ca."toListId"
  LEFT JOIN "list" AS source ON source.id = ca."fromListId"
  WHERE ca."type" = 'card.updated.list'
    AND destination."status" = 'done'
    AND source."status" IS DISTINCT FROM 'done'
  GROUP BY ca."cardId"
) AS history, "list" AS current_list
WHERE c.id = history."cardId"
  AND current_list.id = c."listId"
  AND current_list."status" = 'done';
