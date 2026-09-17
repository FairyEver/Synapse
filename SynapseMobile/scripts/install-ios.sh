#!/bin/bash
# Build SynapseMobile from the working copy and install it on a connected phone.
#
#   scripts/install-ios.sh                          # the only connected device
#   scripts/install-ios.sh --device 李杨的iPhone     # by name, or by identifier
#
# This is the "look at it on the phone right now" path: Debug signing, built for
# one device, installed with devicectl. It is not the release path and produces
# nothing for App Store Connect -- see release-ios.sh for that.
#
# What it costs: a cable-installed build carries a sandbox APNs token while the
# server's gateway is pinned to production, so this build cannot receive push
# while it is installed. The token it registers is deleted server-side on the
# first rejected send, with only one line in the log, and it does not come back
# on its own -- reinstalling the TestFlight build and reopening the app is what
# restores it. That is the accepted price of a build to tune the UI against, and
# the gateway value is not to be moved to suit one.
#
# The build number this produces is the checked-in one, not the next release
# number: release-ios.sh is what raises that. The number printed at the end is
# exactly what the phone will show in the terminal title bar, so it can be read
# back off the screen to confirm which build is on the device.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$PROJECT_DIR/SynapseMobile.xcodeproj"
SCHEME="SynapseMobile"
BUILD_DIR="$PROJECT_DIR/build"
DERIVED="$BUILD_DIR/device"
APP="$DERIVED/Build/Products/Debug-iphoneos/SynapseMobile.app"
BUILD_LOG="$BUILD_DIR/device-install.log"

DEVICE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="${2:?--device needs a name or identifier}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# The devices devicectl can reach right now. `list devices` also names every
# device that is merely paired -- an iPad on a shelf, a phone in another room --
# and picking one of those fails at the install step, with a message about the
# tunnel rather than about the cable. Only the connected ones are candidates.
connected_devices() {
  local json status
  json="$(mktemp -t synapse-devices)"
  xcrun devicectl list devices --json-output "$json" >/dev/null
  # Read rather than require: mktemp picks its own extension, and node would
  # parse anything that is not `.json` as JavaScript.
  node -e '
    const devices = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices;
    for (const device of devices) {
      if (device.connectionProperties.tunnelState === "connected") {
        console.log(`${device.identifier}\t${device.deviceProperties.name}`);
      }
    }
  ' "$json"
  # Reported rather than swallowed: a failed listing prints nothing, and the
  # caller would read that silence as "nothing is plugged in" and send the user
  # to fetch a cable that was already in.
  status=$?
  rm -f "$json"
  return $status
}

if [ -z "$DEVICE" ]; then
  found="$(connected_devices)"
  count="$(printf '%s' "$found" | grep -c '^' || true)"
  if [ "${count:-0}" -eq 0 ]; then
    echo "没有连着的设备。把 iPhone 用数据线插上、解锁后重试。" >&2
    exit 1
  fi
  if [ "$count" -gt 1 ]; then
    echo "连着不止一台设备，用 --device 指明一台：" >&2
    printf '%s\n' "$found" | sed 's/^/  /' >&2
    exit 2
  fi
  DEVICE="${found%%	*}"
fi

mkdir -p "$BUILD_DIR"

echo "==> 为 $DEVICE 构建（Debug，开发签名）"
if ! xcodebuild build \
     -project "$PROJECT" \
     -scheme "$SCHEME" \
     -configuration Debug \
     -destination "platform=iOS,id=$DEVICE" \
     -allowProvisioningUpdates \
     -derivedDataPath "$DERIVED" \
     >"$BUILD_LOG" 2>&1; then
  echo "构建失败，最后几行：" >&2
  tail -n 30 "$BUILD_LOG" >&2
  echo "(完整输出：$BUILD_LOG)" >&2
  exit 1
fi

if [ ! -d "$APP" ]; then
  echo "构建结束了但没有产物：$APP" >&2
  exit 1
fi

echo "==> 安装到设备"
# The .app directory, not an ipa. devicectl cannot install an App Store signed
# build at all -- it dies on 0xe800801f, "Attempted to install a Beta profile
# without the proper entitlement" -- which is what `mobile:build` produces.
xcrun devicectl device install app --device "$DEVICE" "$APP"

version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist")"
build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Info.plist")"

echo
echo "已装好 SynapseMobile $version ($build)"
echo "终端页标题栏会显示「运行中 · $version ($build)」。"
echo "提醒：这是数据线开发包，收不到推送；要恢复就装回 TestFlight 再重开一次 App。"
