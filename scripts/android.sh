#!/usr/bin/env bash
#
# Boot an Android emulator and launch the standalone Rally build on it.
#
#   scripts/android.sh            launch the already-built APK
#   scripts/android.sh --build    rebuild the release APK first
#
# The release APK embeds index.android.bundle, so nothing here needs Metro.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

BUNDLE_ID="app.rally.weekspine"
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
if [ -z "${JAVA_HOME:-}" ] && /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
  JAVA_HOME=$(/usr/libexec/java_home -v 17)
  export JAVA_HOME
fi

say() { printf '\033[1;32m▸\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$ANDROID_HOME" ] || die "No Android SDK at $ANDROID_HOME. Set ANDROID_HOME."
[ -d android ] || die "No android/ folder. Run: npx expo prebuild --platform android"

if [ "${1:-}" = "--build" ] || [ ! -f "$APK" ]; then
  say "Building release APK (several minutes the first time)"
  (cd android && ./gradlew assembleRelease -q)
fi

[ -f "$APK" ] || die "Build produced no APK at $APK"

if ! adb devices | grep -q "device$"; then
  AVD="${RALLY_AVD:-$(emulator -list-avds | head -1)}"
  [ -n "$AVD" ] || die "No AVD found. Create one in Android Studio."
  say "Booting $AVD"
  nohup emulator -avd "$AVD" -no-boot-anim >/dev/null 2>&1 &
  say "Waiting for boot"
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi

say "Installing"
# Stop any running copy first, or the relaunch just foregrounds the old build.
adb shell am force-stop "$BUNDLE_ID" >/dev/null 2>&1 || true
adb install -r "$APK" >/dev/null
say "Launching"
adb shell monkey -p "$BUNDLE_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

say "Rally is running on Android. No Metro needed."
