CREATE TABLE IF NOT EXISTS "workspace_canvas_revision" (
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
	CONSTRAINT "workspace_canvas_revision_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "workspace_canvas_revision_version_check" CHECK ("workspace_canvas_revision"."sourceVersion" >= 1),
	CONSTRAINT "workspace_canvas_revision_bytes_check" CHECK ("workspace_canvas_revision"."bytes" >= 0 and "workspace_canvas_revision"."bytes" <= 5242880),
	CONSTRAINT "workspace_canvas_revision_element_count_check" CHECK ("workspace_canvas_revision"."elementCount" >= 0 and "workspace_canvas_revision"."elementCount" <= 5000)
);
--> statement-breakpoint
ALTER TABLE "workspace_canvas_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_canvas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspaceId" bigint NOT NULL,
	"scene" jsonb NOT NULL,
	"version" integer NOT NULL,
	"hash" varchar(64) NOT NULL,
	"bytes" integer NOT NULL,
	"elementCount" integer NOT NULL,
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_canvas_workspaceId_unique" UNIQUE("workspaceId"),
	CONSTRAINT "workspace_canvas_version_check" CHECK ("workspace_canvas"."version" >= 1),
	CONSTRAINT "workspace_canvas_bytes_check" CHECK ("workspace_canvas"."bytes" >= 0 and "workspace_canvas"."bytes" <= 5242880),
	CONSTRAINT "workspace_canvas_element_count_check" CHECK ("workspace_canvas"."elementCount" >= 0 and "workspace_canvas"."elementCount" <= 5000)
);
--> statement-breakpoint
ALTER TABLE "workspace_canvas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_canvas_image_reference" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"canvasId" bigint NOT NULL,
	"elementId" varchar(255) NOT NULL,
	"imageId" bigint NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_canvas_image_reference_element_unique" UNIQUE("canvasId","elementId")
);
--> statement-breakpoint
ALTER TABLE "workspace_canvas_image_reference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_canvas_image_upload_session" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"userId" uuid,
	"s3Key" varchar(500) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"originalFilename" varchar(255) NOT NULL,
	"contentType" varchar(100) NOT NULL,
	"size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"claimToken" varchar(12),
	"claimExpiresAt" timestamp with time zone,
	"consumedAt" timestamp with time zone,
	"storageDeletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_canvas_image_upload_session_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "workspace_canvas_image_upload_session_s3Key_unique" UNIQUE("s3Key"),
	CONSTRAINT "workspace_canvas_image_upload_size_check" CHECK ("workspace_canvas_image_upload_session"."size" > 0 and "workspace_canvas_image_upload_session"."size" <= 10485760),
	CONSTRAINT "workspace_canvas_image_upload_type_check" CHECK ("workspace_canvas_image_upload_session"."contentType" in ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
ALTER TABLE "workspace_canvas_image_upload_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_canvas_image" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"title" varchar(255) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"originalFilename" varchar(255) NOT NULL,
	"contentType" varchar(100) NOT NULL,
	"size" bigint NOT NULL,
	"s3Key" varchar(500) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploadSessionId" bigint,
	"createdBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sharedAt" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	"storageDeletedAt" timestamp with time zone,
	"deletedBy" uuid,
	CONSTRAINT "workspace_canvas_image_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "workspace_canvas_image_s3Key_unique" UNIQUE("s3Key"),
	CONSTRAINT "workspace_canvas_image_uploadSessionId_unique" UNIQUE("uploadSessionId"),
	CONSTRAINT "workspace_canvas_image_size_check" CHECK ("workspace_canvas_image"."size" > 0 and "workspace_canvas_image"."size" <= 10485760),
	CONSTRAINT "workspace_canvas_image_type_check" CHECK ("workspace_canvas_image"."contentType" in ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
ALTER TABLE "workspace_canvas_image" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_canvas_image_storage_deletion" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"s3Key" varchar(500) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastAttemptAt" timestamp with time zone,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_canvas_image_storage_deletion_s3Key_unique" UNIQUE("s3Key"),
	CONSTRAINT "workspace_canvas_image_storage_deletion_attempts_check" CHECK ("workspace_canvas_image_storage_deletion"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_canvas_image_storage_deletion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_revision" ADD CONSTRAINT "workspace_canvas_revision_canvasId_workspace_canvas_id_fk" FOREIGN KEY ("canvasId") REFERENCES "public"."workspace_canvas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_revision" ADD CONSTRAINT "workspace_canvas_revision_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas" ADD CONSTRAINT "workspace_canvas_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas" ADD CONSTRAINT "workspace_canvas_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas" ADD CONSTRAINT "workspace_canvas_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image_reference" ADD CONSTRAINT "workspace_canvas_image_reference_canvasId_workspace_canvas_id_fk" FOREIGN KEY ("canvasId") REFERENCES "public"."workspace_canvas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image_reference" ADD CONSTRAINT "workspace_canvas_image_reference_imageId_workspace_canvas_image_id_fk" FOREIGN KEY ("imageId") REFERENCES "public"."workspace_canvas_image"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image_upload_session" ADD CONSTRAINT "workspace_canvas_image_upload_session_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image_upload_session" ADD CONSTRAINT "workspace_canvas_image_upload_session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image" ADD CONSTRAINT "workspace_canvas_image_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image" ADD CONSTRAINT "workspace_canvas_image_uploadSessionId_workspace_canvas_image_upload_session_id_fk" FOREIGN KEY ("uploadSessionId") REFERENCES "public"."workspace_canvas_image_upload_session"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image" ADD CONSTRAINT "workspace_canvas_image_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image" ADD CONSTRAINT "workspace_canvas_image_deletedBy_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_revision_canvas_created_idx" ON "workspace_canvas_revision" USING btree ("canvasId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_reference_image_idx" ON "workspace_canvas_image_reference" USING btree ("imageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_upload_expires_idx" ON "workspace_canvas_image_upload_session" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_upload_storage_gc_idx" ON "workspace_canvas_image_upload_session" USING btree ("workspaceId","storageDeletedAt","expiresAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_upload_pending_workspace_idx" ON "workspace_canvas_image_upload_session" USING btree ("workspaceId","expiresAt") WHERE "workspace_canvas_image_upload_session"."consumedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_upload_pending_user_idx" ON "workspace_canvas_image_upload_session" USING btree ("userId","expiresAt") WHERE "workspace_canvas_image_upload_session"."consumedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_workspace_deleted_idx" ON "workspace_canvas_image" USING btree ("workspaceId","deletedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_workspace_shared_idx" ON "workspace_canvas_image" USING btree ("workspaceId","sharedAt","deletedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_storage_gc_idx" ON "workspace_canvas_image" USING btree ("workspaceId","storageDeletedAt","deletedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_storage_deletion_pending_idx" ON "workspace_canvas_image_storage_deletion" USING btree ("completedAt","availableAt","createdAt");
