"""Maps abstract actions ({"key": ...}, {"cec": ...}, {"system": ...}) to effects.

Buttons call `press(action)` / `release(action)`; the dispatcher handles key
hold semantics, repeat for held CEC actions, and long-press alternates.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Coroutine

log = logging.getLogger("magictv.actions")

Action = dict[str, Any]


class Dispatcher:
    def __init__(self, cfg: dict, vinput, cec, emit: Callable[[dict], Coroutine]) -> None:
        self.cfg = cfg
        self.vinput = vinput
        self.cec = cec
        self.emit = emit  # send an event to the extension
        self.repeat_ms = cfg["gamepad"]["repeat_ms"]
        self.long_press_ms = cfg["gamepad"]["long_press_ms"]
        self._repeat_tasks: dict[int, asyncio.Task] = {}
        self._pressed_at: dict[int, float] = {}
        self._long_fired: set[int] = set()
        self._long_tasks: dict[int, asyncio.Task] = {}

    # ------------------------------------------------------------ public
    async def press(self, action: Action) -> None:
        aid = id(action)
        self._pressed_at[aid] = time.monotonic()
        if "long" in action:
            # Defer the short action until release; fire long after the delay.
            self._long_tasks[aid] = asyncio.create_task(self._long_after(action))
            return
        await self._begin(action)

    async def release(self, action: Action) -> None:
        aid = id(action)
        if task := self._long_tasks.pop(aid, None):
            task.cancel()
            if aid in self._long_fired:
                self._long_fired.discard(aid)
            else:
                await self.fire(action)  # short press
            return
        await self._end(action)

    async def fire(self, action: Action) -> None:
        """One-shot: press and release."""
        await self._begin(action)
        await self._end(action)

    # ------------------------------------------------------------ internals
    async def _long_after(self, action: Action) -> None:
        try:
            await asyncio.sleep(self.long_press_ms / 1000)
        except asyncio.CancelledError:
            return
        self._long_fired.add(id(action))
        await self.fire(action["long"])

    async def _begin(self, action: Action) -> None:
        if "key" in action:
            self.vinput.key(action["key"], True, action.get("modifiers"))
        elif "mouse_button" in action:
            self.vinput.mouse_button(action["mouse_button"], True)
        elif "cec" in action or "system" in action:
            await self._run_once(action)
            if action.get("repeat"):
                self._repeat_tasks[id(action)] = asyncio.create_task(self._repeat(action))

    async def _end(self, action: Action) -> None:
        if "key" in action:
            self.vinput.key(action["key"], False, action.get("modifiers"))
        elif "mouse_button" in action:
            self.vinput.mouse_button(action["mouse_button"], False)
        if task := self._repeat_tasks.pop(id(action), None):
            task.cancel()

    async def _repeat(self, action: Action) -> None:
        try:
            await asyncio.sleep(0.4)
            while True:
                await self._run_once(action)
                await asyncio.sleep(self.repeat_ms / 1000)
        except asyncio.CancelledError:
            pass

    async def _run_once(self, action: Action) -> None:
        if "cec" in action:
            await self.cec_command(action["cec"])
        elif "system" in action:
            await self.emit({"type": "event", "name": action["system"]})

    async def cec_command(self, command: str) -> None:
        if command in ("volume_up", "volume_down", "mute"):
            await self.emit({"type": "event", "name": "volume", "direction": command.split("_")[-1] if "_" in command else "mute"})
        try:
            await self.cec.command(command)
        except Exception as exc:  # cec-ctl missing, TV asleep, ...
            log.warning("cec %s failed: %s", command, exc)
