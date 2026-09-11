#!/bin/bash
# Launches Chromium in kiosk mode with the Pioneer TV extension.
# Started by Weston's autolaunch (see weston.ini). Edit /etc/pioneer-tv/chromium.env
# to add flags or change the profile location.
#
# GPU note: the Pi 3's VideoCore IV only offers OpenGL ES 2.0 and Chromium's
# compositor wants ES 3.0, so Chromium must be allowed to fall back to software
# drawing on its own. Never add --ignore-gpu-blocklist here on a Pi 3; the
# result is a grey screen that never paints. On a Pi 4/5 it can go in
# chromium.env as PIONEER_TV_CHROMIUM_FLAGS.
set -u

# Site overrides first, so they take effect below.
[ -f /etc/pioneer-tv/chromium.env ] && . /etc/pioneer-tv/chromium.env
PIONEER_TV_DIR=${PIONEER_TV_DIR:-/opt/pioneer-tv}
EXT_ID=dpigdefepjjejbkidlabpjlnleidgjaf
PROFILE=${PIONEER_TV_PROFILE:-$HOME/.pioneer-tv/chromium}
CACHE=${PIONEER_TV_CACHE:-/dev/shm/pioneer-tv-cache}   # RAM: the SD card must never be in the playback path
EXTRA_FLAGS=${PIONEER_TV_CHROMIUM_FLAGS:-}

LOG=${PIONEER_TV_CHROMIUM_LOG:-$HOME/.pioneer-tv/chromium.log}
mkdir -p "$PROFILE" "$CACHE" "$(dirname "$LOG")"
# Weston does not pass our output to the journal; keep the last run's log.
exec > "$LOG" 2>&1

# Clear "restore session" prompts left by hard power cuts.
for f in "$PROFILE/Default/Preferences"; do
  [ -f "$f" ] && sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$f"
done

BIN=${PIONEER_TV_CHROMIUM_BIN:-$(command -v chromium-browser || command -v chromium)}
DEVTOOLS_PORT=${PIONEER_TV_DEVTOOLS_PORT:-9222}   # 127.0.0.1 only; used to open the launcher
echo "pioneer-tv: $($BIN --version 2>/dev/null), extension $PIONEER_TV_DIR/extension ($(grep -o '"version": "[^"]*"' "$PIONEER_TV_DIR/extension/manifest.json")), extra flags: ${EXTRA_FLAGS:-none}"

# Open the launcher through the DevTools port once Chromium is up (see open-launcher.py).
python3 "$PIONEER_TV_DIR/system/open-launcher.py" "$DEVTOOLS_PORT" "$EXT_ID" 120 &

"$BIN" \
  --remote-debugging-port="$DEVTOOLS_PORT" \
  --ozone-platform=wayland \
  --kiosk \
  --window-size=1280,720 \
  --window-position=0,0 \
  --user-data-dir="$PROFILE" \
  --disk-cache-dir="$CACHE" \
  --disk-cache-size=200000000 \
  --load-extension="$PIONEER_TV_DIR/extension" \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI,MediaRouter,DisableLoadExtensionCommandLineSwitch \
  --autoplay-policy=no-user-gesture-required \
  --enable-accelerated-video-decode \
  --password-store=basic \
  --check-for-update-interval=31536000 \
  --lang=sv-SE \
  $EXTRA_FLAGS \
  "about:blank" &
CHROMIUM_PID=$!
# Exit when Chromium exits so Weston's autolaunch watch restarts everything.
wait "$CHROMIUM_PID"
