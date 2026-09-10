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

echo "== packages"
apt-get update
apt-get install -y --no-install-recommends \
  weston seatd \
  chromium-browser libwidevinecdm0 \
  v4l-utils \
  bluez \
  python3 python3-evdev python3-aiohttp \
  zram-tools cpufrequtils \
  fonts-noto-core fonts-noto-color-emoji

echo "== files"
mkdir -p "$TARGET" /etc/pioneer-tv "$HOME_DIR/.config"
rsync -a --delete "$REPO/extension/" "$TARGET/extension/"
rsync -a --delete "$REPO/daemon/" "$TARGET/daemon/"
rsync -a "$REPO/system/" "$TARGET/system/"
chmod +x "$TARGET/system/start-chromium.sh"
[ -f /etc/pioneer-tv/config.toml ] || cp "$REPO/daemon/config.example.toml" /etc/pioneer-tv/config.toml
[ -f /etc/pioneer-tv/chromium.env ] || cp "$REPO/system/chromium.env" /etc/pioneer-tv/chromium.env
cp "$REPO/system/weston.ini" "$HOME_DIR/.config/weston.ini"
chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR/.config"
cp "$REPO/system/99-pioneer-tv.rules" /etc/udev/rules.d/
cp "$REPO/system/pioneer-tv-daemon.service" "$REPO/system/pioneer-tv-weston.service" /etc/systemd/system/

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
sed -i 's/^#\?PERCENT=.*/PERCENT=60/; s/^#\?ALGO=.*/ALGO=lz4/' /etc/default/zramswap || true
echo 'vm.swappiness=100' > /etc/sysctl.d/90-pioneer-tv.conf
echo 'GOVERNOR="performance"' > /etc/default/cpufrequtils

echo "== services"
systemctl daemon-reload
systemctl disable getty@tty1.service || true
systemctl set-default graphical.target
systemctl enable seatd zramswap cpufrequtils bluetooth
systemctl enable pioneer-tv-daemon.service pioneer-tv-weston.service

cat <<MSG

Pioneer TV installed to $TARGET.
  config:   /etc/pioneer-tv/config.toml
  chromium: /etc/pioneer-tv/chromium.env
Pair a gamepad with bluetoothctl (scan on / pair / trust / connect), then reboot.
MSG
