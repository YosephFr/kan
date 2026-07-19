CREATE TABLE IF NOT EXISTS "instance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"brandName" varchar(64) DEFAULT 'kan.bn' NOT NULL,
	"brandLogo" text,
	"loginTitle" varchar(120),
	"loginDescription" varchar(280),
	"updatedBy" uuid,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "sidebarPosition" integer;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "sidebarPinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
