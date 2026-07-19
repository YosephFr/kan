#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
domain="work.imanleads.com"
ssl_dir="/etc/nginx/ssl/$domain"
site_available="/etc/nginx/sites-available/$domain.conf"
site_enabled="/etc/nginx/sites-enabled/$domain.conf"

sudo install -d -m 755 "$ssl_dir" /var/www/acme

if [[ ! -s "$ssl_dir/$domain.crt" || ! -s "$ssl_dir/$domain.key" ]]; then
  certificate_dir="$(mktemp -d)"
  trap 'rm -rf "$certificate_dir"' EXIT
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=$domain" \
    -addext "subjectAltName=DNS:$domain" \
    -keyout "$certificate_dir/$domain.key" \
    -out "$certificate_dir/$domain.crt" >/dev/null 2>&1
  sudo install -m 600 "$certificate_dir/$domain.key" "$ssl_dir/$domain.key"
  sudo install -m 644 "$certificate_dir/$domain.crt" "$ssl_dir/$domain.crt"
fi

sudo install -m 644 "$repo_dir/deploy/imanleads/nginx.conf" "$site_available"
sudo ln -sfn "$site_available" "$site_enabled"
sudo nginx -t
sudo systemctl reload nginx
