#!/bin/bash
# Archive SynapseMobile and hand the build to App Store Connect.
#
#   scripts/release-ios.sh --upload              # next build number, upload
#   scripts/release-ios.sh --build 7 --upload    # explicit build number
#   scripts/release-ios.sh                       # archive + export ipa only
#
# The build number is passed as a build-setting override rather than written
# back into the project file. Two reasons: the project is shared with other
# working copies, and an upload that fails should not leave a bumped version
# behind for the next run to trip over.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$PROJECT_DIR/SynapseMobile.xcodeproj"
SCHEME="SynapseMobile"
EXPORT_OPTIONS="$PROJECT_DIR/ExportOptions.plist"
BUILD_DIR="$PROJECT_DIR/build"

BUILD_NUMBER=""
UPLOAD=false

while [ $# -gt 0 ]; do
  case "$1" in
    --upload) UPLOAD=true; shift ;;
    --build) BUILD_NUMBER="${2:?--build needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

current_build() {
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -showBuildSettings 2>/dev/null \
    | awk -F' = ' '/ CURRENT_PROJECT_VERSION = /{print $2; exit}'
}

current_marketing() {
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -showBuildSettings 2>/dev/null \
    | awk -F' = ' '/ MARKETING_VERSION = /{print $2; exit}'
}

if [ -z "$BUILD_NUMBER" ]; then
  BUILD_NUMBER=$(( $(current_build) + 1 ))
fi

if ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "build number must be a whole number, got: $BUILD_NUMBER" >&2
  exit 2
fi

MARKETING_VERSION="$(current_marketing)"

# The export step re-signs with a distribution profile, which carries the
# production APNs entitlement. A development-signed build reaching testers
# would fail to receive pushes with no error anywhere, so say it out loud.
echo "SynapseMobile $MARKETING_VERSION ($BUILD_NUMBER)"
echo

ARCHIVE_PATH="$BUILD_DIR/SynapseMobile.xcarchive"
rm -rf "$ARCHIVE_PATH"

echo "==> archiving"
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  -allowProvisioningUpdates \
  | tail -n 20

# `-allowProvisioningUpdates` is what makes this work without the Organizer.
# Automatic signing creates the App Store distribution certificate and profile
# through the account signed into Xcode; without the flag the export dies with
# "No profiles for 'com.liy.SynapseMobile' were found" even though archiving
# succeeded. Expect a one-time prompt the first time it runs on a new machine.

if [ "$UPLOAD" = true ]; then
  echo
  echo "==> uploading to App Store Connect (this is the outward-facing step)"
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist "$EXPORT_OPTIONS" \
    -exportPath "$BUILD_DIR/export" \
    -allowProvisioningUpdates \
    | tail -n 20
  echo
  echo "uploaded. processing takes 10-30 minutes; the build then appears in TestFlight."
  echo "reminder: the phone now talks to the production APNs gateway, so the server needs"
  echo "APNS_USE_SANDBOX=false for pushes to arrive."
else
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
fi
