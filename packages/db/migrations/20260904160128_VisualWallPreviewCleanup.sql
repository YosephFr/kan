CREATE TABLE IF NOT EXISTS "card_visual_wall_preview_storage_deletion" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"s3Key" varchar(500) NOT NULL,
	"size" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastAttemptAt" timestamp with time zone,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_visual_wall_preview_storage_deletion_s3Key_unique" UNIQUE("s3Key"),
	CONSTRAINT "card_visual_wall_preview_storage_deletion_attempts_check" CHECK ("card_visual_wall_preview_storage_deletion"."attempts" >= 0),
	CONSTRAINT "card_visual_wall_preview_storage_deletion_size_check" CHECK ("card_visual_wall_preview_storage_deletion"."size" is null or "card_visual_wall_preview_storage_deletion"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "card_visual_wall_preview_storage_deletion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_visual_wall_preview_storage_deletion_pending_idx" ON "card_visual_wall_preview_storage_deletion" USING btree ("completedAt","availableAt");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enqueue_card_visual_wall_preview_storage_deletion"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public."card_visual_wall_preview_storage_deletion" ("s3Key", "size")
  VALUES (OLD."s3Key", OLD."size")
  ON CONFLICT ("s3Key") DO NOTHING;
  RETURN OLD;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "card_visual_wall_preview_storage_deletion_enqueue" ON "card_visual_wall_preview";--> statement-breakpoint
CREATE TRIGGER "card_visual_wall_preview_storage_deletion_enqueue"
BEFORE DELETE ON "card_visual_wall_preview"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_card_visual_wall_preview_storage_deletion"();
