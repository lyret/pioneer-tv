#!/bin/bash
# Opens Chromium on the running Weston display with the extension loaded and
# chrome://extensions in front, so load errors are visible. Uses a throwaway
# profile; the kiosk instance keeps running underneath. Run as pi:
#   /opt/pioneer-tv/system/chromium-debug.sh
set -u
PIONEER_TV_DIR=${PIONEER_TV_DIR:-/opt/pioneer-tv}
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-1}
[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ] || WAYLAND_DISPLAY=wayland-0
BIN=$(command -v chromium-browser || command -v chromium)
PROFILE=$(mktemp -d /tmp/pioneer-tv-debug.XXXX)
echo "$($BIN --version)"
echo "extension: $PIONEER_TV_DIR/extension"
exec "$BIN" \
  --ozone-platform=wayland \
  --window-size=1280,720 \
  --user-data-dir="$PROFILE" \
  --load-extension="$PIONEER_TV_DIR/extension" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  --no-first-run --noerrdialogs --disable-infobars --password-store=basic \
  "chrome://extensions/" \
  2>&1 | grep -v -E "^\[.*(dbus|gbm|EGL)" 
