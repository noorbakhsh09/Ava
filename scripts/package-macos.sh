#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_APP="$PROJECT_ROOT/node_modules/electron/dist/Electron.app"
RELEASE_DIR="$PROJECT_ROOT/release"
SOURCE_ICON="$PROJECT_ROOT/resources/ava-dock-icon.png"
PACKAGE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/ava-package.XXXXXX")"
APP_BUNDLE="$PACKAGE_TMP/Ava Agent.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_SOURCE="$APP_RESOURCES/app"
ICONSET="$PACKAGE_TMP/Ava.iconset"
DMG_ROOT="$PACKAGE_TMP/dmg"
VERSION="$(bun -e 'import packageJson from "./package.json"; console.log(packageJson.version)' --cwd "$PROJECT_ROOT")"
ARCH="$(uname -m)"
DMG_PATH="$RELEASE_DIR/Ava-Agent-${VERSION}-${ARCH}.dmg"

cleanup() {
  rm -rf "$PACKAGE_TMP"
}
trap cleanup EXIT

if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "Electron.app is missing. Run bun install first." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Ava icon is missing: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR" "$ICONSET" "$DMG_ROOT"

make_icon() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$SOURCE_ICON" --out "$ICONSET/$name" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
make_icon 1024 icon_512x512@2x.png
bun "$PROJECT_ROOT/scripts/png-to-icns.ts" "$ICONSET" "$PACKAGE_TMP/ava.icns"

ditto "$ELECTRON_APP" "$APP_BUNDLE"
rm -f "$APP_RESOURCES/default_app.asar"
mkdir -p "$APP_SOURCE"
ditto "$PROJECT_ROOT/out" "$APP_SOURCE/out"
ditto "$PROJECT_ROOT/prisma" "$APP_SOURCE/prisma"
ditto "$PROJECT_ROOT/resources" "$APP_SOURCE/resources"
cp "$PROJECT_ROOT/package.json" "$PROJECT_ROOT/prisma.config.ts" "$PROJECT_ROOT/bun.lock" "$APP_SOURCE/"
cp "$PACKAGE_TMP/ava.icns" "$APP_RESOURCES/ava.icns"

mv "$APP_CONTENTS/MacOS/Electron" "$APP_CONTENTS/MacOS/Ava Agent"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Ava Agent" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Ava Agent" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Ava Agent" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier dev.avaagent.desktop" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile ava.icns" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP_CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :ElectronAsarIntegrity" "$APP_CONTENTS/Info.plist" 2>/dev/null || true

codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

ditto "$APP_BUNDLE" "$DMG_ROOT/Ava Agent.app"
ln -s /Applications "$DMG_ROOT/Applications"
rm -f "$DMG_PATH"
hdiutil create \
  -volname "Ava Agent" \
  -srcfolder "$DMG_ROOT" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  "$DMG_PATH" >/dev/null

echo "$DMG_PATH"
