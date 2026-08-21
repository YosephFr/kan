#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/kan-config-test.XXXXXX")
trap 'rm -rf -- "$test_dir"' EXIT

assert_location_hardened() {
  location_path=$1
  block=$(awk -v marker="location ^~ /$location_path/ {" '
    index($0, marker) { capture = 1 }
    capture { print }
    capture && $0 == "  }" { exit }
  ' "$script_dir/nginx.conf")

  test -n "$block"
  printf '%s\n' "$block" | grep -Fq 'proxy_set_header Cookie "";'
  printf '%s\n' "$block" | grep -Fq 'proxy_set_header Authorization "";'
  printf '%s\n' "$block" | grep -Fq 'proxy_hide_header Set-Cookie;'
}

assert_location_hardened kan-avatars
assert_location_hardened kan-workspace-logos
assert_location_hardened kan-attachments

sh -n "$script_dir/init-minio.sh"

mkdir -p "$test_dir/bin"
cat > "$test_dir/bin/mc" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$MC_TEST_LOG"
if [ "$*" = "ilm rule ls --expiry kan/kan-attachments" ]; then
  if [ -f "$MC_TEST_STATE" ]; then
    printf '%s\n' 'test-rule Enabled .uploads/ - 1 false'
  fi
  exit 0
fi
if [ "$*" = "ilm rule add --prefix .uploads/ --expire-days 1 kan/kan-attachments" ]; then
  : > "$MC_TEST_STATE"
fi
EOF
chmod +x "$test_dir/bin/mc"

run_minio_init() {
  PATH="$test_dir/bin:$PATH" \
    MC_TEST_LOG="$test_dir/mc.log" \
    MC_TEST_STATE="$test_dir/lifecycle-created" \
    MINIO_ROOT_USER=test-root \
    MINIO_ROOT_PASSWORD=test-password \
    S3_ACCESS_KEY_ID=test-app \
    S3_SECRET_ACCESS_KEY=test-secret \
    NEXT_PUBLIC_AVATAR_BUCKET_NAME=kan-avatars \
    NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME=kan-workspace-logos \
    NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME=kan-attachments \
    sh "$script_dir/init-minio.sh"
}

run_minio_init
run_minio_init
test "$(grep -Fc 'ilm rule add --prefix .uploads/ --expire-days 1 kan/kan-attachments' "$test_dir/mc.log")" -eq 1
test "$(grep -Fc 'ilm rule ls --expiry kan/kan-attachments' "$test_dir/mc.log")" -eq 4

if command -v nginx >/dev/null 2>&1; then
  openssl req \
    -x509 \
    -nodes \
    -newkey rsa:2048 \
    -keyout "$test_dir/test.key" \
    -out "$test_dir/test.crt" \
    -subj /CN=work.imanleads.com \
    -days 1 \
    >/dev/null 2>&1
  sed \
    -e '/include snippets\/ssl-params.conf;/d' \
    -e '/include snippets\/cloudflare-allow.conf;/d' \
    -e "s|/etc/nginx/ssl/work.imanleads.com/work.imanleads.com.crt|$test_dir/test.crt|" \
    -e "s|/etc/nginx/ssl/work.imanleads.com/work.imanleads.com.key|$test_dir/test.key|" \
    "$script_dir/nginx.conf" > "$test_dir/site.conf"
  {
    printf 'pid %s;\n' "$test_dir/nginx.pid"
    printf 'error_log stderr;\n'
    printf 'events {}\n'
    printf 'http { access_log off; include "%s"; }\n' "$test_dir/site.conf"
  } > "$test_dir/nginx.conf"
  nginx -t -p "$test_dir/" -c nginx.conf
fi

POSTGRES_PASSWORD=test-password \
  POSTGRES_URL=postgresql://kan:test-password@postgres:5432/kan \
  REDIS_PASSWORD=test-password \
  REDIS_URL=redis://:test-password@redis:6379 \
  MINIO_ROOT_PASSWORD=test-password \
  S3_ACCESS_KEY_ID=test-app \
  S3_SECRET_ACCESS_KEY=test-secret \
  NEXT_PUBLIC_BASE_URL=https://work.imanleads.test \
  BETTER_AUTH_SECRET=test-better-auth-secret \
  BETTER_AUTH_TRUSTED_ORIGINS=https://work.imanleads.test \
  KAN_ADMIN_API_KEY=test-api-key \
  S3_PUBLIC_ENDPOINT=https://work.imanleads.test \
  NEXT_PUBLIC_STORAGE_URL=https://work.imanleads.test \
  NEXT_PUBLIC_STORAGE_DOMAIN=work.imanleads.test \
  docker compose \
    --env-file "$script_dir/env.example" \
    -f "$script_dir/compose.yaml" \
    config --quiet
