#!/bin/bash
# Installs Pioneer TV on Raspberry Pi OS Bookworm (64-bit). Run as root from the repo:
#   sudo system/install.sh
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
TARGET=/opt/pioneer-tv
USER_NAME=${PIONEER_TV_USER:-pi}
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
BOOT=/boot/firmware
[ -d "$BOOT" ] || BOOT=/boot

if [ "${PIONEER_TV_SKIP_APT:-0}" != "1" ]; then
echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  weston seatd \
  v4l-utils \
  bluez \
  python3 python3-evdev python3-aiohttp \
  rsync git \
  fonts-noto-core
# Raspberry Pi OS ships its own Chromium build (with Widevine support) as
# chromium-browser; plain Debian calls it chromium.
apt-get install -y --no-install-recommends chromium-browser \
  || apt-get install -y --no-install-recommends chromium
# Nice to have; not present on every image.
for p in libwidevinecdm0 zram-tools fonts-noto-color-emoji; do
  apt-get install -y --no-install-recommends "$p" || echo "warning: $p not available, continuing"
done
fi

echo "== files"
mkdir -p "$TARGET" /etc/pioneer-tv "$HOME_DIR/.config"
rsync -a --delete "$REPO/extension/" "$TARGET/extension/"
rsync -a --delete "$REPO/daemon/" "$TARGET/daemon/"
rsync -a "$REPO/system/" "$TARGET/system/"
chmod +x "$TARGET/system/start-chromium.sh" "$TARGET/system/update.sh"
mkdir -p /var/lib/pioneer-tv
[ -f /etc/pioneer-tv/config.toml ] || cp "$REPO/daemon/config.example.toml" /etc/pioneer-tv/config.toml
[ -f /etc/pioneer-tv/chromium.env ] || cp "$REPO/system/chromium.env" /etc/pioneer-tv/chromium.env
cp "$REPO/system/weston.ini" "$HOME_DIR/.config/weston.ini"
chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR/.config"
cp "$REPO/system/99-pioneer-tv.rules" /etc/udev/rules.d/
cp "$REPO/system/pioneer-tv-daemon.service" "$REPO/system/pioneer-tv-weston.service" "$REPO/system/pioneer-tv-governor.service" /etc/systemd/system/

echo "$REPO" > /etc/pioneer-tv/repo

echo "== groups"
usermod -aG video,render,input,audio "$USER_NAME"

echo "== kernel / firmware"
grep -q '^dtoverlay=vc4-kms-v3d' "$BOOT/config.txt" || echo 'dtoverlay=vc4-kms-v3d' >> "$BOOT/config.txt"
grep -q '^disable_overscan=1' "$BOOT/config.txt" || echo 'disable_overscan=1' >> "$BOOT/config.txt"
if ! grep -q 'video=HDMI-A-1' "$BOOT/cmdline.txt"; then
  sed -i '1 s/$/ video=HDMI-A-1:1280x720@60D/' "$BOOT/cmdline.txt"
fi
# Bluetooth: Xbox controllers need ERTM off to pair.
echo 'options bluetooth disable_ertm=1' > /etc/modprobe.d/pioneer-tv-bluetooth.conf
# uinput at boot
echo uinput > /etc/modules-load.d/pioneer-tv.conf

echo "== performance"
if [ -f /etc/default/zramswap ]; then
  sed -i 's/^#\?PERCENT=.*/PERCENT=60/; s/^#\?ALGO=.*/ALGO=lz4/' /etc/default/zramswap
fi
echo 'vm.swappiness=100' > /etc/sysctl.d/90-pioneer-tv.conf

echo "== services"
systemctl daemon-reload
systemctl disable getty@tty1.service || true
systemctl set-default graphical.target
systemctl enable seatd bluetooth pioneer-tv-governor.service
systemctl enable zramswap 2>/dev/null || true
systemctl enable pioneer-tv-daemon.service pioneer-tv-weston.service

cat <<MSG

Pioneer TV installed to $TARGET.
  config:   /etc/pioneer-tv/config.toml
  chromium: /etc/pioneer-tv/chromium.env
Pair a gamepad with bluetoothctl (scan on / pair / trust / connect), then reboot.
MSG
