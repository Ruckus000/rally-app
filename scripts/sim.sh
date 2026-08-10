#!/usr/bin/env bash
#
# Boot a simulator and launch the standalone Rally build on it.
#
#   scripts/sim.sh            launch the already-installed app
#   scripts/sim.sh --build    rebuild Release first, then install and launch
#
# The Release build embeds main.jsbundle, so nothing here needs Metro running.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

BUNDLE_ID="app.rally.weekspine"
APP="$ROOT/ios/build-release/Build/Products/Release-iphonesimulator/Rally.app"
# The design is drawn at 402x874 — iPhone 16 Pro matches it exactly.
DEVICE_NAME="${RALLY_SIM:-iPhone 16 Pro}"

say() { printf '\033[1;32m▸\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

[ -d ios ] || die "No ios/ folder. Run: npx expo prebuild --platform ios"

# Resolve to a UDID first: several runtimes can share a device name, and
# xcodebuild refuses an ambiguous -destination.
UDID=$(xcrun simctl list devices available \
  | grep -F "$DEVICE_NAME (" \
  | head -1 \
  | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$UDID" ] || die "No simulator named '$DEVICE_NAME'. Set RALLY_SIM to one from: xcrun simctl list devices available"

if [ "${1:-}" = "--build" ] || [ ! -d "$APP" ]; then
  # Always run: a newly added native dependency needs linking, and pod install
  # is cheap once the spec repo is cached.
  say "Installing pods"
  (cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install)
  say "Building Release (a few minutes the first time)"
  (cd ios && LANG=en_US.UTF-8 xcodebuild \
    -workspace Rally.xcworkspace \
    -scheme Rally \
    -configuration Release \
    -sdk iphonesimulator \
    -destination "id=$UDID" \
    -derivedDataPath build-release \
    ONLY_ACTIVE_ARCH=YES \
    -quiet)
fi

[ -d "$APP" ] || die "Build produced no app at $APP"

if ! xcrun simctl list devices | grep -F "$UDID" | grep -q Booted; then
  say "Booting $DEVICE_NAME"
  xcrun simctl boot "$UDID"
fi

open -a Simulator
say "Installing"
# Terminate first: launching an already-running app just foregrounds the old
# process, so a rebuild would appear not to have taken.
xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP"
say "Launching"
xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null

say "Rally is running on $DEVICE_NAME. No Metro needed."
