CREATE TABLE IF NOT EXISTS "card_attachment_upload_session" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"cardId" bigint NOT NULL,
	"workspaceId" bigint NOT NULL,
	"userId" uuid NOT NULL,
	"s3Key" varchar(500) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"originalFilename" varchar(255) NOT NULL,
	"contentType" varchar(100) NOT NULL,
	"size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"consumedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_attachment_upload_session_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "card_attachment_upload_session_s3Key_unique" UNIQUE("s3Key")
);
--> statement-breakpoint
ALTER TABLE "card_attachment_upload_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card_attachment" ADD COLUMN "sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "card_attachment" ADD COLUMN "uploadSessionId" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_attachment_upload_session" ADD CONSTRAINT "card_attachment_upload_session_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_attachment_upload_session" ADD CONSTRAINT "card_attachment_upload_session_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_attachment_upload_session" ADD CONSTRAINT "card_attachment_upload_session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_upload_session_expires_idx" ON "card_attachment_upload_session" USING btree ("expiresAt");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_attachment" ADD CONSTRAINT "card_attachment_uploadSessionId_card_attachment_upload_session_id_fk" FOREIGN KEY ("uploadSessionId") REFERENCES "public"."card_attachment_upload_session"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "card_attachment" ADD CONSTRAINT "card_attachment_uploadSessionId_unique" UNIQUE("uploadSessionId");