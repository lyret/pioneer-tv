"""Entry point: wires config, virtual input, gamepad, CEC, status and the server."""
from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import time

from . import __version__, config, settings, sysinfo
from .actions import Dispatcher
from .cec import Cec
from .gamepad import GamepadManager, MouseDriver
from .server import Server
from .virtual_input import VirtualInput

log = logging.getLogger("magictv")

STATUS_INTERVAL = 10.0


async def amain(cfg: dict) -> None:
    settings.apply_overlay(cfg)
    server: Server

    async def emit(msg: dict) -> None:
        await server.broadcast(msg)

    vinput = VirtualInput()
    cec = Cec(cfg, emit)
    dispatcher = Dispatcher(cfg, vinput, cec, emit)
    mouse = MouseDriver(cfg, vinput)

    async def on_command(msg: dict) -> None:
        if msg.get("type") == "cec":
            await dispatcher.cec_command(str(msg.get("command")))
        elif msg.get("type") == "key":
            vinput.tap(str(msg.get("key")), msg.get("modifiers"))
        else:
            log.debug("unknown command %s", msg)

    # ------------------------------------------------------------ status
    last_status: dict = {}
    status_lock = asyncio.Lock()
    status_at = 0.0

    def plex_url() -> str | None:
        for s in cfg.get("services", []):
            if s.get("id") == "plex" or "plex" in s.get("name", "").lower():
                return s.get("url")
        return None

    async def status(force: bool = False) -> dict:
        nonlocal status_at
        async with status_lock:
            if not force and last_status and time.monotonic() - status_at < 3:
                return last_status
            wifi, ts, ifaces, sysstat = await asyncio.gather(
                sysinfo.wifi_status(), sysinfo.tailscale_status(plex_url()), sysinfo.interfaces(), sysinfo.system_status()
            )
            batteries = sysinfo.gamepad_batteries()
            pads = [{"name": p.dev.name, "path": p.dev.path, "battery": batteries.get(p.dev.name)} for p in pads_mgr.pads()]
            last_status.clear()
            last_status.update({
                "type": "status",
                "wifi": wifi,
                "tailscale": ts,
                "interfaces": ifaces,
                "system": sysstat,
                "gamepads": pads,
                "keyboard_present": pads_mgr.keyboard_present,
                "cec": {"enabled": cec.enabled, "phys_addr": cec.phys_addr, "tv_power": cec.last_power},
                "version": __version__,
                "page": server.current_url,
            })
            status_at = time.monotonic()
            return last_status

    async def status_loop() -> None:
        while True:
            try:
                s = await status()
                await emit(s)
            except Exception as exc:
                log.warning("status failed: %s", exc)
            await asyncio.sleep(STATUS_INTERVAL)

    # ------------------------------------------------------------ hooks
    async def system_action(name: str) -> tuple[bool, str]:
        commands = {
            "restart_ui": ["systemctl", "restart", "magic-tv-weston"],
            "restart_daemon": ["systemctl", "restart", "magic-tv-daemon"],
            "reboot": ["systemctl", "reboot"],
            "shutdown": ["systemctl", "poweroff"],
            "update": ["/bin/bash", "-c", "REPO=$(cat /etc/magic-tv/repo) && git -C \"$REPO\" pull --ff-only && \"$REPO/system/install.sh\""],
            "tailscale_up": ["tailscale", "up"],
        }
        if name not in commands:
            return False, "unknown action"
        log.info("system action: %s", name)
        rc, out = await sysinfo.run(*commands[name], timeout=600 if name == "update" else 30)
        return rc == 0, out.strip()[-2000:]

    async def config_changed() -> None:
        log.info("settings updated")
        await emit({"type": "event", "name": "toast", "text": "Inställningar sparade", "icon": "✓"})

    server = Server(cfg, on_command, {
        "status": status,
        "last_status": lambda: last_status or None,
        "system_action": system_action,
        "cec": dispatcher.cec_command,
        "config_changed": config_changed,
    })

    async def on_gamepad_change(connected: bool, name: str) -> None:
        await emit({"type": "event", "name": "gamepad", "connected": connected, "device": name})
        if connected and cfg["cec"]["tv_on_gamepad_connect"]:
            try:
                if not (await cec.power_status()).startswith("on"):
                    await cec.tv_on()
            except Exception as exc:
                log.debug("tv on after gamepad connect failed: %s", exc)

    async def on_keyboard_change(present: bool) -> None:
        await emit({"type": "event", "name": "keyboard_present", "present": present})

    remote_map = cfg["cec"]["remote"]

    async def on_remote(ui_cmd: str, down: bool) -> None:
        action = remote_map.get(ui_cmd)
        if not action:
            log.debug("unmapped TV remote key %s", ui_cmd)
            return
        if down:
            await dispatcher.press(action)
        else:
            await dispatcher.release(action)

    pads_mgr = GamepadManager(cfg, dispatcher, mouse, on_gamepad_change, on_keyboard_change)

    await cec.setup()
    tasks = [
        asyncio.create_task(server.run(), name="server"),
        asyncio.create_task(pads_mgr.run(), name="gamepads"),
        asyncio.create_task(mouse.run(), name="mouse"),
        asyncio.create_task(cec.monitor(on_remote), name="cec-monitor"),
        asyncio.create_task(status_loop(), name="status"),
    ]

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    log.info("shutting down")
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    vinput.close()


def run() -> None:
    parser = argparse.ArgumentParser(prog="magictv", description="Magic TV daemon")
    parser.add_argument("-c", "--config", help="path to config.toml")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--version", action="version", version=__version__)
    args = parser.parse_args()

    cfg = config.load(args.config)
    level = "debug" if args.verbose else cfg["daemon"]["log_level"]
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO),
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    log.info("magictv %s, config %s", __version__, cfg["_path"] or "(defaults)")
    asyncio.run(amain(cfg))
