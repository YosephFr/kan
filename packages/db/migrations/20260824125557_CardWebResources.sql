ALTER TABLE "card_resource" DROP CONSTRAINT "card_resource_kind_payload_check";--> statement-breakpoint
DROP INDEX "card_resource_drive_active_unique";--> statement-breakpoint
CREATE TYPE "public"."card_resource_kind_next" AS ENUM('upload', 'drive', 'web');--> statement-breakpoint
ALTER TABLE "card_resource" ALTER COLUMN "kind" TYPE "public"."card_resource_kind_next" USING "kind"::text::"public"."card_resource_kind_next";--> statement-breakpoint
DROP TYPE "public"."card_resource_kind";--> statement-breakpoint
ALTER TYPE "public"."card_resource_kind_next" RENAME TO "card_resource_kind";--> statement-breakpoint
ALTER TABLE "card_resource" ADD COLUMN "webUrl" varchar(2048);--> statement-breakpoint
ALTER TABLE "card_resource" ADD COLUMN "webUrlHash" varchar(64);--> statement-breakpoint
ALTER TABLE "card_resource" ADD COLUMN "webDescription" varchar(500);--> statement-breakpoint
ALTER TABLE "card_resource" ADD COLUMN "webSiteName" varchar(255);--> statement-breakpoint
ALTER TABLE "card_resource" ADD COLUMN "webImageUrl" varchar(2048);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_resource_drive_active_unique" ON "card_resource" USING btree ("cardId","driveType","driveFileId") WHERE "card_resource"."kind" = 'drive' and "card_resource"."deletedAt" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_resource_web_active_unique" ON "card_resource" USING btree ("cardId","webUrlHash") WHERE "card_resource"."kind" = 'web' and "card_resource"."deletedAt" is null;--> statement-breakpoint
ALTER TABLE "card_resource" ADD CONSTRAINT "card_resource_kind_payload_check" CHECK (("card_resource"."kind" = 'upload' and "card_resource"."attachmentId" is not null and "card_resource"."driveType" is null and "card_resource"."driveFileId" is null and "card_resource"."resourceKey" is null and "card_resource"."webUrl" is null and "card_resource"."webUrlHash" is null and "card_resource"."webDescription" is null and "card_resource"."webSiteName" is null and "card_resource"."webImageUrl" is null) or ("card_resource"."kind" = 'drive' and "card_resource"."attachmentId" is null and "card_resource"."driveType" is not null and "card_resource"."driveFileId" is not null and "card_resource"."webUrl" is null and "card_resource"."webUrlHash" is null and "card_resource"."webDescription" is null and "card_resource"."webSiteName" is null and "card_resource"."webImageUrl" is null) or ("card_resource"."kind" = 'web' and "card_resource"."attachmentId" is null and "card_resource"."driveType" is null and "card_resource"."driveFileId" is null and "card_resource"."resourceKey" is null and "card_resource"."webUrl" is not null and "card_resource"."webUrlHash" is not null));
