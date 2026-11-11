#!/usr/bin/env bash
set -euo pipefail
umask 077
mode="${1:---check}"
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
if node "$script_dir/tunnel-edge-config.mjs" --check-certificate --minimum-days 30 --domain "$TUNNEL_PUBLIC_DOMAIN" --root "$TUNNEL_CERT_ROOT" --caddyfile "$TUNNEL_CADDYFILE" >/dev/null 2>&1; then
  echo 'Tunnel certificate is valid for more than 30 days; no issuance needed'
  exit
fi
# Credentials are read from the protected scheduler environment, never CLI args or business .env.
: "${TUNNEL_DNSPOD_ID:?Set DNSPod legacy API ID in protected environment}"
: "${TUNNEL_DNSPOD_TOKEN:?Set DNSPod legacy API token in protected environment}"
export TUNNEL_BT_PANEL="${TUNNEL_BT_PANEL:-/www/server/panel}"
python_bin="${TUNNEL_BT_PYTHON:-$TUNNEL_BT_PANEL/pyenv/bin/python3}"
mkdir -p -- "$TUNNEL_CERT_ROOT"
# Serialize ACME orders as well as certificate installation. A crash leaves a visible lock to inspect.
mkdir -- "$TUNNEL_CERT_ROOT/.acme-lock" || { echo 'Another tunnel renewal is in progress' >&2; exit 1; }
trap 'rmdir -- "$TUNNEL_CERT_ROOT/.acme-lock"' EXIT
export TUNNEL_CERT_CANDIDATE
TUNNEL_CERT_CANDIDATE="$(mktemp -d "$TUNNEL_CERT_ROOT/.candidate.XXXXXXXX")"
# The installed provider was inspected: DNSPodDns(ID, Token), not Tencent SecretId/SecretKey.
# Override credential resolution to avoid persisting the ID/token inside BT order auth_to.
"$python_bin" - <<'PY'
import contextlib, os, sys
panel = os.environ['TUNNEL_BT_PANEL']
os.chdir(panel)
sys.path[:0] = [panel, panel + '/class']
try:
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        import acme_v2
        class TunnelAcme(acme_v2.acme_v2):
            def get_dnsapi(self, auth_to):
                if auth_to != 'DNSPodDns':
                    raise ValueError('Unexpected DNS provider')
                return 'DNSPodDns', os.environ['TUNNEL_DNSPOD_ID'], os.environ['TUNNEL_DNSPOD_TOKEN']
            def save_cert(self, cert, index):
                destination = os.environ['TUNNEL_CERT_CANDIDATE']
                for name, value in [('fullchain.pem', cert['cert'] + cert['root']), ('privkey.pem', cert['private_key'])]:
                    with open(destination + '/' + name, 'x') as output:
                        output.write(value)
                    os.chmod(destination + '/' + name, 0o600)
        result = TunnelAcme().apply_cert(['*.' + os.environ['TUNNEL_PUBLIC_DOMAIN']], auth_type='dns', auth_to='DNSPodDns')
        if not result.get('status'):
            raise RuntimeError('ACME failed')
except BaseException:
    sys.stderr.write('Tunnel ACME issuance failed; active certificate preserved. Inspect protected BT diagnostics.\n')
    sys.exit(1)
PY
node "$script_dir/tunnel-edge-config.mjs" --install-certificate --apply --candidate "$TUNNEL_CERT_CANDIDATE" --root "$TUNNEL_CERT_ROOT" --domain "$TUNNEL_PUBLIC_DOMAIN" --caddyfile "$TUNNEL_CADDYFILE" --container "$TUNNEL_CADDY_CONTAINER"
