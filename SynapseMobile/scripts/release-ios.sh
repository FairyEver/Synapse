#!/bin/bash
# Archive SynapseMobile and hand the build to App Store Connect.
#
#   scripts/release-ios.sh              # archive + export ipa only
#   scripts/release-ios.sh --upload     # archive + upload the next build
#   scripts/release-ios.sh --build 7 --upload
#
# The build number must be higher than every build already uploaded for this
# version, and App Store Connect is the only thing that knows what those are --
# asking it needs an API key this repo does not have. So the number used is
# remembered locally in build/last-build-number and only ever moves forward:
# each archive claims the next one, so an upload that fails retries on a fresh
# number instead of colliding with the same one forever. The project file keeps
# its checked-in value, because it is shared with other working copies and is
# not the record of what has shipped.
#
# The version is a different matter, and is not set here at all: it is shared
# with the desktop app, which is where it advances. See desktop_version() below.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$PROJECT_DIR/SynapseMobile.xcodeproj"
SCHEME="SynapseMobile"
EXPORT_OPTIONS="$PROJECT_DIR/ExportOptions.plist"
BUILD_DIR="$PROJECT_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/SynapseMobile.xcarchive"
COUNTER_FILE="$BUILD_DIR/last-build-number"
UPLOAD_LOG="$BUILD_DIR/upload.log"

# How many times to re-archive after App Store Connect rejects the number. One
# retry normally settles it, because the rejection names the version to beat.
UPLOAD_ATTEMPTS=3

BUILD_NUMBER=""
UPLOAD=false

while [ $# -gt 0 ]; do
  case "$1" in
    --upload) UPLOAD=true; shift ;;
    --build) BUILD_NUMBER="${2:?--build needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$BUILD_DIR"

# The highest number an archive on this working copy has been given. This is
# the real record; build/ is gitignored, so it is per working copy, which is
# what we want -- another checkout cannot know what this one has uploaded.
recorded_build() {
  local recorded=0
  if [ -f "$COUNTER_FILE" ]; then
    read -r recorded < "$COUNTER_FILE" || true
  fi
  [[ "$recorded" =~ ^[0-9]+$ ]] || recorded=0
  echo "$recorded"
}

# The checked-in value, used only as a floor for a working copy that has never
# archived here: a fresh clone, or one whose build/ was cleared.
project_build() {
  sed -n 's/.*CURRENT_PROJECT_VERSION = \([0-9]\{1,\}\);.*/\1/p' "$PROJECT/project.pbxproj" \
    | sort -n | tail -n 1
}

next_build() {
  local recorded project
  recorded="$(recorded_build)"
  project="$(project_build)"
  [ -n "$project" ] || project=0
  echo $(( (recorded > project ? recorded : project) + 1 ))
}

# The version the app must ship under. It is not this script's to choose: the
# iOS app carries the same number as the desktop release, so "v1.0.1" names one
# release of the product instead of two. desktop/package.json is the single
# source, and desktop's own release bumps it -- through the Xcode project as
# well, so the two are meant to be identical. Nothing here ever moves it; this
# script only increments the build number.
DESKTOP_PACKAGE="$PROJECT_DIR/../desktop/package.json"

desktop_version() {
  node -p "require('$DESKTOP_PACKAGE').version"
}

# What Xcode would actually put in the bundle: the checked-in build setting.
project_marketing() {
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -showBuildSettings 2>/dev/null \
    | awk -F' = ' '/ MARKETING_VERSION = /{print $2; exit}'
}

# Claim the number before archiving: that takes minutes, and a crash or a
# Ctrl-C in the middle must not hand the same number to the next run. Never
# move the record backwards, or a later run would pick a number already used.
record_build() {
  local recorded
  recorded="$(recorded_build)"
  if [ "$1" -ge "$recorded" ]; then
    printf '%s\n' "$1" > "$COUNTER_FILE"
  fi
}

archive() {
  rm -rf "$ARCHIVE_PATH"
  echo "==> archiving build $BUILD_NUMBER"
  xcodebuild archive \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE_PATH" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    -allowProvisioningUpdates \
    | tail -n 20
}

# The number App Store Connect says it already has, if this upload was refused
# for colliding with it. Apple's wording is the only handle we have on a value
# we otherwise cannot read.
rejected_build() {
  grep -o 'previously uploaded version: [^0-9]*[0-9]\{1,\}' "$UPLOAD_LOG" \
    | tail -n 1 \
    | grep -o '[0-9]\{1,\}$'
}

if [ -z "$BUILD_NUMBER" ]; then
  BUILD_NUMBER="$(next_build)"
fi

if ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "build number must be a whole number, got: $BUILD_NUMBER" >&2
  exit 2
fi

MARKETING_VERSION="$(desktop_version)"
PROJECT_MARKETING="$(project_marketing)"

# Both readers have to agree before anything is archived. A divergence means the
# number was moved by hand in one place and not the other, and the point of
# sharing it is that App Store Connect, the desktop manifest and the phone all
# mean the same release -- so stop rather than pick a winner.
if [ "$MARKETING_VERSION" != "$PROJECT_MARKETING" ]; then
  echo "版本号不一致：" >&2
  echo "  desktop/package.json          $MARKETING_VERSION" >&2
  echo "  SynapseMobile.xcodeproj       $PROJECT_MARKETING" >&2
  echo "iOS 的版本号跟着桌面端发版走（pnpm desktop:bump:commit:push 会同时改这两处），这里不单独改。" >&2
  exit 2
fi

# The export step re-signs with a distribution profile, which carries the
# production APNs entitlement. A development-signed build reaching testers
# would fail to receive pushes with no error anywhere, so say it out loud.
echo "SynapseMobile $MARKETING_VERSION ($BUILD_NUMBER)"
echo

# `-allowProvisioningUpdates` is what makes the export work without the
# Organizer. Automatic signing creates the App Store distribution certificate
# and profile through the account signed into Xcode; without the flag the
# export dies with "No profiles for 'com.liy.SynapseMobile' were found" even
# though archiving succeeded. Expect a one-time prompt the first time it runs
# on a new machine.
attempt=1
while :; do
  record_build "$BUILD_NUMBER"
  archive

  if [ "$UPLOAD" = true ]; then
    echo
    echo "==> uploading to App Store Connect (this is the outward-facing step)"
    # tee so the collision can be read back out of an output that is otherwise
    # trimmed to the last few lines.
    if xcodebuild -exportArchive \
         -archivePath "$ARCHIVE_PATH" \
         -exportOptionsPlist "$EXPORT_OPTIONS" \
         -exportPath "$BUILD_DIR/export" \
         -allowProvisioningUpdates 2>&1 | tee "$UPLOAD_LOG" | tail -n 20; then
      echo
      echo "uploaded. processing takes 10-30 minutes; the build then appears in TestFlight."
      echo "reminder: the phone now talks to the production APNs gateway, so the server needs"
      echo "APNS_USE_SANDBOX=false for pushes to arrive."
      break
    fi

    required="$(rejected_build || true)"
    if [ -n "$required" ] && [ "$attempt" -lt "$UPLOAD_ATTEMPTS" ]; then
      BUILD_NUMBER=$(( required + 1 ))
      attempt=$(( attempt + 1 ))
      echo
      echo "App Store Connect already has build $required; re-archiving as $BUILD_NUMBER"
      echo
      continue
    fi

    echo "upload failed; see $UPLOAD_LOG" >&2
    exit 1
  fi

  echo
  echo "==> exporting ipa without uploading"
  sed 's|<string>upload</string>|<string>export</string>|' "$EXPORT_OPTIONS" > "$BUILD_DIR/ExportOptions.export.plist"
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist "$BUILD_DIR/ExportOptions.export.plist" \
    -exportPath "$BUILD_DIR/export" \
    -allowProvisioningUpdates \
    | tail -n 20
  echo
  echo "ipa at $BUILD_DIR/export"
  break
done
