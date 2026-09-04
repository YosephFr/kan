CREATE TABLE IF NOT EXISTS "card_visual_wall_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallId" bigint NOT NULL,
	"resourceId" bigint NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"zIndex" integer NOT NULL,
	"legacyElementId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_visual_wall_item_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "card_visual_wall_item_legacy_unique" UNIQUE("wallId","legacyElementId"),
	CONSTRAINT "card_visual_wall_item_x_check" CHECK ("card_visual_wall_item"."x" >= 0 and "card_visual_wall_item"."x" <= 1156),
	CONSTRAINT "card_visual_wall_item_y_check" CHECK ("card_visual_wall_item"."y" >= 0 and "card_visual_wall_item"."y" <= 999956),
	CONSTRAINT "card_visual_wall_item_width_check" CHECK ("card_visual_wall_item"."width" >= 44 and "card_visual_wall_item"."width" <= 1200 and "card_visual_wall_item"."x" + "card_visual_wall_item"."width" <= 1200),
	CONSTRAINT "card_visual_wall_item_height_check" CHECK ("card_visual_wall_item"."height" >= 44 and "card_visual_wall_item"."height" <= 1000000 and "card_visual_wall_item"."y" + "card_visual_wall_item"."height" <= 1000000),
	CONSTRAINT "card_visual_wall_item_z_index_check" CHECK ("card_visual_wall_item"."zIndex" >= 0 and "card_visual_wall_item"."zIndex" <= 2147483647)
);
--> statement-breakpoint
ALTER TABLE "card_visual_wall_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_visual_wall_preview" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"resourceId" bigint NOT NULL,
	"s3Key" varchar(500) NOT NULL,
	"contentType" varchar(100) DEFAULT 'image/webp' NOT NULL,
	"size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	"storageDeletedAt" timestamp with time zone,
	CONSTRAINT "card_visual_wall_preview_resourceId_unique" UNIQUE("resourceId"),
	CONSTRAINT "card_visual_wall_preview_s3Key_unique" UNIQUE("s3Key"),
	CONSTRAINT "card_visual_wall_preview_type_check" CHECK ("card_visual_wall_preview"."contentType" = 'image/webp'),
	CONSTRAINT "card_visual_wall_preview_size_check" CHECK ("card_visual_wall_preview"."size" > 0 and "card_visual_wall_preview"."size" <= 768000),
	CONSTRAINT "card_visual_wall_preview_dimensions_check" CHECK ("card_visual_wall_preview"."width" between 1 and 1280 and "card_visual_wall_preview"."height" between 1 and 1280),
	CONSTRAINT "card_visual_wall_preview_sha_check" CHECK ("card_visual_wall_preview"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "card_visual_wall_preview" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_visual_wall" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cardId" bigint NOT NULL,
	"version" integer NOT NULL,
	"freeformUrl" varchar(2048),
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_visual_wall_cardId_unique" UNIQUE("cardId"),
	CONSTRAINT "card_visual_wall_version_check" CHECK ("card_visual_wall"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "card_visual_wall" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_visual_wall_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallId" bigint NOT NULL,
	"imageId" bigint NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"zIndex" integer NOT NULL,
	"legacyElementId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_visual_wall_item_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "workspace_visual_wall_item_legacy_unique" UNIQUE("wallId","legacyElementId"),
	CONSTRAINT "workspace_visual_wall_item_x_check" CHECK ("workspace_visual_wall_item"."x" >= 0 and "workspace_visual_wall_item"."x" <= 1156),
	CONSTRAINT "workspace_visual_wall_item_y_check" CHECK ("workspace_visual_wall_item"."y" >= 0 and "workspace_visual_wall_item"."y" <= 999956),
	CONSTRAINT "workspace_visual_wall_item_width_check" CHECK ("workspace_visual_wall_item"."width" >= 44 and "workspace_visual_wall_item"."width" <= 1200 and "workspace_visual_wall_item"."x" + "workspace_visual_wall_item"."width" <= 1200),
	CONSTRAINT "workspace_visual_wall_item_height_check" CHECK ("workspace_visual_wall_item"."height" >= 44 and "workspace_visual_wall_item"."height" <= 1000000 and "workspace_visual_wall_item"."y" + "workspace_visual_wall_item"."height" <= 1000000),
	CONSTRAINT "workspace_visual_wall_item_z_index_check" CHECK ("workspace_visual_wall_item"."zIndex" >= 0 and "workspace_visual_wall_item"."zIndex" <= 2147483647)
);
--> statement-breakpoint
ALTER TABLE "workspace_visual_wall_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_visual_wall" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspaceId" bigint NOT NULL,
	"version" integer NOT NULL,
	"freeformUrl" varchar(2048),
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_visual_wall_workspaceId_unique" UNIQUE("workspaceId"),
	CONSTRAINT "workspace_visual_wall_version_check" CHECK ("workspace_visual_wall"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "workspace_visual_wall" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_visual_wall_item" ADD CONSTRAINT "card_visual_wall_item_wallId_card_visual_wall_id_fk" FOREIGN KEY ("wallId") REFERENCES "public"."card_visual_wall"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_visual_wall_item" ADD CONSTRAINT "card_visual_wall_item_resourceId_card_resource_id_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."card_resource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_visual_wall_preview" ADD CONSTRAINT "card_visual_wall_preview_resourceId_card_resource_id_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."card_resource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_visual_wall" ADD CONSTRAINT "card_visual_wall_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_visual_wall" ADD CONSTRAINT "card_visual_wall_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_visual_wall" ADD CONSTRAINT "card_visual_wall_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_visual_wall_item" ADD CONSTRAINT "workspace_visual_wall_item_wallId_workspace_visual_wall_id_fk" FOREIGN KEY ("wallId") REFERENCES "public"."workspace_visual_wall"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_visual_wall_item" ADD CONSTRAINT "workspace_visual_wall_item_imageId_workspace_canvas_image_id_fk" FOREIGN KEY ("imageId") REFERENCES "public"."workspace_canvas_image"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_visual_wall" ADD CONSTRAINT "workspace_visual_wall_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_visual_wall" ADD CONSTRAINT "workspace_visual_wall_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_visual_wall" ADD CONSTRAINT "workspace_visual_wall_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_visual_wall_item_wall_z_idx" ON "card_visual_wall_item" USING btree ("wallId","zIndex","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_visual_wall_item_resource_idx" ON "card_visual_wall_item" USING btree ("resourceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_visual_wall_preview_gc_idx" ON "card_visual_wall_preview" USING btree ("storageDeletedAt","deletedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_visual_wall_item_wall_z_idx" ON "workspace_visual_wall_item" USING btree ("wallId","zIndex","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_visual_wall_item_image_idx" ON "workspace_visual_wall_item" USING btree ("imageId");