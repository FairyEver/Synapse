#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATOR="$SCRIPT_DIR/import-legacy-database.mjs"

if [[ ! -f "$MIGRATOR" ]]; then
  echo "Error: import-legacy-database.mjs must be in the same folder as this script." >&2
  exit 1
fi

if pgrep -x "Synapse" >/dev/null 2>&1; then
  echo "Error: Synapse is running. Close Synapse, then run this script again." >&2
  exit 1
fi

run_with_node() {
  local node_bin="$1"
  "$node_bin" --no-warnings -e 'require("node:sqlite")' >/dev/null 2>&1
}

run_with_synapse_app() {
  local app_exe="$1"
  env ELECTRON_RUN_AS_NODE=1 "$app_exe" --no-warnings -e 'require("node:sqlite")' >/dev/null 2>&1
}

if command -v node >/dev/null 2>&1 && run_with_node "$(command -v node)"; then
  echo "Using Node: $(command -v node)"
  node --no-warnings "$MIGRATOR" "$@"
  exit $?
fi

APP_CANDIDATES=()
if [[ -n "${SYNAPSE_APP:-}" ]]; then
  APP_CANDIDATES+=("$SYNAPSE_APP")
fi
APP_CANDIDATES+=(
  "/Applications/Synapse.app"
  "$HOME/Applications/Synapse.app"
)

for app_path in "${APP_CANDIDATES[@]}"; do
  app_exe="$app_path/Contents/MacOS/Synapse"
  if [[ -x "$app_exe" ]] && run_with_synapse_app "$app_exe"; then
    echo "Using Synapse app runtime: $app_path"
    env ELECTRON_RUN_AS_NODE=1 "$app_exe" --no-warnings "$MIGRATOR" "$@"
    exit $?
  fi
done

cat >&2 <<'EOF'
Error: no usable Node runtime found.

Fix either of these:
- Install Node.js 22 or newer, then rerun this script.
- Install Synapse.app in /Applications or ~/Applications.

If Synapse.app is elsewhere:
  SYNAPSE_APP="/path/to/Synapse.app" ./migrate-legacy-database-macos.sh
EOF
exit 1
