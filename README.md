# Magic TV

A Raspberry Pi 3 B+ TV box for a 32" TV: Cineasterna, SVT Play and Plex as
web pages in a kiosk Chromium on Weston, driven by a Bluetooth gamepad, with
HDMI-CEC for the TV's volume and power.

The box does not play video itself. Chromium does, with Raspberry Pi's Widevine
build for Cineasterna. Magic TV is everything around that:

| Part | What it does |
| --- | --- |
| `extension/` | Chromium extension: the launcher page, d-pad spatial navigation on any site, an on-screen keyboard for search, a quick menu and toasts. |
| `daemon/` | Python daemon: gamepad → virtual keyboard and mouse (uinput), HDMI-CEC volume and power, TV remote passthrough, WebSocket bridge to the extension. |
| `system/` | Weston kiosk config, Chromium start script, systemd units, udev rule and the install script. |

## Designing the launcher (no Pi needed)

Everything in `extension/` runs as plain files, so open

```
extension/launcher/index.html?tv=1
```

in Chrome. Arrow keys navigate, Enter selects, Escape goes back. `?tv=1` turns
on TV mode so Enter on the search field opens the on-screen keyboard. Edit
`launcher.css` (tokens at the top), `launcher.js` and `default-services.js`;
reload. The page is laid out on a 1280x720 canvas in `vw` units, so a laptop
window looks like the TV. Drop logos in `extension/launcher/logos/` and set
`logo` on a service to use them instead of the letter glyph.

To try the extension parts on real sites, load `extension/` as an unpacked
extension at `chrome://extensions` (developer mode). Then any page gets the
spatial navigation and the overlays, and these shortcuts work:

| Shortcut | Action |
| --- | --- |
| Ctrl+Alt+H | Launcher (home) |
| Ctrl+Alt+K | Toggle on-screen keyboard |
| Ctrl+Alt+M | Toggle quick menu |

The launcher is at `chrome-extension://dpigdefepjjejbkidlabpjlnleidgjaf/launcher/index.html`
(the ID is fixed by the key in the manifest).

## Gamepad mapping

| Button | Action |
| --- | --- |
| D-pad, left stick | Move focus (arrow keys) |
| A / Cross | Select (Enter) |
| B / Circle | Back (Escape) |
| X / Square | Play, pause (Space) |
| Y / Triangle | On-screen keyboard |
| L1, R1 | Browser back, forward |
| L2, R2 | TV volume down, up (CEC, repeats while held) |
| Right stick | Mouse pointer; click on the stick to left-click |
| Start | Quick menu |
| Select | Status toast; hold to toggle TV power |
| Guide / PS / Xbox | Home. Also wakes the TV and switches input when the pad connects |

All of it is in `/etc/magic-tv/config.toml` (see `daemon/config.example.toml`).
The TV remote works too: keys the TV forwards over CEC are mapped in `[cec.remote]`.

## Installing on the Pi

Raspberry Pi OS Lite, 64-bit, Bookworm, user `pi`, wired Ethernet.

```
git clone https://github.com/lyret/magic-tv.git
cd magic-tv
sudo system/install.sh
sudo reboot
```

The installer pulls in Weston, Chromium, Widevine, v4l-utils, BlueZ and the
Python deps, copies the repo to `/opt/magic-tv`, installs the systemd units,
forces a 720p mode, enables zram and the performance governor, and sets the
boot target to graphical. Pair the gamepad once:

```
bluetoothctl
  scan on
  pair <MAC>
  trust <MAC>
  connect <MAC>
```

Log in to Cineasterna and Plex once with the on-screen keyboard; the Chromium
profile in `~/.magic-tv/chromium` remembers the sessions.

### Useful commands

```
journalctl -fu magic-tv-daemon        # gamepad, CEC and bridge log
journalctl -fu magic-tv-weston        # Weston and Chromium output
sudo python3 -m magictv -v            # run the daemon in the foreground (from /opt/magic-tv/daemon)
cec-ctl -d /dev/cec0 --to 0 --standby # TV off, straight from the shell
vcgencmd get_throttled                # 0x0 means the TV's USB port is enough
```

## How it fits together

```
 gamepad ──evdev──▶ daemon ──uinput──▶ Weston ──▶ Chromium (kiosk, --load-extension)
                      │                              ├─ content scripts: spatial nav, keyboard, HUD
                      │◀────── ws://127.0.0.1:8765 ──┤  background: single tab, home, dev shortcuts
                      └──cec-ctl──▶ /dev/cec0 ──▶ TV   launcher page: services from config.toml
```

Navigation keys go through a virtual keyboard so every page, and Chromium
itself, sees ordinary key presses. Buttons that mean something to the shell
(home, menu, keyboard) go over the WebSocket as events. CEC is only ever
touched by the daemon.

## Performance notes for the Pi 3 B+

- 720p output is deliberate: players cap stream quality to the window size,
  and the Pi 3 cannot decode 1080p in a browser. Widevine content (Cineasterna)
  is always software decoded.
- Chromium's disk cache lives in RAM (`/dev/shm`). Never let the SD card sit
  in the playback path.
- Point Plex at your own server's `:32400/web` and set its streaming quality to
  720p so the server transcodes to H.264.
- Check `chrome://gpu` for "Video Decode: Hardware accelerated". If it is not,
  unprotected H.264 (SVT Play, Plex) is software decoded too.
- Weston has `watch=true` on the autolaunch: if Chromium dies, Weston exits and
  systemd restarts both, which is faster and cleaner than a hung browser.

## Verify these against the live sites

- Cineasterna's search URL in the service config is a guess. Search on the
  site once and copy the URL pattern into `search_url`.
- Plex Web's search route is `#!/search?query=` on current builds.
- SVT Play's is `/sok?q=`.
