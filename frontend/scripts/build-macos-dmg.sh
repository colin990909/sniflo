#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${FRONTEND_DIR}/.." && pwd)"
TARGET_DMG_DIR="${ROOT_DIR}/target/release/bundle/dmg"
DIST_DIR="${ROOT_DIR}/dist"
DMG_GLOB='*_x64.dmg'
ICON_SIZE=96
TEXT_SIZE=14
APP_X=210
APP_Y=205
APPLICATIONS_X=550
APPLICATIONS_Y=205
SKIP_BUILD=0

cleanup() {
  if [[ -n "${MOUNT_DEV:-}" ]]; then
    hdiutil detach "${MOUNT_DEV}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${TEMP_RW_DMG:-}" && -f "${TEMP_RW_DMG}" ]]; then
    rm -f "${TEMP_RW_DMG}"
  fi
  if [[ -n "${TEMP_FINAL_DMG:-}" && -f "${TEMP_FINAL_DMG}" ]]; then
    rm -f "${TEMP_FINAL_DMG}"
  fi
  if [[ -n "${APPLE_SCRIPT:-}" && -f "${APPLE_SCRIPT}" ]]; then
    rm -f "${APPLE_SCRIPT}"
  fi
}

trap cleanup EXIT

if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
fi

cd "${FRONTEND_DIR}"
if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  npx tauri build --bundles dmg
fi

DMG_PATH="$(find "${TARGET_DMG_DIR}" -maxdepth 1 -type f -name "${DMG_GLOB}" | sort | tail -n 1)"
if [[ -z "${DMG_PATH}" ]]; then
  echo "Could not find built DMG in ${TARGET_DMG_DIR}" >&2
  exit 1
fi

TEMP_RW_DMG="$(mktemp "/tmp/sniflo-dmg-rw.XXXXXX.dmg")"
TEMP_FINAL_DMG="$(mktemp "/tmp/sniflo-dmg-final.XXXXXX.dmg")"
hdiutil convert "${DMG_PATH}" -format UDRW -ov -o "${TEMP_RW_DMG}" >/dev/null

MOUNT_OUT="$(hdiutil attach -mountrandom /Volumes -readwrite -noverify -noautoopen -nobrowse "${TEMP_RW_DMG}")"
MOUNT_DEV="$(printf '%s\n' "${MOUNT_OUT}" | awk '/^\/dev\//{print $1}' | tail -n 1)"
MOUNT_DIR="$(printf '%s\n' "${MOUNT_OUT}" | awk '/\/Volumes\//{print substr($0, index($0, "/Volumes/"))}' | tail -n 1)"

if [[ -z "${MOUNT_DEV}" || -z "${MOUNT_DIR}" ]]; then
  echo "Failed to mount read-write DMG for post-processing" >&2
  exit 1
fi

APP_NAME="$(find "${MOUNT_DIR}" -maxdepth 1 -type d -name '*.app' -print | xargs -I{} basename "{}" | head -n 1)"
VOLUME_NAME="$(basename "${MOUNT_DIR}")"

if [[ -z "${APP_NAME}" ]]; then
  echo "Failed to locate app bundle inside ${MOUNT_DIR}" >&2
  exit 1
fi

APPLE_SCRIPT="$(mktemp "/tmp/sniflo-dmg-layout.XXXXXX.applescript")"
cat > "${APPLE_SCRIPT}" <<EOF
on run argv
  set volumeName to item 1 of argv
  set appName to item 2 of argv
  tell application "Finder"
    tell disk volumeName
      open
      tell container window
        set current view to icon view
        set toolbar visible to false
        set statusbar visible to false
        set the bounds to {10, 60, 770, 520}
      end tell

      set opts to the icon view options of container window
      tell opts
        set arrangement to not arranged
        set icon size to ${ICON_SIZE}
        set text size to ${TEXT_SIZE}
      end tell

      set position of item appName to {${APP_X}, ${APP_Y}}
      set position of item "Applications" to {${APPLICATIONS_X}, ${APPLICATIONS_Y}}
      set the extension hidden of item appName to true
      close
      open
      delay 1

      tell container window
        set toolbar visible to false
        set statusbar visible to false
        set the bounds to {10, 60, 770, 520}
      end tell
    end tell

    delay 2
  end tell
end run
EOF

/usr/bin/osascript "${APPLE_SCRIPT}" "${VOLUME_NAME}" "${APP_NAME}"
sleep 2

hdiutil detach "${MOUNT_DEV}" >/dev/null
unset MOUNT_DEV

hdiutil convert "${TEMP_RW_DMG}" -format UDZO -imagekey zlib-level=9 -ov -o "${TEMP_FINAL_DMG}" >/dev/null
mv "${TEMP_FINAL_DMG}" "${DMG_PATH}"

mkdir -p "${DIST_DIR}"
cp "${DMG_PATH}" "${DIST_DIR}/$(basename "${DMG_PATH}")"

echo "Customized DMG written to ${DMG_PATH}"
echo "Copied DMG to ${DIST_DIR}/$(basename "${DMG_PATH}")"
