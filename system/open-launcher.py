#!/usr/bin/env python3
"""Open the Pioneer TV launcher in the running Chromium and give it keyboard focus.

Talks to Chromium's DevTools protocol on 127.0.0.1. Navigates the start tab in
place (no new tab, no closed tab, so focus stays in the page), brings it to
the front and clicks an empty corner so the web contents, not the hidden
address bar, receive key presses.

    open-launcher.py <port> <extension-id> [timeout-seconds]
"""
import asyncio
import json
import sys
import time

import aiohttp

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
EXT_ID = sys.argv[2] if len(sys.argv) > 2 else "dpigdefepjjejbkidlabpjlnleidgjaf"
TIMEOUT = float(sys.argv[3]) if len(sys.argv) > 3 else 120.0
BASE = f"http://127.0.0.1:{PORT}"
URL = f"chrome-extension://{EXT_ID}/launcher/index.html"


def log(*a):
    print("open-launcher:", *a, flush=True)


async def pages(session):
    async with session.get(BASE + "/json", timeout=aiohttp.ClientTimeout(total=5)) as r:
        return [p for p in await r.json() if p.get("type") == "page"]


async def cdp(session, ws_url, commands):
    """Send CDP commands over one websocket session and return their results."""
    results = []
    async with session.ws_connect(ws_url, timeout=10, max_msg_size=0) as ws:
        for i, (method, params) in enumerate(commands, 1):
            await ws.send_json({"id": i, "method": method, "params": params})
            while True:
                msg = await asyncio.wait_for(ws.receive(), 10)
                if msg.type != aiohttp.WSMsgType.TEXT:
                    raise RuntimeError(f"websocket closed during {method}")
                data = json.loads(msg.data)
                if data.get("id") == i:
                    results.append(data)
                    break
    return results


async def focus(session, page):
    """Bring the page to front and click an empty corner so it owns the keyboard."""
    await cdp(session, page["webSocketDebuggerUrl"], [
        ("Page.bringToFront", {}),
        ("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 4, "y": 4}),
        ("Input.dispatchMouseEvent", {"type": "mousePressed", "x": 4, "y": 4, "button": "left", "clickCount": 1}),
        ("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": 4, "y": 4, "button": "left", "clickCount": 1}),
        ("Runtime.evaluate", {"expression": "window.focus(); document.activeElement && document.activeElement.tagName"}),
    ])


async def main() -> int:
    deadline = time.monotonic() + TIMEOUT
    async with aiohttp.ClientSession() as session:
        # 1. Wait for the DevTools port.
        while True:
            try:
                async with session.get(BASE + "/json/version", timeout=aiohttp.ClientTimeout(total=2)):
                    break
            except Exception:
                if time.monotonic() > deadline:
                    log(f"DevTools port {PORT} never answered")
                    return 1
                await asyncio.sleep(0.5)
        await asyncio.sleep(2)

        # 2. Navigate the start tab in place, or open one if there is none.
        launcher = None
        for attempt in range(1, 13):
            try:
                ps = await pages(session)
            except Exception as exc:
                log("could not list pages:", exc)
                await asyncio.sleep(2)
                continue
            launcher = next((p for p in ps if p.get("url", "").startswith(URL)), None)
            if launcher:
                log("launcher is open")
                break
            target = next((p for p in ps if p.get("url", "") in ("about:blank", "") or p["url"].startswith("chrome://newtab") or p["url"].startswith("chrome-error://")), None)
            try:
                if target:
                    log(f"navigating tab in place (attempt {attempt})")
                    await cdp(session, target["webSocketDebuggerUrl"], [("Page.navigate", {"url": URL})])
                elif not ps:
                    log(f"no tab yet, opening one (attempt {attempt})")
                    async with session.put(BASE + "/json/new?" + URL, timeout=aiohttp.ClientTimeout(total=10)):
                        pass
                else:
                    log("no idle tab:", [p.get("url") for p in ps])
            except Exception as exc:
                log("navigate failed:", exc)
            await asyncio.sleep(3)
        if not launcher:
            log("launcher not open, giving up")
            return 1

        # 3. Focus now, and again a little later in case the page reloads or
        #    the window is re-shown.
        for delay in (0, 5, 15):
            await asyncio.sleep(delay)
            try:
                ps = await pages(session)
                launcher = next((p for p in ps if p.get("url", "").startswith(URL)), launcher)
                await focus(session, launcher)
                log("focused launcher")
            except Exception as exc:
                log("focus failed:", exc)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
