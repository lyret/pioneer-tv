"""WebSocket bridge to the Chromium extension (localhost only)."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable, Coroutine

import websockets

log = logging.getLogger("magictv.server")


class Server:
    def __init__(self, cfg: dict, on_command: Callable[[dict], Coroutine]) -> None:
        self.host = cfg["daemon"]["host"]
        self.port = cfg["daemon"]["port"]
        self.cfg = cfg
        self.on_command = on_command
        self.clients: set = set()
        self.current_url: str | None = None

    def config_message(self) -> dict:
        return {"type": "config", "services": self.cfg["services"], "ui": self.cfg.get("ui", {})}

    async def handler(self, ws) -> None:
        self.clients.add(ws)
        log.info("extension connected (%d clients)", len(self.clients))
        try:
            await ws.send(json.dumps(self.config_message()))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "ping":
                    await ws.send(json.dumps({"type": "pong"}))
                elif msg.get("type") == "navigate":
                    self.current_url = msg.get("url")
                    log.info("page: %s", self.current_url)
                elif msg.get("type") == "hello":
                    log.info("hello from %s %s", msg.get("client"), msg.get("version"))
                else:
                    await self.on_command(msg)
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(ws)
            log.info("extension disconnected (%d clients)", len(self.clients))

    async def broadcast(self, msg: dict) -> None:
        if not self.clients:
            return
        data = json.dumps(msg)
        await asyncio.gather(*(c.send(data) for c in list(self.clients)), return_exceptions=True)

    async def run(self) -> None:
        async with websockets.serve(self.handler, self.host, self.port):
            log.info("listening on ws://%s:%d", self.host, self.port)
            await asyncio.Future()
