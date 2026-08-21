ALTER TABLE "card_attachment_upload_session" ADD COLUMN "claimToken" varchar(12);--> statement-breakpoint
ALTER TABLE "card_attachment_upload_session" ADD COLUMN "claimExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_attachment" ADD COLUMN "storageQuarantinedAt" timestamp with time zone;--> statement-breakpoint
UPDATE "card_attachment" AS attachment
SET
	"storageQuarantinedAt" = now(),
	"deletedAt" = COALESCE(attachment."deletedAt", now())
FROM "card" AS card
WHERE
	attachment."cardId" = card."id"
	AND attachment."uploadSessionId" IS NULL
	AND attachment."deletedAt" IS NULL
	AND NOT (
		attachment."s3Key" ~ '^[A-Za-z0-9_-]+/[^/]+/.+$'
		AND split_part(attachment."s3Key", '/', 2) = card."publicId"
		AND attachment."s3Key" !~ '(^|/)[.]{1,2}(/|$)'
		AND attachment."s3Key" !~ '//'
	);
