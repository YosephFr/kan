CREATE TYPE "public"."card_resource_drive_type" AS ENUM('file', 'document', 'spreadsheet', 'presentation');--> statement-breakpoint
CREATE TYPE "public"."card_resource_kind" AS ENUM('upload', 'drive');--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE IF NOT EXISTS 'card.updated.resource.added';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE IF NOT EXISTS 'card.updated.resource.removed';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE IF NOT EXISTS 'card.updated.resource.linked';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE IF NOT EXISTS 'card.updated.resource.unlinked';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_resource" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"cardId" bigint NOT NULL,
	"kind" "card_resource_kind" NOT NULL,
	"title" varchar(255) NOT NULL,
	"attachmentId" bigint,
	"driveType" "card_resource_drive_type",
	"driveFileId" varchar(255),
	"resourceKey" varchar(255),
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	"deletedBy" uuid,
	CONSTRAINT "card_resource_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "card_resource_attachmentId_unique" UNIQUE("attachmentId"),
	CONSTRAINT "card_resource_kind_payload_check" CHECK (("card_resource"."kind" = 'upload' and "card_resource"."attachmentId" is not null and "card_resource"."driveType" is null and "card_resource"."driveFileId" is null and "card_resource"."resourceKey" is null) or ("card_resource"."kind" = 'drive' and "card_resource"."attachmentId" is null and "card_resource"."driveType" is not null and "card_resource"."driveFileId" is not null))
);
--> statement-breakpoint
ALTER TABLE "card_resource" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 IF to_regclass('public.card_subtask_resource_active_unique') IS NOT NULL
    AND to_regclass('public.card_subtask_resource_attachment_active_unique') IS NULL THEN
  ALTER INDEX "card_subtask_resource_active_unique" RENAME TO "card_subtask_resource_attachment_active_unique";
 END IF;
END $$;--> statement-breakpoint
ALTER TABLE "card_subtask_resource" ALTER COLUMN "attachmentId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "card_subtask_resource" ADD COLUMN "resourceId" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_resource" ADD CONSTRAINT "card_resource_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_resource" ADD CONSTRAINT "card_resource_attachmentId_card_attachment_id_fk" FOREIGN KEY ("attachmentId") REFERENCES "public"."card_attachment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_resource" ADD CONSTRAINT "card_resource_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_resource" ADD CONSTRAINT "card_resource_deletedBy_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_resource_drive_active_unique" ON "card_resource" USING btree ("cardId","driveType","driveFileId") WHERE "card_resource"."kind" = 'drive' and "card_resource"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_resource_card_deleted_idx" ON "card_resource" USING btree ("cardId","deletedAt");--> statement-breakpoint
INSERT INTO "card_resource" (
	"publicId",
	"cardId",
	"kind",
	"title",
	"attachmentId",
	"createdBy",
	"createdAt",
	"deletedAt"
)
SELECT
	"publicId",
	"cardId",
	'upload'::"card_resource_kind",
	"originalFilename",
	"id",
	"createdBy",
	"createdAt",
	"deletedAt"
FROM "card_attachment"
ON CONFLICT ("publicId") DO NOTHING;--> statement-breakpoint
UPDATE "card_subtask_resource" AS subtask_resource
SET "resourceId" = resource."id"
FROM "card_resource" AS resource
WHERE resource."attachmentId" = subtask_resource."attachmentId";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_resource" ADD CONSTRAINT "card_subtask_resource_resourceId_card_resource_id_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."card_resource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_subtask_resource_active_unique" ON "card_subtask_resource" USING btree ("subtaskId","resourceId") WHERE "card_subtask_resource"."deletedAt" is null;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync_card_attachment_resource"() RETURNS trigger AS $$
BEGIN
 INSERT INTO "card_resource" (
  "publicId",
  "cardId",
  "kind",
  "title",
  "attachmentId",
  "createdBy",
  "createdAt",
  "updatedAt",
  "deletedAt"
 ) VALUES (
  NEW."publicId",
  NEW."cardId",
  'upload'::"card_resource_kind",
  NEW."originalFilename",
  NEW."id",
  NEW."createdBy",
  NEW."createdAt",
  CASE WHEN TG_OP = 'UPDATE' THEN now() ELSE NULL END,
  NEW."deletedAt"
 )
 ON CONFLICT ("publicId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "updatedAt" = EXCLUDED."updatedAt",
  "deletedAt" = EXCLUDED."deletedAt"
 WHERE "card_resource"."kind" = 'upload'
   AND "card_resource"."attachmentId" = EXCLUDED."attachmentId";
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "card_attachment_resource_sync" ON "card_attachment";--> statement-breakpoint
CREATE TRIGGER "card_attachment_resource_sync"
AFTER INSERT OR UPDATE OF "originalFilename", "deletedAt" ON "card_attachment"
FOR EACH ROW EXECUTE FUNCTION "sync_card_attachment_resource"();--> statement-breakpoint
INSERT INTO "card_resource" (
	"publicId",
	"cardId",
	"kind",
	"title",
	"attachmentId",
	"createdBy",
	"createdAt",
	"deletedAt"
)
SELECT
	"publicId",
	"cardId",
	'upload'::"card_resource_kind",
	"originalFilename",
	"id",
	"createdBy",
	"createdAt",
	"deletedAt"
FROM "card_attachment"
ON CONFLICT ("publicId") DO NOTHING;--> statement-breakpoint
UPDATE "card_subtask_resource" AS subtask_resource
SET "resourceId" = resource."id"
FROM "card_resource" AS resource
WHERE subtask_resource."resourceId" IS NULL
  AND resource."attachmentId" = subtask_resource."attachmentId";
