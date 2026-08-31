ALTER TABLE "workspace_canvas_image_storage_deletion" ADD COLUMN "workspaceId" bigint;--> statement-breakpoint
ALTER TABLE "workspace_canvas_image_storage_deletion" ADD COLUMN "size" bigint;--> statement-breakpoint
UPDATE "workspace_canvas_image_storage_deletion" AS deletion
SET "workspaceId" = image."workspaceId", "size" = image."size"
FROM "workspace_canvas_image" AS image
WHERE deletion."s3Key" = image."s3Key" AND deletion."workspaceId" IS NULL;--> statement-breakpoint
UPDATE "workspace_canvas_image_storage_deletion" AS deletion
SET "workspaceId" = upload."workspaceId", "size" = upload."size"
FROM "workspace_canvas_image_upload_session" AS upload
WHERE deletion."s3Key" = upload."s3Key" AND deletion."workspaceId" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_canvas_image_storage_deletion" ADD CONSTRAINT "workspace_canvas_image_storage_deletion_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_canvas_image_storage_deletion_workspace_idx" ON "workspace_canvas_image_storage_deletion" USING btree ("workspaceId","completedAt");--> statement-breakpoint
ALTER TABLE "workspace_canvas_image_storage_deletion" ADD CONSTRAINT "workspace_canvas_image_storage_deletion_size_check" CHECK ("workspace_canvas_image_storage_deletion"."size" is null or "workspace_canvas_image_storage_deletion"."size" > 0);
