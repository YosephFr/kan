#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

until mc alias set kan http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  sleep 2
done

mc mb --ignore-existing "kan/$NEXT_PUBLIC_AVATAR_BUCKET_NAME"
mc mb --ignore-existing "kan/$NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME"
mc mb --ignore-existing "kan/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME"
mc anonymous set download "kan/$NEXT_PUBLIC_AVATAR_BUCKET_NAME"
mc anonymous set download "kan/$NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME"
mc anonymous set none "kan/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME"

has_attachment_upload_lifecycle_rule() {
  mc ilm rule ls --expiry "kan/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME" 2>/dev/null |
    awk '
      /Enabled/ && /[[:space:]]\.uploads\/[[:space:]]/ && /[[:space:]]1[[:space:]]/ { found = 1 }
      END { exit !found }
    '
}

if ! has_attachment_upload_lifecycle_rule; then
  mc ilm rule add \
    --prefix ".uploads/" \
    --expire-days 1 \
    "kan/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME"
fi

if ! has_attachment_upload_lifecycle_rule; then
  echo "Attachment upload lifecycle rule was not applied" >&2
  exit 1
fi

if ! mc admin user info kan "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  mc admin user add kan "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
fi

if ! mc admin policy info kan kan-app >/dev/null 2>&1; then
  mc admin policy create kan kan-app "$script_dir/minio-policy.json"
fi

if ! mc admin policy info kan kan-workspace-logos >/dev/null 2>&1; then
  mc admin policy create \
    kan \
    kan-workspace-logos \
    "$script_dir/minio-workspace-logos-policy.json"
fi

mc admin policy attach kan kan-app --user "$S3_ACCESS_KEY_ID"
mc admin policy attach kan kan-workspace-logos --user "$S3_ACCESS_KEY_ID"
