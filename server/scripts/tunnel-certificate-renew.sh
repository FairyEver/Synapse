#!/usr/bin/env bash
set -euo pipefail
umask 077
mode="${1:---check}"
force="${2:-}"
if [[ -n "$force" && ( "$mode" != "--renew" || "$force" != "--force" ) ]]; then echo "--force is only valid with --renew" >&2; exit 2; fi
case "$mode" in --check|--renew) ;; *) echo 'Use --check or --renew' >&2; exit 2;; esac
: "${TUNNEL_PUBLIC_DOMAIN:?Set TUNNEL_PUBLIC_DOMAIN}"
: "${TUNNEL_CERT_ROOT:?Set host certificate directory mounted into Caddy}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export TUNNEL_CADDYFILE="${TUNNEL_CADDYFILE:-/www/wwwroot/shared-caddy-edge/Caddyfile}"
export TUNNEL_CADDY_CONTAINER="${TUNNEL_CADDY_CONTAINER:-shared-caddy-edge}"
if [[ "$mode" == '--check' ]]; then
  node "$script_dir/tunnel-edge-config.mjs" --check-certificate --domain "$TUNNEL_PUBLIC_DOMAIN" --root "$TUNNEL_CERT_ROOT" --caddyfile "$TUNNEL_CADDYFILE"
  exit
fi
# Daily scheduler runs skip issuance until the existing certificate has less than 30 days.
if [[ "$force" != "--force" ]] && node "$script_dir/tunnel-edge-config.mjs" --check-certificate --minimum-days 30 --domain "$TUNNEL_PUBLIC_DOMAIN" --root "$TUNNEL_CERT_ROOT" --caddyfile "$TUNNEL_CADDYFILE" >/dev/null 2>&1; then
  echo 'Tunnel certificate is valid for more than 30 days; no issuance needed'
  exit
fi
# Credentials are read from the protected scheduler environment, never CLI args or business .env.
: "${TUNNEL_DNS_SECRET_ID:?Set restricted Tencent Cloud API SecretId}"
: "${TUNNEL_DNS_SECRET_KEY:?Set restricted Tencent Cloud API SecretKey}"
: "${TUNNEL_DNS_ZONE:?Set the DNSPod zone containing the tunnel suffix}"
export TUNNEL_BT_PANEL="${TUNNEL_BT_PANEL:-/www/server/panel}"
python_bin="${TUNNEL_BT_PYTHON:-$TUNNEL_BT_PANEL/pyenv/bin/python3}"
mkdir -p -- "$TUNNEL_CERT_ROOT"
# Serialize ACME orders as well as certificate installation. A crash leaves a visible lock to inspect.
mkdir -- "$TUNNEL_CERT_ROOT/.acme-lock" || { echo 'Another tunnel renewal is in progress' >&2; exit 1; }
trap 'rmdir -- "$TUNNEL_CERT_ROOT/.acme-lock"' EXIT
export TUNNEL_CERT_CANDIDATE
TUNNEL_CERT_CANDIDATE="$(mktemp -d "$TUNNEL_CERT_ROOT/.candidate.XXXXXXXX")"
# Existing BT ACME and Tencent SDK; only this order's TXT IDs are removed.
PYTHONDONTWRITEBYTECODE=1 "$python_bin" "$script_dir/tunnel-acme.py"

node "$script_dir/tunnel-edge-config.mjs" --install-certificate --apply --candidate "$TUNNEL_CERT_CANDIDATE" --root "$TUNNEL_CERT_ROOT" --domain "$TUNNEL_PUBLIC_DOMAIN" --caddyfile "$TUNNEL_CADDYFILE" --container "$TUNNEL_CADDY_CONTAINER"
