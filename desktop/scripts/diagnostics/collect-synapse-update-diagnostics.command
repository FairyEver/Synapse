#!/bin/bash

set -u
set -o pipefail
export LC_ALL=C

APP_BUNDLE_ID="com.fairyever.synapse"
UPDATE_FEED_URL="https://desktop.release.synapse.d2.pub/latest-mac.yml"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This diagnostic script only supports macOS."
  exit 1
fi

DESKTOP_DIR="$(/usr/bin/osascript -e 'POSIX path of (path to desktop folder)' 2>/dev/null || true)"
DESKTOP_DIR="${DESKTOP_DIR%/}"
if [ -z "$DESKTOP_DIR" ] || [ ! -d "$DESKTOP_DIR" ]; then
  DESKTOP_DIR="$HOME/Desktop"
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/synapse-update-diagnostics.XXXXXX")"
PACKAGE_NAME="Synapse-update-diagnostics-${TIMESTAMP}"
PACKAGE_DIR="$WORK_DIR/$PACKAGE_NAME"
REPORT_FILE="$PACKAGE_DIR/report.txt"
SUMMARY_FILE="$PACKAGE_DIR/summary.txt"
APP_PATHS_FILE="$WORK_DIR/app-paths.txt"
CACHE_PATHS_FILE="$WORK_DIR/cache-paths.txt"
FINAL_ZIP="$DESKTOP_DIR/${PACKAGE_NAME}.zip"
FINAL_SUMMARY="$DESKTOP_DIR/${PACKAGE_NAME}-summary.txt"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$PACKAGE_DIR/shipit-logs" "$PACKAGE_DIR/synapse-update-logs" "$PACKAGE_DIR/network"

section() {
  printf '\n\n===== %s =====\n' "$1" >> "$REPORT_FILE"
}

run_and_record() {
  local label="$1"
  shift

  printf '\n--- %s ---\n' "$label" >> "$REPORT_FILE"
  "$@" >> "$REPORT_FILE" 2>&1
  local status=$?
  printf '[exit_status=%s]\n' "$status" >> "$REPORT_FILE"
  return 0
}

yes_no() {
  if "$@"; then
    printf 'yes'
  else
    printf 'no'
  fi
}

redact_stream() {
  /usr/bin/sed -E \
    -e 's#/Users/[^/[:space:]]+#/Users/[redacted]#g' \
    -e 's#([?&](token|credential|code)=)[^&[:space:]]+#\1[redacted]#g' \
    -e 's#(Authorization[^:]*:[[:space:]]*)[^[:space:]]+#\1[redacted]#g'
}

evidence_after_latest_install() {
  local pattern="$1"
  shift
  local evidence_line
  local evidence_timestamp
  local evidence_epoch

  if [ "${LATEST_INSTALL_EPOCH:-0}" -le 0 ]; then
    return 1
  fi

  while IFS= read -r evidence_line; do
    evidence_timestamp="$(printf '%s\n' "$evidence_line" \
      | /usr/bin/sed -nE 's/^([0-9]{4}-[0-9]{2}-[0-9]{2})[ T]([0-9]{2}:[0-9]{2}:[0-9]{2}).*$/\1 \2/p')"
    [ -n "$evidence_timestamp" ] || continue
    evidence_epoch="$(/bin/date -j -f '%Y-%m-%d %H:%M:%S' "$evidence_timestamp" '+%s' 2>/dev/null || printf '0')"
    if [ "$evidence_epoch" -ge "$LATEST_INSTALL_EPOCH" ]; then
      return 0
    fi
  done < <(/usr/bin/grep -ERih "$pattern" "$@" 2>/dev/null || true)

  return 1
}

echo "Collecting Synapse update diagnostics..."
echo "This script is read-only and does not modify or restart Synapse."

cat > "$REPORT_FILE" <<EOF
Synapse Update Diagnostics
Generated: $(date '+%Y-%m-%d %H:%M:%S %z')
Bundle ID: $APP_BUNDLE_ID
EOF

section "System"
run_and_record "macOS version" /usr/bin/sw_vers
run_and_record "Kernel and architecture" /usr/bin/uname -a
run_and_record "Hardware architecture" /usr/bin/arch
run_and_record "System Integrity Protection" /usr/bin/csrutil status
run_and_record "Disk space" /bin/df -h /Applications "$HOME/Library/Caches"
printf '\n--- Account capability ---\n' >> "$REPORT_FILE"
printf 'uid=%s\n' "$(id -u)" >> "$REPORT_FILE"
if id -Gn | /usr/bin/tr ' ' '\n' | /usr/bin/grep -qx 'admin'; then
  USER_IS_ADMIN="yes"
else
  USER_IS_ADMIN="no"
fi
printf 'member_of_admin_group=%s\n' "$USER_IS_ADMIN" >> "$REPORT_FILE"

section "Running processes"
SYNAPSE_PIDS="$(/usr/bin/pgrep -x Synapse 2>/dev/null || true)"
SHIPIT_PIDS="$(/usr/bin/pgrep -x ShipIt 2>/dev/null || true)"
printf 'synapse_running=%s\n' "$([ -n "$SYNAPSE_PIDS" ] && printf yes || printf no)" >> "$REPORT_FILE"
printf 'shipit_running=%s\n' "$([ -n "$SHIPIT_PIDS" ] && printf yes || printf no)" >> "$REPORT_FILE"
for process_id in $SYNAPSE_PIDS $SHIPIT_PIDS; do
  run_and_record "Process $process_id" /bin/ps -p "$process_id" -o pid=,ppid=,user=,lstart=,etime=,comm=
done

for candidate in "/Applications/Synapse.app" "$HOME/Applications/Synapse.app"; do
  if [ -d "$candidate" ]; then
    printf '%s\n' "$candidate" >> "$APP_PATHS_FILE"
  fi
done
if command -v mdfind >/dev/null 2>&1; then
  /usr/bin/mdfind "kMDItemCFBundleIdentifier == '$APP_BUNDLE_ID'" 2>/dev/null \
    | /usr/bin/head -n 20 >> "$APP_PATHS_FILE" || true
fi
if [ -f "$APP_PATHS_FILE" ]; then
  /usr/bin/awk 'NF && !seen[$0]++' "$APP_PATHS_FILE" > "$APP_PATHS_FILE.tmp"
  /bin/mv "$APP_PATHS_FILE.tmp" "$APP_PATHS_FILE"
fi

APP_COUNT=0
PRIMARY_APP_FOUND="no"
PRIMARY_APP_WRITABLE="unknown"
PRIMARY_CONTENTS_WRITABLE="unknown"
PRIMARY_PARENT_WRITABLE="unknown"
PRIMARY_SIGNATURE_VALID="unknown"

section "Installed Synapse applications"
if [ ! -s "$APP_PATHS_FILE" ]; then
  printf 'No Synapse.app with bundle ID %s was found.\n' "$APP_BUNDLE_ID" >> "$REPORT_FILE"
else
  while IFS= read -r app_path; do
    [ -d "$app_path" ] || continue
    APP_COUNT=$((APP_COUNT + 1))
    app_parent="$(/usr/bin/dirname "$app_path")"
    app_contents="$app_path/Contents"
    info_plist="$app_contents/Info.plist"

    printf '\n--- Application %s ---\n' "$APP_COUNT" >> "$REPORT_FILE"
    printf 'path=%s\n' "$app_path" >> "$REPORT_FILE"
    printf 'app_writable=%s\n' "$(yes_no test -w "$app_path")" >> "$REPORT_FILE"
    printf 'contents_writable=%s\n' "$(yes_no test -w "$app_contents")" >> "$REPORT_FILE"
    printf 'parent_writable=%s\n' "$(yes_no test -w "$app_parent")" >> "$REPORT_FILE"

    run_and_record "Application ownership and ACL" /bin/ls -ldeO@ "$app_path"
    run_and_record "Contents ownership and ACL" /bin/ls -ldeO@ "$app_contents"
    run_and_record "Parent ownership and ACL" /bin/ls -ldeO@ "$app_parent"
    run_and_record "Application stat" /usr/bin/stat -f 'owner=%Su group=%Sg mode=%Sp flags=%Sf modified=%Sm' "$app_path"

    if [ -f "$info_plist" ]; then
      run_and_record "Bundle identifier" /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist"
      run_and_record "Bundle version" /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist"
      run_and_record "Build version" /usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist"
    fi

    printf '\n--- Code signature details ---\n' >> "$REPORT_FILE"
    /usr/bin/codesign -dv --verbose=4 "$app_path" >> "$REPORT_FILE" 2>&1
    printf '[exit_status=%s]\n' "$?" >> "$REPORT_FILE"

    printf '\n--- Strict code signature verification ---\n' >> "$REPORT_FILE"
    if /usr/bin/codesign --verify --deep --strict --verbose=4 "$app_path" >> "$REPORT_FILE" 2>&1; then
      signature_valid="yes"
    else
      signature_valid="no"
    fi
    printf 'signature_valid=%s\n' "$signature_valid" >> "$REPORT_FILE"

    run_and_record "Gatekeeper assessment" /usr/sbin/spctl -a -vv -t exec "$app_path"
    run_and_record "Extended attribute names" /usr/bin/xattr "$app_path"

    if [ "$app_path" = "/Applications/Synapse.app" ]; then
      PRIMARY_APP_FOUND="yes"
      PRIMARY_APP_WRITABLE="$(yes_no test -w "$app_path")"
      PRIMARY_CONTENTS_WRITABLE="$(yes_no test -w "$app_contents")"
      PRIMARY_PARENT_WRITABLE="$(yes_no test -w "$app_parent")"
      PRIMARY_SIGNATURE_VALID="$signature_valid"
    fi
  done < "$APP_PATHS_FILE"
fi

section "Squirrel settings"
run_and_record "Direct Contents update setting" /usr/bin/defaults read "$APP_BUNDLE_ID" SquirrelMacEnableDirectContentsWrite
run_and_record "ShipIt launch service (GUI domain)" /bin/launchctl print "gui/$(id -u)/${APP_BUNDLE_ID}.ShipIt"
run_and_record "ShipIt launch service (user domain)" /bin/launchctl print "user/$(id -u)/${APP_BUNDLE_ID}.ShipIt"

for cache_dir in \
  "$HOME/Library/Caches/@synapsedesktop-updater" \
  "$HOME/Library/Caches/${APP_BUNDLE_ID}.ShipIt"; do
  if [ -d "$cache_dir" ]; then
    printf '%s\n' "$cache_dir" >> "$CACHE_PATHS_FILE"
  fi
done
shopt -s nullglob
for cache_dir in "$HOME/Library/Caches/"*Synapse* "$HOME/Library/Caches/"*synapse*; do
  if [ -d "$cache_dir" ]; then
    printf '%s\n' "$cache_dir" >> "$CACHE_PATHS_FILE"
  fi
done
shopt -u nullglob
if [ -f "$CACHE_PATHS_FILE" ]; then
  /usr/bin/awk 'NF && !seen[$0]++' "$CACHE_PATHS_FILE" > "$CACHE_PATHS_FILE.tmp"
  /bin/mv "$CACHE_PATHS_FILE.tmp" "$CACHE_PATHS_FILE"
fi

section "Updater and ShipIt caches"
if [ ! -s "$CACHE_PATHS_FILE" ]; then
  printf 'No Synapse updater cache directory was found.\n' >> "$REPORT_FILE"
else
  while IFS= read -r cache_dir; do
    printf '\n--- Cache directory ---\npath=%s\n' "$cache_dir" >> "$REPORT_FILE"
    run_and_record "Cache ownership and ACL" /bin/ls -ldeO@ "$cache_dir"
    /usr/bin/find "$cache_dir" -type f -print 2>/dev/null \
      | /usr/bin/head -n 200 \
      | while IFS= read -r cache_file; do
          /usr/bin/stat -f 'file=%N size=%z owner=%Su group=%Sg mode=%Sp modified=%Sm' "$cache_file" \
            >> "$REPORT_FILE" 2>&1 || true
        done
  done < "$CACHE_PATHS_FILE"
fi

echo "Checking cached update archives..."
section "Cached update archive verification"
CACHED_ZIP_COUNT=0
shopt -s nullglob
for cached_zip in "$HOME/Library/Caches/@synapsedesktop-updater/pending/"*.zip; do
  CACHED_ZIP_COUNT=$((CACHED_ZIP_COUNT + 1))
  printf '\n--- Cached ZIP %s ---\n' "$CACHED_ZIP_COUNT" >> "$REPORT_FILE"
  /usr/bin/stat -f 'file=%N size=%z owner=%Su group=%Sg mode=%Sp modified=%Sm' "$cached_zip" >> "$REPORT_FILE" 2>&1
  /usr/bin/openssl dgst -sha512 "$cached_zip" >> "$REPORT_FILE" 2>&1
  if /usr/bin/unzip -tqq "$cached_zip" >> "$REPORT_FILE" 2>&1; then
    printf 'zip_integrity=valid\n' >> "$REPORT_FILE"
  else
    printf 'zip_integrity=invalid\n' >> "$REPORT_FILE"
  fi

  plist_entry="$(/usr/bin/unzip -Z1 "$cached_zip" 2>/dev/null \
    | /usr/bin/grep '/Contents/Info.plist$' \
    | /usr/bin/head -n 1 || true)"
  if [ -n "$plist_entry" ]; then
    cached_plist="$WORK_DIR/cached-update-${CACHED_ZIP_COUNT}.plist"
    /usr/bin/unzip -p "$cached_zip" "$plist_entry" > "$cached_plist" 2>/dev/null || true
    if /usr/bin/plutil -lint "$cached_plist" >/dev/null 2>&1; then
      run_and_record "Cached update bundle identifier" /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$cached_plist"
      run_and_record "Cached update version" /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$cached_plist"
    fi
  fi
done
shopt -u nullglob
if [ "$CACHED_ZIP_COUNT" -eq 0 ]; then
  printf 'No cached update ZIP was found.\n' >> "$REPORT_FILE"
fi

SHIPIT_LOG_COUNT=0
if [ -s "$CACHE_PATHS_FILE" ]; then
  while IFS= read -r cache_dir; do
    case "$cache_dir" in
      *ShipIt*) ;;
      *) continue ;;
    esac
    /usr/bin/find "$cache_dir" -type f \( -name '*.log' -o -name '*stderr*' -o -name '*stdout*' \) -print 2>/dev/null \
      | /usr/bin/head -n 20 \
      | while IFS= read -r shipit_log; do
          log_name="$(/usr/bin/basename "$shipit_log")"
          safe_name="$(printf '%s' "$log_name" | /usr/bin/tr -c 'A-Za-z0-9._-' '_')"
          redact_stream < "$shipit_log" > "$PACKAGE_DIR/shipit-logs/${safe_name}" 2>/dev/null || true
        done
  done < "$CACHE_PATHS_FILE"
fi
SHIPIT_LOG_COUNT="$(/usr/bin/find "$PACKAGE_DIR/shipit-logs" -type f | /usr/bin/wc -l | /usr/bin/tr -d ' ')"

section "Recent Synapse updater log events"
SYNAPSE_LOG_DIR="$HOME/Library/Application Support/Synapse/logs"
if [ -d "$SYNAPSE_LOG_DIR" ]; then
  log_index=0
  /bin/ls -1t "$SYNAPSE_LOG_DIR"/*.log 2>/dev/null \
    | /usr/bin/head -n 5 \
    | while IFS= read -r synapse_log; do
        log_index=$((log_index + 1))
        output_log="$PACKAGE_DIR/synapse-update-logs/update-events-${log_index}.log"
        /usr/bin/grep -Ei \
          'main:updater|bootstrap\.before-quit|Squirrel|ShipIt|update downloaded|Installing downloaded update|Update install' \
          "$synapse_log" 2>/dev/null \
          | redact_stream > "$output_log" || true
        if [ ! -s "$output_log" ]; then
          rm -f "$output_log"
        fi
      done
  printf 'source_log_directory_present=yes\n' >> "$REPORT_FILE"
  printf 'filtered_log_files=%s\n' \
    "$(/usr/bin/find "$PACKAGE_DIR/synapse-update-logs" -type f | /usr/bin/wc -l | /usr/bin/tr -d ' ')" \
    >> "$REPORT_FILE"
else
  printf 'source_log_directory_present=no\n' >> "$REPORT_FILE"
fi

echo "Checking update service connectivity..."
section "Update service connectivity"
if /usr/bin/curl -fsSIL --connect-timeout 10 --max-time 20 "$UPDATE_FEED_URL" \
  > "$PACKAGE_DIR/network/latest-mac-headers.txt" 2>&1; then
  FEED_REACHABLE="yes"
else
  FEED_REACHABLE="no"
fi
if /usr/bin/curl -fsSL --connect-timeout 10 --max-time 20 "$UPDATE_FEED_URL" \
  > "$PACKAGE_DIR/network/latest-mac.yml" 2> "$PACKAGE_DIR/network/latest-mac-error.txt"; then
  printf 'feed_reachable=yes\n' >> "$REPORT_FILE"
  rm -f "$PACKAGE_DIR/network/latest-mac-error.txt"
else
  printf 'feed_reachable=no\n' >> "$REPORT_FILE"
fi

section "Recent macOS ShipIt events"
/usr/bin/log show --last 24h --style compact \
  --predicate 'process == "ShipIt" OR (process == "Synapse" AND (eventMessage CONTAINS[c] "update" OR eventMessage CONTAINS[c] "Squirrel"))' \
  2>&1 | /usr/bin/tail -n 3000 | redact_stream > "$PACKAGE_DIR/shipit-unified.log" || true
printf 'unified_log_collected=%s\n' "$(yes_no test -s "$PACKAGE_DIR/shipit-unified.log")" >> "$REPORT_FILE"

LATEST_INSTALL_ISO="$(/usr/bin/find "$PACKAGE_DIR/synapse-update-logs" -type f -exec \
  /usr/bin/grep -h 'Installing downloaded update' {} + 2>/dev/null \
  | /usr/bin/sed -nE 's/^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})\..*$/\1/p' \
  | /usr/bin/sort \
  | /usr/bin/tail -n 1)"
if [ -n "$LATEST_INSTALL_ISO" ]; then
  LATEST_INSTALL_EPOCH="$(/bin/date -j -u -f '%Y-%m-%dT%H:%M:%S' "$LATEST_INSTALL_ISO" '+%s' 2>/dev/null || printf '0')"
else
  LATEST_INSTALL_EPOCH=0
fi

SHIPIT_ERROR_FOUND="no"
SHIPIT_SUCCESS_FOUND="no"
if evidence_after_latest_install \
  'Installation completed successfully|Successfully launched application' \
  "$PACKAGE_DIR/shipit-logs" "$PACKAGE_DIR/shipit-unified.log"; then
  SHIPIT_SUCCESS_FOUND="yes"
fi
if evidence_after_latest_install \
  'permission denied|operation not permitted|not writable|ShipIt status [1-9][0-9]*|installation (failed|failure|error)|code signature.*(failed|invalid)|couldn.t move bundle|couldn.t install|could not launch' \
  "$PACKAGE_DIR/shipit-logs" "$PACKAGE_DIR/shipit-unified.log"; then
  SHIPIT_ERROR_FOUND="yes"
fi

if [ -f "$0" ]; then
  /bin/cp "$0" "$PACKAGE_DIR/$(/usr/bin/basename "$0")" 2>/dev/null || true
fi

cat > "$SUMMARY_FILE" <<EOF
Synapse Update Diagnostics Summary
Generated: $(date '+%Y-%m-%d %H:%M:%S %z')

Synapse applications found: $APP_COUNT
Primary /Applications copy found: $PRIMARY_APP_FOUND
Current user is an administrator: $USER_IS_ADMIN
Primary app writable: $PRIMARY_APP_WRITABLE
Primary app Contents writable: $PRIMARY_CONTENTS_WRITABLE
/Applications writable: $PRIMARY_PARENT_WRITABLE
Primary app signature valid: $PRIMARY_SIGNATURE_VALID
Cached update ZIP files: $CACHED_ZIP_COUNT
ShipIt log files collected: $SHIPIT_LOG_COUNT
Latest install request: ${LATEST_INSTALL_ISO:-not found}
ShipIt error evidence found: $SHIPIT_ERROR_FOUND
ShipIt success evidence found: $SHIPIT_SUCCESS_FOUND
Update feed reachable: $FEED_REACHABLE
EOF

{
  printf '\nAssessment:\n'
  if [ "$PRIMARY_APP_FOUND" = "no" ]; then
    printf -- '- /Applications/Synapse.app was not found. Check for duplicate or nonstandard installations.\n'
  elif [ "$PRIMARY_SIGNATURE_VALID" = "no" ]; then
    printf -- '- The installed application signature is invalid. Squirrel.Mac will reject or fail the update.\n'
  elif [ "$PRIMARY_APP_WRITABLE" = "no" ] && [ "$PRIMARY_PARENT_WRITABLE" = "no" ]; then
    printf -- '- High probability: this account cannot replace Synapse.app or write to /Applications. A privileged ShipIt installation is required.\n'
  elif [ "$SHIPIT_ERROR_FOUND" = "yes" ]; then
    printf -- '- ShipIt recorded an error. See shipit-logs and shipit-unified.log for the exact failure.\n'
  elif [ "$SHIPIT_SUCCESS_FOUND" = "yes" ]; then
    printf -- '- ShipIt reports that its most recent recorded installation and relaunch completed successfully.\n'
  else
    printf -- '- No single cause was proven by the preflight checks. Review report.txt and ShipIt logs.\n'
  fi
  if [ "$APP_COUNT" -gt 1 ]; then
    printf -- '- Multiple Synapse application copies were found. The user may be reopening a different copy.\n'
  fi
} >> "$SUMMARY_FILE"

/bin/cp "$SUMMARY_FILE" "$FINAL_SUMMARY"
if ! /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$FINAL_ZIP"; then
  echo "Failed to create diagnostic ZIP. Temporary files were not preserved."
  exit 1
fi

echo
echo "Diagnostics complete. Files created on the Desktop:"
echo "  $FINAL_SUMMARY"
echo "  $FINAL_ZIP"
echo
echo "Please send the ZIP file back to the Synapse support team."
if [ -t 0 ]; then
  /usr/bin/open -R "$FINAL_ZIP" 2>/dev/null || true
  printf 'Press Return to close this window... '
  read -r _unused
fi
