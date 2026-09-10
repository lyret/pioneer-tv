"""HTTP + WebSocket server (aiohttp).

  /ws            bridge to the Chromium extension
  /              settings page (also reachable over Tailscale via `tailscale serve`)
  /api/...       JSON API used by the settings page
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Callable, Coroutine

from aiohttp import WSMsgType, web

from . import settings, sysinfo

log = logging.getLogger("pioneertv.server")
WEB_DIR = Path(__file__).resolve().parent / "web"
EXT_DIR = Path(__file__).resolve().parent.parent.parent / "extension"  # repo and /opt layouts both
LOCAL_PEERS = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


class Server:
    def __init__(self, cfg: dict, on_command: Callable[[dict], Coroutine], hooks: dict[str, Any]) -> None:
        self.cfg = cfg
        self.host = cfg["daemon"]["host"]
        self.port = cfg["daemon"]["port"]
        self.on_command = on_command
        self.hooks = hooks  # status(), system_action(name), cec(name), config_changed()
        self.clients: set[web.WebSocketResponse] = set()
        self.current_url: str | None = None
        self.app = web.Application(middlewares=[self.auth_middleware])
        self.app.router.add_get("/ws", self.ws_handler)
        self.app.router.add_get("/", self.index)
        self.app.router.add_static("/static", WEB_DIR, show_index=False)
        if EXT_DIR.is_dir():
            self.app.router.add_static("/ext", EXT_DIR, show_index=False)
        api = [
            ("GET", "/api/status", self.api_status),
            ("GET", "/api/settings", self.api_settings_get),
            ("PUT", "/api/settings", self.api_settings_put),
            ("GET", "/api/wifi/networks", self.api_wifi_networks),
            ("POST", "/api/wifi/connect", self.api_wifi_connect),
            ("POST", "/api/wifi/forget", self.api_wifi_forget),
            ("GET", "/api/bluetooth/devices", self.api_bt_devices),
            ("POST", "/api/bluetooth/scan", self.api_bt_scan),
            ("POST", "/api/bluetooth/pair", self.api_bt_pair),
            ("POST", "/api/bluetooth/{action}", self.api_bt_action),
            ("POST", "/api/cec", self.api_cec),
            ("POST", "/api/system", self.api_system),
            ("GET", "/api/logs", self.api_logs),
        ]
        for method, path, handler in api:
            self.app.router.add_route(method, path, handler)

    # ------------------------------------------------------------ auth
    @web.middleware
    async def auth_middleware(self, request: web.Request, handler):
        token = (self.cfg.get("remote") or {}).get("token") or ""
        peer = request.remote or ""
        if token and peer not in LOCAL_PEERS:
            supplied = (
                request.query.get("token")
                or request.cookies.get("pioneertv_token")
                or request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            )
            if supplied != token:
                return web.json_response({"error": "unauthorized"}, status=401)
            resp = await handler(request)
            if request.query.get("token"):
                resp.set_cookie("pioneertv_token", token, httponly=True, samesite="Strict", max_age=90 * 86400)
            return resp
        return await handler(request)

    # ------------------------------------------------------------ pages
    async def index(self, request: web.Request) -> web.StreamResponse:
        return web.FileResponse(WEB_DIR / "settings.html")

    # ------------------------------------------------------------ websocket
    def config_message(self) -> dict:
        return {
            "type": "config",
            "services": self.cfg["services"],
            "ui": self.cfg.get("ui", {}),
            "settings_url": f"http://127.0.0.1:{self.port}/",
        }

    async def ws_handler(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self.clients.add(ws)
        log.info("extension connected (%d clients)", len(self.clients))
        try:
            await ws.send_json(self.config_message())
            status = self.hooks.get("last_status")
            if callable(status) and (s := status()):
                await ws.send_json(s)
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                t = data.get("type")
                if t == "ping":
                    await ws.send_json({"type": "pong"})
                elif t == "navigate":
                    self.current_url = data.get("url")
                    log.info("page: %s", self.current_url)
                elif t == "hello":
                    log.info("hello from %s %s", data.get("client"), data.get("version"))
                else:
                    await self.on_command(data)
        finally:
            self.clients.discard(ws)
            log.info("extension disconnected (%d clients)", len(self.clients))
        return ws

    async def broadcast(self, msg: dict) -> None:
        if not self.clients:
            return
        data = json.dumps(msg)
        await asyncio.gather(*(c.send_str(data) for c in list(self.clients)), return_exceptions=True)

    # ------------------------------------------------------------ API
    async def _json(self, request: web.Request) -> dict:
        try:
            data = await request.json()
        except ValueError:
            raise web.HTTPBadRequest(text="invalid JSON")
        return data if isinstance(data, dict) else {}

    async def api_status(self, request: web.Request) -> web.Response:
        return web.json_response(await self.hooks["status"](force=True))

    async def api_settings_get(self, request: web.Request) -> web.Response:
        return web.json_response(settings.describe(self.cfg))

    async def api_settings_put(self, request: web.Request) -> web.Response:
        payload = await self._json(request)
        try:
            settings.update(self.cfg, payload)
        except (ValueError, TypeError) as exc:
            return web.json_response({"error": str(exc)}, status=400)
        await self.hooks["config_changed"]()
        await self.broadcast(self.config_message())
        return web.json_response(settings.describe(self.cfg))

    async def api_wifi_networks(self, request: web.Request) -> web.Response:
        return web.json_response(await sysinfo.wifi_networks(rescan=request.query.get("rescan") == "1"))

    async def api_wifi_connect(self, request: web.Request) -> web.Response:
        data = await self._json(request)
        ok, msg = await sysinfo.wifi_connect(str(data.get("ssid", "")), data.get("password") or None)
        return web.json_response({"ok": ok, "message": msg}, status=200 if ok else 400)

    async def api_wifi_forget(self, request: web.Request) -> web.Response:
        data = await self._json(request)
        ok, msg = await sysinfo.wifi_forget(str(data.get("ssid", "")))
        return web.json_response({"ok": ok, "message": msg}, status=200 if ok else 400)

    async def api_bt_devices(self, request: web.Request) -> web.Response:
        return web.json_response(await sysinfo.bluetooth_devices())

    async def api_bt_scan(self, request: web.Request) -> web.Response:
        data = await self._json(request)
        seconds = max(3, min(int(data.get("seconds", 8)), 30))
        return web.json_response(await sysinfo.bluetooth_scan(seconds))

    async def api_bt_pair(self, request: web.Request) -> web.Response:
        data = await self._json(request)
        ok, msg = await sysinfo.bluetooth_pair(str(data.get("mac", "")).upper())
        return web.json_response({"ok": ok, "message": msg}, status=200 if ok else 400)

    async def api_bt_action(self, request: web.Request) -> web.Response:
        action = request.match_info["action"]
        if action not in ("connect", "disconnect", "remove", "trust"):
            raise web.HTTPNotFound()
        data = await self._json(request)
        ok, msg = await sysinfo.bluetooth_simple(action, str(data.get("mac", "")).upper())
        return web.json_response({"ok": ok, "message": msg}, status=200 if ok else 400)

    async def api_cec(self, request: web.Request) -> web.Response:
        data = await self._json(request)
        try:
            await self.hooks["cec"](str(data.get("command", "")))
        except Exception as exc:
            return web.json_response({"ok": False, "message": str(exc)}, status=400)
        return web.json_response({"ok": True})

    async def api_system(self, request: web.Request) -> web.Response:
        data = await self._json(request)
        ok, msg = await self.hooks["system_action"](str(data.get("action", "")))
        return web.json_response({"ok": ok, "message": msg}, status=200 if ok else 400)

    async def api_logs(self, request: web.Request) -> web.Response:
        unit = request.query.get("unit", "pioneer-tv-daemon")
        if unit not in ("pioneer-tv-daemon", "pioneer-tv-weston", "bluetooth", "NetworkManager", "tailscaled"):
            raise web.HTTPBadRequest(text="unknown unit")
        lines = max(10, min(int(request.query.get("lines", "120")), 1000))
        _, out = await sysinfo.run("journalctl", "-u", unit, "-n", str(lines), "--no-pager", "-o", "short-iso", timeout=10)
        return web.Response(text=out, content_type="text/plain")

    # ------------------------------------------------------------ run
    async def run(self) -> None:
        runner = web.AppRunner(self.app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        log.info("listening on http://%s:%d (ws at /ws)", self.host, self.port)
        try:
            await asyncio.Future()
        finally:
            await runner.cleanup()
