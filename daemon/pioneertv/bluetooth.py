"""Keep trusted gamepads connected.

Off by default: SteelSeries, Nintendo and 8BitDo pads all dial the host when
switched on, and a host that keeps paging them collides with that dial (seen
on a Stratus XL: connect, then drop within the same second). Enable only for
a pad that never dials in; then the daemon pages paired, trusted HID devices
that are not connected, once per interval.
"""
from __future__ import annotations

import asyncio
import logging
import re

from . import sysinfo

log = logging.getLogger("pioneertv.bluetooth")

HID_UUID = "00001124"
RE_DEVICE = re.compile(r"^Device ([0-9A-F:]{17}) (.*)$", re.M)


async def paired_hid_devices() -> list[dict]:
    rc, out = await sysinfo.run("bluetoothctl", "devices", "Paired", timeout=8)
    if rc != 0:
        rc, out = await sysinfo.run("bluetoothctl", "devices", timeout=8)
    devices = []
    for mac, name in RE_DEVICE.findall(out):
        _, info = await sysinfo.run("bluetoothctl", "info", mac, timeout=5)
        if HID_UUID not in info and "Gamepad" not in info and "Joystick" not in info:
            continue
        flags = {k: ("yes" in v) for k, v in re.findall(r"^\s*(Connected|Paired|Trusted): (\w+)$", info, re.M)}
        devices.append({"mac": mac, "name": name, **flags})
    return devices


async def reconnect_loop(cfg: dict, on_change=None) -> None:
    bt = cfg.get("bluetooth") or {}
    interval = float(bt.get("reconnect_interval", 20))
    if not bt.get("auto_connect", True):
        log.info("auto-connect dialing off (pads dial in themselves)")
        return
    await asyncio.sleep(5)
    while True:
        try:
            for d in await paired_hid_devices():
                if d.get("Connected") or not d.get("Trusted"):
                    continue
                log.debug("dialing %s (%s)", d["name"], d["mac"])
                rc, out = await sysinfo.run("bluetoothctl", "connect", d["mac"], timeout=15)
                if "Connection successful" in out:
                    log.info("connected %s", d["name"])
                    if on_change:
                        await on_change(True, d["name"])
        except Exception as exc:
            log.warning("reconnect loop: %s", exc)
        await asyncio.sleep(interval)
