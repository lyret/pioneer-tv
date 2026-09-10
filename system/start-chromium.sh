#!/bin/bash
# Launches Chromium in kiosk mode with the Magic TV extension.
# Started by Weston's autolaunch (see weston.ini). Edit /etc/magic-tv/chromium.env
# to add flags or change the profile location.
set -u

MAGIC_TV_DIR=${MAGIC_TV_DIR:-/opt/magic-tv}
EXT_ID=dpigdefepjjejbkidlabpjlnleidgjaf
PROFILE=${MAGIC_TV_PROFILE:-$HOME/.magic-tv/chromium}
CACHE=${MAGIC_TV_CACHE:-/dev/shm/magic-tv-cache}   # RAM: the SD card must never be in the playback path
EXTRA_FLAGS=${MAGIC_TV_CHROMIUM_FLAGS:-}
[ -f /etc/magic-tv/chromium.env ] && . /etc/magic-tv/chromium.env

mkdir -p "$PROFILE" "$CACHE"

# Clear "restore session" prompts left by hard power cuts.
for f in "$PROFILE/Default/Preferences"; do
  [ -f "$f" ] && sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$f"
done

BIN=$(command -v chromium-browser || command -v chromium)

exec "$BIN" \
  --ozone-platform=wayland \
  --kiosk \
  --window-size=1280,720 \
  --window-position=0,0 \
  --user-data-dir="$PROFILE" \
  --disk-cache-dir="$CACHE" \
  --disk-cache-size=200000000 \
  --load-extension="$MAGIC_TV_DIR/extension" \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI,MediaRouter \
  --autoplay-policy=no-user-gesture-required \
  --enable-accelerated-video-decode \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --password-store=basic \
  --check-for-update-interval=31536000 \
  --lang=sv-SE \
  $EXTRA_FLAGS \
  "chrome-extension://$EXT_ID/launcher/index.html"
