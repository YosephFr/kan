ALTER TABLE "card_attachment_upload_session" DROP CONSTRAINT "card_attachment_upload_session_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "card_attachment_upload_session" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_attachment_upload_session" ADD CONSTRAINT "card_attachment_upload_session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
