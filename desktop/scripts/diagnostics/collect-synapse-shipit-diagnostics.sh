#!/bin/bash

set -u
set -o pipefail
export LC_ALL=C

APP_BUNDLE_ID="com.fairyever.synapse"
APP_PATH="/Applications/Synapse.app"
SHIPIT_LABEL="${APP_BUNDLE_ID}.ShipIt"
UPDATE_FEED_URL="https://desktop.release.synapse.d2.pub/latest-mac.yml"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"

if [ "${1:-}" = "--help" ]; then
  printf '%s\n' \
    "Usage: bash collect-synapse-shipit-diagnostics.sh" \
    "" \
    "Collects read-only macOS ShipIt diagnostics and writes a ZIP to the Desktop." \
    "It does not start ShipIt, unload launchd jobs, delete caches, or restart Synapse." \
    "Run it as the affected user; do not use sudo."
  exit 0
fi

if [ "$#" -ne 0 ]; then
  echo "Unknown argument. Use --help for usage."
  exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This diagnostic script only supports macOS."
  exit 1
fi

if [ "$(/usr/bin/id -u)" -eq 0 ]; then
  echo "Do not run this script with sudo. Run it as the affected macOS user."
  exit 2
fi

DESKTOP_DIR="$(/usr/bin/osascript -e 'POSIX path of (path to desktop folder)' 2>/dev/null || true)"
DESKTOP_DIR="${DESKTOP_DIR%/}"
if [ -z "$DESKTOP_DIR" ] || [ ! -d "$DESKTOP_DIR" ]; then
  DESKTOP_DIR="$HOME/Desktop"
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/synapse-shipit-diagnostics.XXXXXX")"
PACKAGE_NAME="Synapse-ShipIt-diagnostics-${TIMESTAMP}"
PACKAGE_DIR="$WORK_DIR/$PACKAGE_NAME"
REPORT_FILE="$PACKAGE_DIR/report.txt"
SUMMARY_FILE="$PACKAGE_DIR/summary.txt"
COMMAND_OUTPUT="$WORK_DIR/command-output.txt"
FINAL_ZIP="$DESKTOP_DIR/${PACKAGE_NAME}.zip"
FINAL_SUMMARY="$DESKTOP_DIR/${PACKAGE_NAME}-summary.txt"
RECOVERY_STATE_SOURCE="$HOME/Library/Application Support/Synapse/data-v1/core.update-install-recovery.json"
SYNAPSE_LOG_DIR="$HOME/Library/Application Support/Synapse/logs"
UPDATER_CACHE_DIR="$HOME/Library/Caches/@synapsedesktop-updater"
SHIPIT_CACHE_DIR="$HOME/Library/Caches/$SHIPIT_LABEL"

cleanup() {
  /bin/rm -rf "$WORK_DIR"
}
trap cleanup EXIT

/bin/mkdir -p \
  "$PACKAGE_DIR/app-logs" \
  "$PACKAGE_DIR/cache" \
  "$PACKAGE_DIR/crash-reports" \
  "$PACKAGE_DIR/launchd" \
  "$PACKAGE_DIR/network" \
  "$PACKAGE_DIR/recovery-state" \
  "$PACKAGE_DIR/system-logs"

section() {
  printf '\n\n===== %s =====\n' "$1" >> "$REPORT_FILE"
}

redact_stream() {
  /usr/bin/sed -E \
    -e 's#/Users/[^/[:space:]]+#/Users/[redacted]#g' \
    -e 's#([?&](token|credential|code)=)[^&[:space:]]+#\1[redacted]#g' \
    -e 's#(Authorization[^:]*:[[:space:]]*)[^[:space:]]+#\1[redacted]#g'
}

run_and_record() {
  local label="$1"
  shift

  printf '\n--- %s ---\n' "$label" >> "$REPORT_FILE"
  "$@" > "$COMMAND_OUTPUT" 2>&1
  local status=$?
  redact_stream < "$COMMAND_OUTPUT" >> "$REPORT_FILE"
  printf '[exit_status=%s]\n' "$status" >> "$REPORT_FILE"
  return 0
}

capture_command() {
  local output_file="$1"
  shift

  "$@" > "$COMMAND_OUTPUT" 2>&1
  CAPTURE_STATUS=$?
  redact_stream < "$COMMAND_OUTPUT" > "$output_file"
  return 0
}

yes_no() {
  if "$@"; then
    printf 'yes'
  else
    printf 'no'
  fi
}

read_recovery_value() {
  /usr/bin/plutil -extract "$1" raw "$RECOVERY_STATE_SOURCE" 2>/dev/null || true
}

read_launchctl_value() {
  local key="$1"
  local source_file="$2"
  /usr/bin/awk -v prefix="$key = " '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (index(line, prefix) == 1) {
        print substr(line, length(prefix) + 1)
        exit
      }
    }
  ' "$source_file" 2>/dev/null || true
}

safe_count_files() {
  local target="$1"
  if [ ! -d "$target" ]; then
    printf '0'
    return
  fi
  /usr/bin/find -P "$target" -type f 2>/dev/null \
    | /usr/bin/wc -l \
    | /usr/bin/tr -d ' '
}

cat > "$REPORT_FILE" <<EOF
Synapse ShipIt Diagnostics
Generated: $(date '+%Y-%m-%d %H:%M:%S %z')
Bundle ID: $APP_BUNDLE_ID
ShipIt label: $SHIPIT_LABEL

This collection is read-only. It did not start ShipIt, unload launchd jobs,
delete caches, modify the application, or restart Synapse.
EOF

echo "Collecting Synapse ShipIt diagnostics..."
echo "This may take one or two minutes. Synapse and ShipIt will not be modified."

section "System and account"
run_and_record "macOS version" /usr/bin/sw_vers
run_and_record "Kernel and architecture" /usr/bin/uname -a
run_and_record "System Integrity Protection" /usr/bin/csrutil status
run_and_record "Disk space" /bin/df -h /Applications "$HOME/Library/Caches"
run_and_record "Current account" /usr/bin/id

UID_VALUE="$(/usr/bin/id -u)"
if /usr/bin/id -Gn | /usr/bin/tr ' ' '\n' | /usr/bin/grep -qx admin; then
  USER_IS_ADMIN="yes"
else
  USER_IS_ADMIN="no"
fi

section "Running processes"
SYNAPSE_PIDS="$(/usr/bin/pgrep -x Synapse 2>/dev/null || true)"
SHIPIT_PIDS="$(/usr/bin/pgrep -x ShipIt 2>/dev/null || true)"
printf 'synapse_running=%s\n' "$([ -n "$SYNAPSE_PIDS" ] && printf yes || printf no)" >> "$REPORT_FILE"
printf 'shipit_running=%s\n' "$([ -n "$SHIPIT_PIDS" ] && printf yes || printf no)" >> "$REPORT_FILE"
for process_id in $SYNAPSE_PIDS $SHIPIT_PIDS; do
  run_and_record "Process $process_id" /bin/ps -p "$process_id" -o pid=,ppid=,user=,state=,lstart=,etime=,comm=
done

section "Installed application"
APP_FOUND="no"
APP_VERSION="not found"
APP_SIGNATURE_VALID="unknown"
if [ -d "$APP_PATH" ]; then
  APP_FOUND="yes"
  APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist" 2>/dev/null || printf 'unknown')"
  run_and_record "Application ownership, flags, and ACL" /bin/ls -ldeO@ "$APP_PATH"
  run_and_record "Application Contents ownership, flags, and ACL" /bin/ls -ldeO@ "$APP_PATH/Contents"
  run_and_record "Application parent ownership, flags, and ACL" /bin/ls -ldeO@ "$(/usr/bin/dirname "$APP_PATH")"
  run_and_record "Application stat" /usr/bin/stat -f 'owner=%Su group=%Sg mode=%Sp flags=%Sf modified=%Sm' "$APP_PATH"
  run_and_record "Application bundle identifier" /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist"
  run_and_record "Application version" /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist"
  run_and_record "Application code signature details" /usr/bin/codesign -dv --verbose=4 "$APP_PATH"
  if /usr/bin/codesign --verify --deep --strict --verbose=4 "$APP_PATH" > "$COMMAND_OUTPUT" 2>&1; then
    APP_SIGNATURE_VALID="yes"
  else
    APP_SIGNATURE_VALID="no"
  fi
  redact_stream < "$COMMAND_OUTPUT" >> "$REPORT_FILE"
  printf 'application_signature_valid=%s\n' "$APP_SIGNATURE_VALID" >> "$REPORT_FILE"
  run_and_record "Gatekeeper assessment" /usr/sbin/spctl -a -vv -t exec "$APP_PATH"
  run_and_record "Application extended attributes" /usr/bin/xattr -l "$APP_PATH"
else
  printf 'Application not found at %s.\n' "$APP_PATH" >> "$REPORT_FILE"
fi

section "Bundled ShipIt executables"
SHIPIT_BINARY_COUNT=0
SHIPIT_BINARY_SIGNATURES_VALID="yes"
SHIPIT_BINARY_LIST="$WORK_DIR/shipit-binaries.txt"
if [ -d "$APP_PATH/Contents/Frameworks/Squirrel.framework" ]; then
  /usr/bin/find -P "$APP_PATH/Contents/Frameworks/Squirrel.framework" \
    \( -type f -o -type l \) -name ShipIt -print 2>/dev/null \
    | /usr/bin/awk 'NF && !seen[$0]++' > "$SHIPIT_BINARY_LIST"
fi
if [ ! -s "$SHIPIT_BINARY_LIST" ]; then
  printf 'No bundled ShipIt executable was found.\n' >> "$REPORT_FILE"
  SHIPIT_BINARY_SIGNATURES_VALID="no"
else
  while IFS= read -r shipit_binary; do
    [ -e "$shipit_binary" ] || continue
    SHIPIT_BINARY_COUNT=$((SHIPIT_BINARY_COUNT + 1))
    run_and_record "ShipIt executable $SHIPIT_BINARY_COUNT" /bin/ls -leO@ "$shipit_binary"
    run_and_record "ShipIt executable type $SHIPIT_BINARY_COUNT" /usr/bin/file "$shipit_binary"
    run_and_record "ShipIt executable stat $SHIPIT_BINARY_COUNT" /usr/bin/stat -f 'owner=%Su group=%Sg mode=%Sp flags=%Sf size=%z modified=%Sm' "$shipit_binary"
    run_and_record "ShipIt executable hash $SHIPIT_BINARY_COUNT" /usr/bin/shasum -a 256 "$shipit_binary"
    run_and_record "ShipIt code signature details $SHIPIT_BINARY_COUNT" /usr/bin/codesign -dv --verbose=4 "$shipit_binary"
    if ! /usr/bin/codesign --verify --strict --verbose=4 "$shipit_binary" > "$COMMAND_OUTPUT" 2>&1; then
      SHIPIT_BINARY_SIGNATURES_VALID="no"
    fi
    redact_stream < "$COMMAND_OUTPUT" >> "$REPORT_FILE"
    run_and_record "ShipIt linked libraries $SHIPIT_BINARY_COUNT" /usr/bin/otool -L "$shipit_binary"
    run_and_record "ShipIt extended attributes $SHIPIT_BINARY_COUNT" /usr/bin/xattr -l "$shipit_binary"
  done < "$SHIPIT_BINARY_LIST"
fi

section "ShipIt launchd registration"
LAUNCHD_GUI_RAW="$WORK_DIR/launchd-gui.raw"
LAUNCHD_USER_RAW="$WORK_DIR/launchd-user.raw"
LAUNCHD_GUI_FILE="$PACKAGE_DIR/launchd/gui-service.txt"
LAUNCHD_USER_FILE="$PACKAGE_DIR/launchd/user-service.txt"

/bin/launchctl print "gui/${UID_VALUE}/${SHIPIT_LABEL}" > "$LAUNCHD_GUI_RAW" 2>&1
LAUNCHD_GUI_STATUS=$?
redact_stream < "$LAUNCHD_GUI_RAW" > "$LAUNCHD_GUI_FILE"
printf '\n--- GUI domain service ---\n' >> "$REPORT_FILE"
cat "$LAUNCHD_GUI_FILE" >> "$REPORT_FILE"
printf '[exit_status=%s]\n' "$LAUNCHD_GUI_STATUS" >> "$REPORT_FILE"

/bin/launchctl print "user/${UID_VALUE}/${SHIPIT_LABEL}" > "$LAUNCHD_USER_RAW" 2>&1
LAUNCHD_USER_STATUS=$?
redact_stream < "$LAUNCHD_USER_RAW" > "$LAUNCHD_USER_FILE"
printf '\n--- User domain service ---\n' >> "$REPORT_FILE"
cat "$LAUNCHD_USER_FILE" >> "$REPORT_FILE"
printf '[exit_status=%s]\n' "$LAUNCHD_USER_STATUS" >> "$REPORT_FILE"

capture_command "$PACKAGE_DIR/launchd/disabled-services.txt" /bin/launchctl print-disabled "gui/${UID_VALUE}"
printf '\n--- Disabled services containing Synapse or ShipIt ---\n' >> "$REPORT_FILE"
/usr/bin/grep -Ei 'synapse|shipit' "$PACKAGE_DIR/launchd/disabled-services.txt" >> "$REPORT_FILE" 2>/dev/null || printf 'No matching disabled service entry.\n' >> "$REPORT_FILE"
run_and_record "Squirrel direct Contents write preference" /usr/bin/defaults read "$APP_BUNDLE_ID" SquirrelMacEnableDirectContentsWrite

LAUNCHD_STATE="$(read_launchctl_value state "$LAUNCHD_GUI_RAW")"
LAUNCHD_RUNS="$(read_launchctl_value runs "$LAUNCHD_GUI_RAW")"
LAUNCHD_LAST_EXIT_CODE="$(read_launchctl_value 'last exit code' "$LAUNCHD_GUI_RAW")"
LAUNCHD_PID="$(read_launchctl_value pid "$LAUNCHD_GUI_RAW")"

section "Persisted update recovery state"
RECOVERY_STATE_PRESENT="no"
RECOVERY_ATTEMPTED_AT="not found"
RECOVERY_INSTALL_ATTEMPTS="not found"
RECOVERY_PHASE="not found"
RECOVERY_TARGET_VERSION="not found"
if [ -f "$RECOVERY_STATE_SOURCE" ]; then
  RECOVERY_STATE_PRESENT="yes"
  redact_stream < "$RECOVERY_STATE_SOURCE" > "$PACKAGE_DIR/recovery-state/core.update-install-recovery.json"
  cat "$PACKAGE_DIR/recovery-state/core.update-install-recovery.json" >> "$REPORT_FILE"
  RECOVERY_ATTEMPTED_AT="$(read_recovery_value 'singleton.pendingAttempt.attemptedAt')"
  RECOVERY_INSTALL_ATTEMPTS="$(read_recovery_value 'singleton.pendingAttempt.installAttempts')"
  RECOVERY_PHASE="$(read_recovery_value 'singleton.pendingAttempt.recoveryPhase')"
  RECOVERY_TARGET_VERSION="$(read_recovery_value 'singleton.pendingAttempt.targetVersion')"
  [ -n "$RECOVERY_ATTEMPTED_AT" ] || RECOVERY_ATTEMPTED_AT="not found"
  [ -n "$RECOVERY_INSTALL_ATTEMPTS" ] || RECOVERY_INSTALL_ATTEMPTS="not found"
  [ -n "$RECOVERY_PHASE" ] || RECOVERY_PHASE="not found"
  [ -n "$RECOVERY_TARGET_VERSION" ] || RECOVERY_TARGET_VERSION="not found"
else
  printf 'No persisted update recovery state was found.\n' >> "$REPORT_FILE"
fi

section "Updater and ShipIt cache state"
UPDATER_CACHE_PRESENT="$(yes_no test -d "$UPDATER_CACHE_DIR")"
SHIPIT_CACHE_PRESENT="$(yes_no test -d "$SHIPIT_CACHE_DIR")"
UPDATER_CACHE_FILES="$(safe_count_files "$UPDATER_CACHE_DIR")"
SHIPIT_CACHE_FILES="$(safe_count_files "$SHIPIT_CACHE_DIR")"
SHIPIT_CACHE_APP_ASAR_COUNT=0
OPEN_HANDLE_LINES=0

for cache_dir in "$UPDATER_CACHE_DIR" "$SHIPIT_CACHE_DIR"; do
  cache_name="$(/usr/bin/basename "$cache_dir")"
  if [ ! -d "$cache_dir" ]; then
    printf '\n--- Cache %s ---\nnot found\n' "$cache_name" >> "$REPORT_FILE"
    continue
  fi

  run_and_record "Cache root $cache_name" /bin/ls -ldeO@ "$cache_dir"
  run_and_record "Cache root stat $cache_name" /usr/bin/stat -f 'owner=%Su group=%Sg mode=%Sp flags=%Sf size=%z modified=%Sm' "$cache_dir"
  run_and_record "Cache root extended attributes $cache_name" /usr/bin/xattr -l "$cache_dir"
  run_and_record "Cache disk usage $cache_name" /usr/bin/du -sk "$cache_dir"

  cache_listing="$PACKAGE_DIR/cache/${cache_name}-tree.txt"
  /usr/bin/find -P "$cache_dir" -print 2>/dev/null \
    | /usr/bin/head -n 1000 \
    | while IFS= read -r cache_path; do
        /usr/bin/stat -f 'path=%N type=%HT owner=%Su group=%Sg mode=%Sp flags=%Sf size=%z modified=%Sm' "$cache_path" 2>&1 || true
      done \
    | redact_stream > "$cache_listing"
  cat "$cache_listing" >> "$REPORT_FILE"

  plist_index=0
  while IFS= read -r plist_path; do
    [ -f "$plist_path" ] || continue
    plist_index=$((plist_index + 1))
    run_and_record "Cache plist $cache_name/$plist_index" /usr/bin/plutil -p "$plist_path"
  done < <(/usr/bin/find -P "$cache_dir" -type f -name '*.plist' -print 2>/dev/null | /usr/bin/head -n 20)
done

APP_ASAR_LIST="$WORK_DIR/cache-app-asar.txt"
if [ -d "$SHIPIT_CACHE_DIR" ]; then
  /usr/bin/find -P "$SHIPIT_CACHE_DIR" -type f -name app.asar -print 2>/dev/null \
    | /usr/bin/head -n 20 > "$APP_ASAR_LIST"
  SHIPIT_CACHE_APP_ASAR_COUNT="$(/usr/bin/wc -l < "$APP_ASAR_LIST" | /usr/bin/tr -d ' ')"
fi

if [ -s "$APP_ASAR_LIST" ]; then
  section "Open handles on cached app.asar files"
  while IFS= read -r app_asar; do
    run_and_record "Open handles for cached app.asar" /usr/sbin/lsof -nP "$app_asar"
    handle_count="$(/usr/sbin/lsof -nP "$app_asar" 2>/dev/null | /usr/bin/tail -n +2 | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
    OPEN_HANDLE_LINES=$((OPEN_HANDLE_LINES + handle_count))
  done < "$APP_ASAR_LIST"
fi

section "Cached update archives"
CACHED_ZIP_COUNT=0
if [ -d "$UPDATER_CACHE_DIR/pending" ]; then
  shopt -s nullglob
  for cached_zip in "$UPDATER_CACHE_DIR/pending/"*.zip; do
    CACHED_ZIP_COUNT=$((CACHED_ZIP_COUNT + 1))
    run_and_record "Cached update ZIP $CACHED_ZIP_COUNT" /usr/bin/stat -f 'file=%N size=%z owner=%Su group=%Sg mode=%Sp flags=%Sf modified=%Sm' "$cached_zip"
    run_and_record "Cached update ZIP hash $CACHED_ZIP_COUNT" /usr/bin/openssl dgst -sha512 "$cached_zip"
    run_and_record "Cached update ZIP integrity $CACHED_ZIP_COUNT" /usr/bin/unzip -tqq "$cached_zip"
  done
  shopt -u nullglob
fi
if [ "$CACHED_ZIP_COUNT" -eq 0 ]; then
  printf 'No cached update ZIP was found.\n' >> "$REPORT_FILE"
fi

echo "Collecting recent Synapse and ShipIt logs..."
section "Recent application startup and updater logs"
FILTERED_APP_LOG_COUNT=0
if [ -d "$SYNAPSE_LOG_DIR" ]; then
  log_index=0
  /bin/ls -1t "$SYNAPSE_LOG_DIR"/*.log 2>/dev/null \
    | /usr/bin/head -n 30 \
    | while IFS= read -r synapse_log; do
        log_index=$((log_index + 1))
        output_log="$PACKAGE_DIR/app-logs/relevant-events-${log_index}.log"
        /usr/bin/grep -Ei -B 2 -A 12 \
          'main:(updater|update-install-recovery)|bootstrap\.(app-ready|main-window|before-quit)|renderer-health|ShipIt|Squirrel|Update install|Electron app is ready|Main window|Failed to initialize app|Service started in degraded state|Uncaught exception|Unhandled rejection' \
          "$synapse_log" 2>/dev/null \
          | redact_stream > "$output_log" || true
        if [ ! -s "$output_log" ]; then
          /bin/rm -f "$output_log"
        fi
      done
  FILTERED_APP_LOG_COUNT="$(/usr/bin/find "$PACKAGE_DIR/app-logs" -type f | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
  printf 'filtered_application_log_files=%s\n' "$FILTERED_APP_LOG_COUNT" >> "$REPORT_FILE"
else
  printf 'Synapse log directory was not found.\n' >> "$REPORT_FILE"
fi

capture_command "$PACKAGE_DIR/system-logs/shipit-and-updater.log" \
  /usr/bin/log show --last 24h --style compact --predicate \
  "process == \"ShipIt\" OR eventMessage CONTAINS[c] \"${SHIPIT_LABEL}\" OR (process == \"Synapse\" AND (eventMessage CONTAINS[c] \"ShipIt\" OR eventMessage CONTAINS[c] \"Squirrel\" OR eventMessage CONTAINS[c] \"update\"))"
SYSTEM_LOG_LINES="$(/usr/bin/wc -l < "$PACKAGE_DIR/system-logs/shipit-and-updater.log" | /usr/bin/tr -d ' ')"

section "Recent crash reports"
CRASH_REPORT_COUNT=0
CRASH_REPORT_LIST="$WORK_DIR/crash-reports.txt"
if [ -d "$HOME/Library/Logs/DiagnosticReports" ]; then
  /usr/bin/find "$HOME/Library/Logs/DiagnosticReports" -type f \
    \( -iname 'ShipIt*' -o -iname 'Synapse*' \) -mtime -7 -print 2>/dev/null \
    | /usr/bin/head -n 20 > "$CRASH_REPORT_LIST"
fi
if [ -s "$CRASH_REPORT_LIST" ]; then
  while IFS= read -r crash_report; do
    CRASH_REPORT_COUNT=$((CRASH_REPORT_COUNT + 1))
    crash_name="$(/usr/bin/basename "$crash_report" | /usr/bin/tr -c 'A-Za-z0-9._-' '_')"
    redact_stream < "$crash_report" > "$PACKAGE_DIR/crash-reports/$crash_name"
    printf 'Collected crash report: %s\n' "$crash_name" >> "$REPORT_FILE"
  done < "$CRASH_REPORT_LIST"
else
  printf 'No recent Synapse or ShipIt crash report was found.\n' >> "$REPORT_FILE"
fi

section "Update feed snapshot"
capture_command "$PACKAGE_DIR/network/latest-mac-headers.txt" \
  /usr/bin/curl -fsSIL --connect-timeout 10 --max-time 20 "$UPDATE_FEED_URL"
FEED_HEADERS_STATUS=$CAPTURE_STATUS
capture_command "$PACKAGE_DIR/network/latest-mac.yml" \
  /usr/bin/curl -fsSL --connect-timeout 10 --max-time 20 "$UPDATE_FEED_URL"
FEED_STATUS=$CAPTURE_STATUS
if [ "$FEED_STATUS" -eq 0 ]; then
  FEED_REACHABLE="yes"
else
  FEED_REACHABLE="no"
fi
printf 'feed_headers_exit_status=%s\nfeed_exit_status=%s\n' "$FEED_HEADERS_STATUS" "$FEED_STATUS" >> "$REPORT_FILE"

LAUNCHD_SERVICE_FOUND="no"
if [ "$LAUNCHD_GUI_STATUS" -eq 0 ]; then
  LAUNCHD_SERVICE_FOUND="yes"
fi

cat > "$SUMMARY_FILE" <<EOF
Synapse ShipIt Diagnostics Summary
Generated: $(date '+%Y-%m-%d %H:%M:%S %z')

Installed application found: $APP_FOUND
Installed application version: $APP_VERSION
Application signature valid: $APP_SIGNATURE_VALID
Bundled ShipIt executables found: $SHIPIT_BINARY_COUNT
Bundled ShipIt signatures valid: $SHIPIT_BINARY_SIGNATURES_VALID
Current user is an administrator: $USER_IS_ADMIN
Synapse process running: $([ -n "$SYNAPSE_PIDS" ] && printf yes || printf no)
ShipIt process running: $([ -n "$SHIPIT_PIDS" ] && printf yes || printf no)
ShipIt GUI launchd service found: $LAUNCHD_SERVICE_FOUND
ShipIt launchd state: ${LAUNCHD_STATE:-not found}
ShipIt launchd runs: ${LAUNCHD_RUNS:-not found}
ShipIt launchd last exit code: ${LAUNCHD_LAST_EXIT_CODE:-not found}
ShipIt launchd pid: ${LAUNCHD_PID:-not found}
Updater cache present: $UPDATER_CACHE_PRESENT
Updater cache files: $UPDATER_CACHE_FILES
ShipIt cache present: $SHIPIT_CACHE_PRESENT
ShipIt cache files: $SHIPIT_CACHE_FILES
Cached ShipIt app.asar files: $SHIPIT_CACHE_APP_ASAR_COUNT
Open handles on cached app.asar files: $OPEN_HANDLE_LINES
Cached update ZIP files: $CACHED_ZIP_COUNT
Persisted recovery state found: $RECOVERY_STATE_PRESENT
Pending install attempted at: $RECOVERY_ATTEMPTED_AT
Pending install attempts: $RECOVERY_INSTALL_ATTEMPTS
Pending recovery phase: $RECOVERY_PHASE
Pending target version: $RECOVERY_TARGET_VERSION
Filtered application log files: $FILTERED_APP_LOG_COUNT
ShipIt/system log lines: $SYSTEM_LOG_LINES
Recent crash reports: $CRASH_REPORT_COUNT
Update feed reachable: $FEED_REACHABLE
EOF

{
  printf '\nAssessment:\n'
  if [ "$APP_FOUND" = "no" ]; then
    printf -- '- Synapse.app is missing from /Applications.\n'
  elif [ "$APP_SIGNATURE_VALID" = "no" ]; then
    printf -- '- The installed Synapse application signature is invalid.\n'
  fi
  if [ "$SHIPIT_BINARY_COUNT" -eq 0 ]; then
    printf -- '- The installed application does not contain a ShipIt executable.\n'
  elif [ "$SHIPIT_BINARY_SIGNATURES_VALID" = "no" ]; then
    printf -- '- At least one bundled ShipIt executable failed signature verification.\n'
  fi
  if [ "$RECOVERY_PHASE" = "preparing" ] && [ "$SHIPIT_CACHE_APP_ASAR_COUNT" -gt 0 ]; then
    printf -- '- Recovery is still preparing while a partial app.asar remains in the ShipIt cache; cache cleanup may be stalled.\n'
  fi
  if [ "$OPEN_HANDLE_LINES" -gt 0 ]; then
    printf -- '- One or more processes hold an open handle to a cached app.asar; see report.txt.\n'
  fi
  if [ "$LAUNCHD_SERVICE_FOUND" = "no" ] && [ "$RECOVERY_TARGET_VERSION" != "not found" ] && [ "$APP_VERSION" != "$RECOVERY_TARGET_VERSION" ]; then
    printf -- '- No current ShipIt launchd job exists while the target version is not installed. Review system logs to determine whether ShipIt was never registered or was unloaded during recovery.\n'
  fi
  if [ "$LAUNCHD_LAST_EXIT_CODE" != "" ] && [ "$LAUNCHD_LAST_EXIT_CODE" != "0" ]; then
    printf -- '- ShipIt launchd reports a non-zero last exit code.\n'
  fi
  if [ "$APP_SIGNATURE_VALID" = "yes" ] \
    && [ "$SHIPIT_BINARY_SIGNATURES_VALID" = "yes" ] \
    && [ "$RECOVERY_PHASE" != "preparing" ] \
    && [ "$LAUNCHD_SERVICE_FOUND" = "no" ]; then
    printf -- '- Static checks are healthy and no ShipIt job is currently registered; use the collected logs for the install-time cause.\n'
  fi
} >> "$SUMMARY_FILE"

if [ -f "$0" ]; then
  /bin/cp "$0" "$PACKAGE_DIR/$(/usr/bin/basename "$0")" 2>/dev/null || true
fi

/bin/cp "$SUMMARY_FILE" "$FINAL_SUMMARY"
if ! /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$FINAL_ZIP"; then
  echo "Failed to create the diagnostic ZIP."
  exit 1
fi

echo
echo "Diagnostics complete. Files created on the Desktop:"
echo "  $FINAL_SUMMARY"
echo "  $FINAL_ZIP"
echo
echo "Please send the ZIP file back to the Synapse support team."
/usr/bin/open -R "$FINAL_ZIP" 2>/dev/null || true
