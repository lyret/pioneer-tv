"""Gamepad discovery and event handling.

Any evdev device that reports BTN_SOUTH (or BTN_GAMEPAD) is treated as a
gamepad. Buttons and axes are mapped through the config to Dispatcher actions.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Coroutine

import evdev
from evdev import ecodes as e

from .actions import Dispatcher

log = logging.getLogger("pioneertv.gamepad")

# Per-device quirks by name substring: axis inversion and button overrides
# (merged over the configured button map). The Nintendo driver reports stick
# Y with up as positive; the SteelSeries Stratus XL numbers its buttons in
# order (X=BTN_C, Y=BTN_NORTH, L1=BTN_WEST, R1=BTN_Z, L2=BTN_TL, R2=BTN_TR)
# and has no Start or Guide, so a long press on B opens the menu.
QUIRKS = [
    ("Pro Controller", {"invert": ["ABS_Y", "ABS_RY"]}),
    ("Joy-Con", {"invert": ["ABS_Y", "ABS_RY"]}),
    ("Nintendo", {"invert": ["ABS_Y", "ABS_RY"]}),
    ("Stratus XL", {"buttons": {
        "BTN_B": {"key": "KEY_ESC", "long": {"system": "menu"}},
        "BTN_C": {"key": "KEY_SPACE"},                                  # X
        "BTN_NORTH": {"system": "keyboard"},                            # Y
        "BTN_WEST": {"key": "KEY_LEFT", "modifiers": ["KEY_LEFTALT"]},  # L1: browser back
        "BTN_Z": {"key": "KEY_RIGHT", "modifiers": ["KEY_LEFTALT"]},    # R1: browser forward
        "BTN_TL": {"cec": "volume_down", "repeat": True},               # L2
        "BTN_TR": {"cec": "volume_up", "repeat": True},                 # R2
        "KEY_HOMEPAGE": {"system": "menu", "long": {"system": "home"}},
    }}),
]


class Gamepad:
    def __init__(self, dev: evdev.InputDevice, cfg: dict, dispatcher: Dispatcher, mouse) -> None:
        self.dev = dev
        self.cfg = cfg["gamepad"]
        self.dispatcher = dispatcher
        self.mouse = mouse
        button_map = dict(self.cfg["buttons"])
        for needle, quirk in QUIRKS:
            if needle.lower() in dev.name.lower() and quirk.get("buttons"):
                button_map.update(quirk["buttons"])
                log.info("%s: using button profile", dev.name)
        # A pad without Start or Guide still needs a way to the menu: long-press B.
        keys = set(dev.capabilities().get(e.EV_KEY, []))
        if e.BTN_START not in keys and e.BTN_MODE not in keys and e.BTN_EAST in keys:
            b = dict(button_map.get("BTN_EAST") or {"key": "KEY_ESC"})
            b.setdefault("long", {"system": "menu"})
            button_map["BTN_EAST"] = b
        self.buttons: dict[int, dict] = {}
        for name, action in button_map.items():
            code = getattr(e, name, None)
            if code is not None:
                self.buttons[code] = action
        self.axes: dict[int, dict] = {}
        for name, spec in self.cfg["axes"].items():
            code = getattr(e, name, None)
            if code is not None:
                self.axes[code] = spec
        self.absinfo = {code: info for code, info in dev.capabilities().get(e.EV_ABS, [])}
        self.unipolar = {getattr(e, n) for n in self.cfg["unipolar_axes"] if hasattr(e, n)}
        invert = list(self.cfg.get("invert_axes") or [])
        for needle, quirk in QUIRKS:
            if needle.lower() in dev.name.lower():
                invert += quirk.get("invert", [])
        self.invert = {getattr(e, n) for n in invert if hasattr(e, n)}
        if self.invert:
            log.info("%s: inverting %s", dev.name, ", ".join(sorted(invert)))
        self.axis_state: dict[int, int] = {}  # -1, 0, +1 per digital-ised axis

    def normalize(self, code: int, value: int) -> float:
        info = self.absinfo.get(code)
        if info is None or info.max == info.min:
            return float(value)
        if code in self.unipolar and info.min >= 0:
            return (value - info.min) / (info.max - info.min)
        v = (value - info.min) / (info.max - info.min) * 2.0 - 1.0
        return -v if code in self.invert else v

    async def run(self) -> None:
        log.info("reading %s (%s)", self.dev.name, self.dev.path)
        try:
            async for ev in self.dev.async_read_loop():
                if ev.type == e.EV_KEY:
                    await self.on_key(ev.code, ev.value)
                elif ev.type == e.EV_ABS:
                    await self.on_abs(ev.code, ev.value)
        except (OSError, asyncio.CancelledError):
            pass
        finally:
            await self.release_everything()
            log.info("stopped %s", self.dev.name)

    async def on_key(self, code: int, value: int) -> None:
        action = self.buttons.get(code)
        if action is None or value == 2:  # 2 = autorepeat
            return
        if value:
            await self.dispatcher.press(action)
        else:
            await self.dispatcher.release(action)

    async def on_abs(self, code: int, value: int) -> None:
        spec = self.axes.get(code)
        if spec is None:
            return
        v = self.normalize(code, value)
        if "mouse" in spec:
            self.mouse.set_axis(spec["mouse"], v)
            return
        hat = code in (e.ABS_HAT0X, e.ABS_HAT0Y)
        threshold = 0.5 if hat else (self.cfg["trigger_threshold"] if code in self.unipolar else self.cfg["stick_deadzone"])
        new = 1 if v > threshold else (-1 if v < -threshold else 0)
        old = self.axis_state.get(code, 0)
        if new == old:
            return
        self.axis_state[code] = new
        if old:
            act = spec.get("positive" if old > 0 else "negative")
            if act:
                await self.dispatcher.release(act)
        if new:
            act = spec.get("positive" if new > 0 else "negative")
            if act:
                await self.dispatcher.press(act)

    async def release_everything(self) -> None:
        for code, state in list(self.axis_state.items()):
            if state:
                act = self.axes[code].get("positive" if state > 0 else "negative")
                if act:
                    await self.dispatcher.release(act)
        self.axis_state.clear()
        self.mouse.reset()


class MouseDriver:
    """Turns a stick position into relative pointer motion at a fixed rate."""

    def __init__(self, cfg: dict, vinput) -> None:
        self.cfg = cfg["mouse"]
        self.vinput = vinput
        self.x = 0.0
        self.y = 0.0
        self._rx = 0.0
        self._ry = 0.0

    def set_axis(self, axis: str, v: float) -> None:
        if axis == "x":
            self.x = v
        else:
            self.y = v

    def reset(self) -> None:
        self.x = self.y = 0.0

    def _speed(self, v: float) -> float:
        dz = self.cfg["deadzone"]
        if abs(v) < dz:
            return 0.0
        mag = (abs(v) - dz) / (1 - dz)
        return (mag ** self.cfg["curve"]) * self.cfg["max_speed"] * (1 if v > 0 else -1)

    async def run(self) -> None:
        dt = 1.0 / self.cfg["hz"]
        while True:
            await asyncio.sleep(dt)
            sx, sy = self._speed(self.x), self._speed(self.y)
            if not sx and not sy:
                self._rx = self._ry = 0.0
                continue
            self._rx += sx * dt
            self._ry += sy * dt
            dx, dy = int(self._rx), int(self._ry)
            self._rx -= dx
            self._ry -= dy
            self.vinput.mouse_move(dx, dy)


def is_gamepad(dev: evdev.InputDevice) -> bool:
    keys = dev.capabilities().get(e.EV_KEY, [])
    return e.BTN_SOUTH in keys or e.BTN_GAMEPAD in keys


def is_keyboard(dev: evdev.InputDevice) -> bool:
    """A real keyboard: letters and Enter, and not one of our virtual devices."""
    if dev.name.startswith("Pioneer TV"):
        return False
    keys = set(dev.capabilities().get(e.EV_KEY, []))
    return e.KEY_A in keys and e.KEY_Z in keys and e.KEY_ENTER in keys and e.BTN_SOUTH not in keys


class GamepadManager:
    def __init__(self, cfg: dict, dispatcher: Dispatcher, mouse: MouseDriver,
                 on_change: Callable[[bool, str], Coroutine],
                 on_keyboard: Callable[[bool], Coroutine] | None = None) -> None:
        self.cfg = cfg
        self.dispatcher = dispatcher
        self.mouse = mouse
        self.on_change = on_change
        self.on_keyboard = on_keyboard
        self.active: dict[str, asyncio.Task] = {}
        self.instances: dict[str, Gamepad] = {}
        self.keyboards: set[str] = set()
        self.keyboard_present = False

    def pads(self) -> list[Gamepad]:
        return list(self.instances.values())

    async def run(self) -> None:
        while True:
            try:
                await self.scan()
            except Exception as exc:
                log.warning("scan failed: %s", exc)
            await asyncio.sleep(2)

    async def scan(self) -> None:
        present = set()
        keyboards = set()
        for path in evdev.list_devices():
            if path in self.active:
                present.add(path)
                continue
            try:
                dev = evdev.InputDevice(path)
            except OSError:
                continue
            if is_gamepad(dev):
                present.add(path)
                pad = Gamepad(dev, self.cfg, self.dispatcher, self.mouse)
                self.instances[path] = pad
                self.active[path] = asyncio.create_task(pad.run())
                log.info("gamepad connected: %s", dev.name)
                await self.on_change(True, dev.name)
                continue
            if is_keyboard(dev):
                keyboards.add(path)
            dev.close()
        for path in list(self.active):
            if path not in present or self.active[path].done():
                self.active.pop(path).cancel()
                pad = self.instances.pop(path, None)
                name = pad.dev.name if pad else path
                log.info("gamepad removed: %s", name)
                await self.on_change(False, name)
        if keyboards != self.keyboards:
            self.keyboards = keyboards
            self.keyboard_present = bool(keyboards)
            log.info("physical keyboard %s", "present" if keyboards else "absent")
            if self.on_keyboard:
                await self.on_keyboard(self.keyboard_present)
