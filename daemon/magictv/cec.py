"""HDMI-CEC through the kernel CEC framework and `cec-ctl` (v4l-utils).

The Pi registers as a playback device. Volume keys are sent to the TV as
remote-control presses, so the TV's own speakers (or its ARC receiver) react.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Callable, Coroutine

log = logging.getLogger("magictv.cec")

RE_PHYS = re.compile(r"Physical Address\s*:\s*([0-9a-f.]+)", re.I)
RE_POWER = re.compile(r"pwr-state:\s*(\S+)", re.I)
RE_UI_CMD = re.compile(r"ui-cmd:\s*([a-z0-9-]+)", re.I)


class Cec:
    def __init__(self, cfg: dict, on_event: Callable[[dict], Coroutine]) -> None:
        self.cfg = cfg["cec"]
        self.enabled = self.cfg["enabled"]
        self.device = self.cfg["device"]
        self.tv = str(self.cfg["tv_address"])
        self.on_event = on_event
        self.phys_addr = "1.0.0.0"
        self._lock = asyncio.Lock()

    async def _ctl(self, *args: str, timeout: float = 4.0) -> str:
        if not self.enabled:
            return ""
        cmd = ["cec-ctl", "-d", self.device, "-s", *args]
        async with self._lock:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
            )
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout)
            except asyncio.TimeoutError:
                proc.kill()
                raise RuntimeError(f"cec-ctl timed out: {' '.join(args)}")
        text = out.decode(errors="replace")
        log.debug("cec-ctl %s -> rc=%s %s", " ".join(args), proc.returncode, text.strip()[:200])
        return text

    async def setup(self) -> None:
        if not self.enabled:
            log.info("CEC disabled in config")
            return
        try:
            out = await self._ctl("--playback", "--osd-name", self.cfg["osd_name"][:14])
            m = RE_PHYS.search(out)
            if m:
                self.phys_addr = m.group(1)
            log.info("CEC registered as playback device, physical address %s", self.phys_addr)
        except (FileNotFoundError, RuntimeError) as exc:
            log.error("CEC setup failed (%s); disabling CEC", exc)
            self.enabled = False

    async def to_tv(self, *args: str) -> str:
        return await self._ctl("--to", self.tv, *args)

    async def user_control(self, ui_cmd: str) -> None:
        await self.to_tv("--user-control-pressed", f"ui-cmd={ui_cmd}")
        await self.to_tv("--user-control-released")

    async def power_status(self) -> str:
        out = await self.to_tv("--give-device-power-status")
        m = RE_POWER.search(out)
        return m.group(1).lower() if m else "unknown"

    async def tv_on(self) -> None:
        await self.to_tv("--image-view-on")
        await self._ctl("--active-source", f"phys-addr={self.phys_addr}")

    async def tv_off(self) -> None:
        await self.to_tv("--standby")

    async def command(self, name: str) -> None:
        if name == "volume_up":
            await self.user_control("volume-up")
        elif name == "volume_down":
            await self.user_control("volume-down")
        elif name == "mute":
            await self.user_control("mute")
        elif name == "tv_on":
            await self.tv_on()
        elif name == "tv_off":
            await self.tv_off()
        elif name == "tv_toggle":
            status = await self.power_status()
            if status.startswith("on"):
                await self.tv_off()
            else:
                await self.tv_on()
        elif name == "active_source":
            await self._ctl("--active-source", f"phys-addr={self.phys_addr}")
        else:
            raise ValueError(f"unknown cec command {name!r}")

    async def monitor(self, remote_press: Callable[[str, bool], Coroutine]) -> None:
        """Follow TV messages: standby/wake, and remote keys forwarded to us."""
        if not self.enabled or not self.cfg["monitor"]:
            return
        while self.enabled:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "cec-ctl", "-d", self.device, "--monitor",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                pending_key: str | None = None
                assert proc.stdout
                while True:
                    raw = await proc.stdout.readline()
                    if not raw:
                        break
                    line = raw.decode(errors="replace").strip()
                    upper = line.upper()
                    if "STANDBY" in upper and "RECEIVED" in upper:
                        await self.on_event({"type": "event", "name": "tv", "power": "standby"})
                    elif ("IMAGE_VIEW_ON" in upper or "SET_STREAM_PATH" in upper or "ACTIVE_SOURCE" in upper) and "RECEIVED" in upper:
                        await self.on_event({"type": "event", "name": "tv", "power": "on"})
                    elif "USER_CONTROL_PRESSED" in upper:
                        pending_key = "?"
                    elif pending_key and (m := RE_UI_CMD.search(line)):
                        pending_key = m.group(1).lower()
                        await remote_press(pending_key, True)
                    elif "USER_CONTROL_RELEASED" in upper:
                        if pending_key and pending_key != "?":
                            await remote_press(pending_key, False)
                        pending_key = None
                await proc.wait()
            except FileNotFoundError:
                log.error("cec-ctl not found; CEC monitor off")
                return
            except asyncio.CancelledError:
                return
            except Exception as exc:
                log.warning("CEC monitor error: %s", exc)
            await asyncio.sleep(5)
