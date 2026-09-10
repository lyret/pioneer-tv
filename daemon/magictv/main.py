"""Entry point: wires config, virtual input, gamepad, CEC and the bridge."""
from __future__ import annotations

import argparse
import asyncio
import logging
import signal

from . import __version__, config
from .actions import Dispatcher
from .cec import Cec
from .gamepad import GamepadManager, MouseDriver
from .server import Server
from .virtual_input import VirtualInput

log = logging.getLogger("magictv")


async def amain(cfg: dict) -> None:
    server: Server
    cec: Cec

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

    server = Server(cfg, on_command)

    async def on_gamepad_change(connected: bool, name: str) -> None:
        await emit({"type": "event", "name": "gamepad", "connected": connected, "device": name})
        if connected and cfg["cec"]["tv_on_gamepad_connect"]:
            try:
                if not (await cec.power_status()).startswith("on"):
                    await cec.tv_on()
            except Exception as exc:
                log.debug("tv on after gamepad connect failed: %s", exc)

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

    pads = GamepadManager(cfg, dispatcher, mouse, on_gamepad_change)

    await cec.setup()
    tasks = [
        asyncio.create_task(server.run(), name="server"),
        asyncio.create_task(pads.run(), name="gamepads"),
        asyncio.create_task(mouse.run(), name="mouse"),
        asyncio.create_task(cec.monitor(on_remote), name="cec-monitor"),
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
