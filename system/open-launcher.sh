#!/bin/bash
# Opens the Pioneer TV launcher in the running Chromium through its DevTools
# port, then closes the blank start tab. Used by start-chromium.sh because
# Chromium refuses chrome-extension:// URLs on its command line and the
# extension's own navigation can lose a race with startup on a slow Pi.
#   open-launcher.sh <port> <extension-id> [timeout-seconds]
set -u
PORT=${1:-9222}
EXT_ID=${2:-dpigdefepjjejbkidlabpjlnleidgjaf}
TIMEOUT=${3:-90}
URL="chrome-extension://$EXT_ID/launcher/index.html"
BASE="http://127.0.0.1:$PORT"

log() { echo "open-launcher: $*"; }

# 1. Wait for the DevTools port.
for ((i = 0; i < TIMEOUT * 2; i++)); do
  curl -s -m 1 "$BASE/json/version" > /dev/null 2>&1 && break
  sleep 0.5
done
curl -s -m 2 "$BASE/json/version" > /dev/null 2>&1 || { log "DevTools port $PORT never answered"; exit 1; }

# 2. Give the browser a moment to create its first tab, then open the launcher.
sleep 2
for attempt in 1 2 3 4 5 6; do
  if curl -s -m 5 "$BASE/json" | grep -q "\"url\": \"$URL"; then
    log "launcher is open"
    break
  fi
  log "opening launcher (attempt $attempt)"
  curl -s -m 10 -X PUT "$BASE/json/new?$URL" > /dev/null
  sleep 3
done

# 3. Close blank tabs left behind, then activate the launcher so it has
#    keyboard focus (a tab opened via DevTools starts unfocused).
python3 - "$BASE" "$URL" <<'PY'
import json, sys, urllib.request
base, url = sys.argv[1], sys.argv[2]
try:
    pages = [p for p in json.load(urllib.request.urlopen(base + "/json", timeout=5)) if p.get("type") == "page"]
except Exception as exc:
    print("open-launcher: could not list pages:", exc); sys.exit(0)
have_launcher = any(p.get("url", "").startswith(url) for p in pages)
for p in pages:
    u = p.get("url", "")
    if have_launcher and (u in ("about:blank", "") or u.startswith("chrome://newtab") or u.startswith("chrome-error://")):
        try:
            urllib.request.urlopen(base + "/json/close/" + p["id"], timeout=5).read()
            print("open-launcher: closed", u or "(empty)")
        except Exception as exc:
            print("open-launcher: close failed:", exc)
for p in pages:
    if p.get("url", "").startswith(url):
        try:
            urllib.request.urlopen(base + "/json/activate/" + p["id"], timeout=5).read()
            print("open-launcher: activated launcher tab")
        except Exception as exc:
            print("open-launcher: activate failed:", exc)
        break
print("open-launcher:", "done" if have_launcher else "launcher not open")
PY
