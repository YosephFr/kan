DROP INDEX IF EXISTS "card_visual_wall_item_wall_z_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "card_visual_wall_item_resource_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "workspace_visual_wall_item_wall_z_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "workspace_visual_wall_item_image_idx";--> statement-breakpoint
ALTER TABLE "card_visual_wall_item" ADD COLUMN "deletedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_visual_wall_item" ADD COLUMN "deletedAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_visual_wall_item_wall_z_idx" ON "card_visual_wall_item" USING btree ("wallId","zIndex","id") WHERE "card_visual_wall_item"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_visual_wall_item_resource_idx" ON "card_visual_wall_item" USING btree ("resourceId") WHERE "card_visual_wall_item"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_visual_wall_item_wall_z_idx" ON "workspace_visual_wall_item" USING btree ("wallId","zIndex","id") WHERE "workspace_visual_wall_item"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_visual_wall_item_image_idx" ON "workspace_visual_wall_item" USING btree ("imageId") WHERE "workspace_visual_wall_item"."deletedAt" is null;