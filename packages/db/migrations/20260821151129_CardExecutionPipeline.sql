CREATE TYPE "public"."card_pipeline_stage_status" AS ENUM('planned', 'inProgress', 'blocked', 'done');--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.pipeline.initialized' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.pipeline.stage.updated' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.added' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.updated' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.moved' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.deleted' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.checklist.item.added' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.checklist.item.updated' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.checklist.item.completed' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.checklist.item.uncompleted' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.subtask.checklist.item.deleted' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtask.assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtask.due.soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtask.due.overdue';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_pipeline_stage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"cardId" bigint NOT NULL,
	"status" "card_pipeline_stage_status" NOT NULL,
	"name" varchar(255) NOT NULL,
	"colourCode" varchar(7),
	"index" integer NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone,
	CONSTRAINT "card_pipeline_stage_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "card_pipeline_stage_id_card_unique" UNIQUE("id","cardId"),
	CONSTRAINT "card_pipeline_stage_card_status_unique" UNIQUE("cardId","status"),
	CONSTRAINT "card_pipeline_stage_card_index_unique" UNIQUE("cardId","index")
);
--> statement-breakpoint
ALTER TABLE "card_pipeline_stage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_subtask_checklist_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"subtaskId" bigint NOT NULL,
	"title" varchar(500) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"index" integer NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	"deletedBy" uuid,
	CONSTRAINT "card_subtask_checklist_item_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "card_subtask_checklist_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_subtask_resource" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"subtaskId" bigint NOT NULL,
	"attachmentId" bigint NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	"deletedBy" uuid,
	CONSTRAINT "card_subtask_resource_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "card_subtask_resource" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_subtask" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"cardId" bigint NOT NULL,
	"stageId" bigint NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"priority" "card_priority" DEFAULT 'none' NOT NULL,
	"dueDate" timestamp with time zone,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"ownerWorkspaceMemberId" bigint,
	"index" integer NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	"deletedBy" uuid,
	CONSTRAINT "card_subtask_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "card_subtask" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "subtaskPublicId" varchar(12);--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "fromPipelineStagePublicId" varchar(12);--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "toPipelineStagePublicId" varchar(12);--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "subtaskId" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_pipeline_stage" ADD CONSTRAINT "card_pipeline_stage_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_pipeline_stage" ADD CONSTRAINT "card_pipeline_stage_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_checklist_item" ADD CONSTRAINT "card_subtask_checklist_item_subtaskId_card_subtask_id_fk" FOREIGN KEY ("subtaskId") REFERENCES "public"."card_subtask"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_checklist_item" ADD CONSTRAINT "card_subtask_checklist_item_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_checklist_item" ADD CONSTRAINT "card_subtask_checklist_item_deletedBy_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_resource" ADD CONSTRAINT "card_subtask_resource_subtaskId_card_subtask_id_fk" FOREIGN KEY ("subtaskId") REFERENCES "public"."card_subtask"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_resource" ADD CONSTRAINT "card_subtask_resource_attachmentId_card_attachment_id_fk" FOREIGN KEY ("attachmentId") REFERENCES "public"."card_attachment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_resource" ADD CONSTRAINT "card_subtask_resource_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask_resource" ADD CONSTRAINT "card_subtask_resource_deletedBy_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask" ADD CONSTRAINT "card_subtask_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask" ADD CONSTRAINT "card_subtask_ownerWorkspaceMemberId_workspace_members_id_fk" FOREIGN KEY ("ownerWorkspaceMemberId") REFERENCES "public"."workspace_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask" ADD CONSTRAINT "card_subtask_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask" ADD CONSTRAINT "card_subtask_deletedBy_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_subtask" ADD CONSTRAINT "card_subtask_stage_card_fk" FOREIGN KEY ("stageId","cardId") REFERENCES "public"."card_pipeline_stage"("id","cardId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_subtask_checklist_index_active_unique" ON "card_subtask_checklist_item" USING btree ("subtaskId","index") WHERE "card_subtask_checklist_item"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_subtask_checklist_subtask_deleted_idx" ON "card_subtask_checklist_item" USING btree ("subtaskId","deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_subtask_resource_active_unique" ON "card_subtask_resource" USING btree ("subtaskId","attachmentId") WHERE "card_subtask_resource"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_subtask_resource_subtask_deleted_idx" ON "card_subtask_resource" USING btree ("subtaskId","deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_subtask_stage_index_active_unique" ON "card_subtask" USING btree ("stageId","index") WHERE "card_subtask"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_subtask_card_deleted_idx" ON "card_subtask" USING btree ("cardId","deletedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_subtask_owner_deleted_idx" ON "card_subtask" USING btree ("ownerWorkspaceMemberId","deletedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_subtask_due_active_idx" ON "card_subtask" USING btree ("dueDate") WHERE "card_subtask"."dueDate" is not null and "card_subtask"."deletedAt" is null;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_subtaskId_card_subtask_id_fk" FOREIGN KEY ("subtaskId") REFERENCES "public"."card_subtask"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_user_type_subtask_idx" ON "notification" USING btree ("userId","type","subtaskId");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_card_pipeline_stage_count"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_card_id bigint;
  active_stage_count integer;
  minimum_stage_index integer;
  maximum_stage_index integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    target_card_id := OLD."cardId";
    IF EXISTS (SELECT 1 FROM "card" WHERE "id" = target_card_id) THEN
      SELECT count(*), min("index"), max("index")
      INTO active_stage_count, minimum_stage_index, maximum_stage_index
      FROM "card_pipeline_stage"
      WHERE "cardId" = target_card_id;
      IF active_stage_count NOT IN (0, 4)
        OR (active_stage_count = 4 AND (minimum_stage_index <> 0 OR maximum_stage_index <> 3)) THEN
        RAISE EXCEPTION 'card pipeline must contain zero or exactly four stages with contiguous indexes';
      END IF;
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    target_card_id := NEW."cardId";
    IF (TG_OP = 'INSERT' OR target_card_id IS DISTINCT FROM OLD."cardId")
      AND EXISTS (SELECT 1 FROM "card" WHERE "id" = target_card_id) THEN
      SELECT count(*), min("index"), max("index")
      INTO active_stage_count, minimum_stage_index, maximum_stage_index
      FROM "card_pipeline_stage"
      WHERE "cardId" = target_card_id;
      IF active_stage_count NOT IN (0, 4)
        OR (active_stage_count = 4 AND (minimum_stage_index <> 0 OR maximum_stage_index <> 3)) THEN
        RAISE EXCEPTION 'card pipeline must contain zero or exactly four stages with contiguous indexes';
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "card_pipeline_stage_count_guard"
AFTER INSERT OR UPDATE OF "cardId", "index" OR DELETE ON "card_pipeline_stage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_card_pipeline_stage_count"();
