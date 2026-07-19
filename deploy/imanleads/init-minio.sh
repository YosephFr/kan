#!/bin/sh
set -eu

until mc alias set kan http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  sleep 2
done

mc mb --ignore-existing "kan/$NEXT_PUBLIC_AVATAR_BUCKET_NAME"
mc mb --ignore-existing "kan/$NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME"
mc mb --ignore-existing "kan/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME"
mc anonymous set download "kan/$NEXT_PUBLIC_AVATAR_BUCKET_NAME"
mc anonymous set download "kan/$NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME"
mc anonymous set none "kan/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME"

if ! mc admin user info kan "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  mc admin user add kan "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
fi

if ! mc admin policy info kan kan-app >/dev/null 2>&1; then
  mc admin policy create kan kan-app /opt/kan/minio-policy.json
fi

if ! mc admin policy info kan kan-workspace-logos >/dev/null 2>&1; then
  mc admin policy create \
    kan \
    kan-workspace-logos \
    /opt/kan/minio-workspace-logos-policy.json
fi

mc admin policy attach kan kan-app --user "$S3_ACCESS_KEY_ID"
mc admin policy attach kan kan-workspace-logos --user "$S3_ACCESS_KEY_ID"
