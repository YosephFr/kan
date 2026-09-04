CREATE OR REPLACE FUNCTION "enqueue_card_visual_wall_preview_storage_deletion"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public."card_visual_wall_preview_storage_deletion" ("s3Key", "size")
  VALUES (OLD."s3Key", OLD."size")
  ON CONFLICT ("s3Key") DO UPDATE SET
    "size" = EXCLUDED."size",
    "attempts" = 0,
    "lastAttemptAt" = NULL,
    "availableAt" = now(),
    "completedAt" = NULL;
  RETURN OLD;
END;
$$;
