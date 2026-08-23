CREATE TYPE "public"."card_canvas_revision_kind" AS ENUM('automatic', 'preRestore');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_canvas_frame" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"canvasId" bigint NOT NULL,
	"elementId" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"subtaskId" bigint,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_canvas_frame_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "card_canvas_frame_subtaskId_unique" UNIQUE("subtaskId"),
	CONSTRAINT "card_canvas_frame_canvas_element_unique" UNIQUE("canvasId","elementId")
);
--> statement-breakpoint
ALTER TABLE "card_canvas_frame" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_canvas_resource" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"canvasId" bigint NOT NULL,
	"elementId" varchar(255) NOT NULL,
	"resourceId" bigint NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_canvas_resource_canvas_element_unique" UNIQUE("canvasId","elementId")
);
--> statement-breakpoint
ALTER TABLE "card_canvas_resource" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_canvas_revision" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"canvasId" bigint NOT NULL,
	"sourceVersion" integer NOT NULL,
	"kind" "card_canvas_revision_kind" NOT NULL,
	"scene" jsonb NOT NULL,
	"hash" varchar(64) NOT NULL,
	"bytes" integer NOT NULL,
	"elementCount" integer NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_canvas_revision_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "card_canvas_revision_version_check" CHECK ("card_canvas_revision"."sourceVersion" >= 1),
	CONSTRAINT "card_canvas_revision_bytes_check" CHECK ("card_canvas_revision"."bytes" >= 0 and "card_canvas_revision"."bytes" <= 5242880),
	CONSTRAINT "card_canvas_revision_element_count_check" CHECK ("card_canvas_revision"."elementCount" >= 0 and "card_canvas_revision"."elementCount" <= 5000)
);
--> statement-breakpoint
ALTER TABLE "card_canvas_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_canvas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cardId" bigint NOT NULL,
	"scene" jsonb NOT NULL,
	"version" integer NOT NULL,
	"hash" varchar(64) NOT NULL,
	"bytes" integer NOT NULL,
	"elementCount" integer NOT NULL,
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_canvas_cardId_unique" UNIQUE("cardId"),
	CONSTRAINT "card_canvas_version_check" CHECK ("card_canvas"."version" >= 1),
	CONSTRAINT "card_canvas_bytes_check" CHECK ("card_canvas"."bytes" >= 0 and "card_canvas"."bytes" <= 5242880),
	CONSTRAINT "card_canvas_element_count_check" CHECK ("card_canvas"."elementCount" >= 0 and "card_canvas"."elementCount" <= 5000)
);
--> statement-breakpoint
ALTER TABLE "card_canvas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas_frame" ADD CONSTRAINT "card_canvas_frame_canvasId_card_canvas_id_fk" FOREIGN KEY ("canvasId") REFERENCES "public"."card_canvas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas_frame" ADD CONSTRAINT "card_canvas_frame_subtaskId_card_subtask_id_fk" FOREIGN KEY ("subtaskId") REFERENCES "public"."card_subtask"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas_frame" ADD CONSTRAINT "card_canvas_frame_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas_resource" ADD CONSTRAINT "card_canvas_resource_canvasId_card_canvas_id_fk" FOREIGN KEY ("canvasId") REFERENCES "public"."card_canvas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas_resource" ADD CONSTRAINT "card_canvas_resource_resourceId_card_resource_id_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."card_resource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas_revision" ADD CONSTRAINT "card_canvas_revision_canvasId_card_canvas_id_fk" FOREIGN KEY ("canvasId") REFERENCES "public"."card_canvas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas_revision" ADD CONSTRAINT "card_canvas_revision_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas" ADD CONSTRAINT "card_canvas_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas" ADD CONSTRAINT "card_canvas_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_canvas" ADD CONSTRAINT "card_canvas_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_canvas_frame_canvas_present_idx" ON "card_canvas_frame" USING btree ("canvasId","present");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_canvas_resource_resource_idx" ON "card_canvas_resource" USING btree ("resourceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_canvas_revision_canvas_created_idx" ON "card_canvas_revision" USING btree ("canvasId","createdAt");
