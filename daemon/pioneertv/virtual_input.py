"""Virtual keyboard and mouse exposed to the compositor through uinput."""
from __future__ import annotations

import logging

from evdev import UInput, ecodes as e

log = logging.getLogger("pioneertv.uinput")

KEYBOARD_KEYS = [
    e.KEY_UP, e.KEY_DOWN, e.KEY_LEFT, e.KEY_RIGHT, e.KEY_ENTER, e.KEY_ESC, e.KEY_SPACE,
    e.KEY_BACKSPACE, e.KEY_TAB, e.KEY_HOME, e.KEY_END, e.KEY_PAGEUP, e.KEY_PAGEDOWN,
    e.KEY_LEFTALT, e.KEY_LEFTCTRL, e.KEY_LEFTSHIFT, e.KEY_LEFTMETA,
    e.KEY_F5, e.KEY_F11, e.KEY_PLAYPAUSE, e.KEY_MUTE, e.KEY_VOLUMEUP, e.KEY_VOLUMEDOWN,
    e.KEY_NEXTSONG, e.KEY_PREVIOUSSONG,
] + [getattr(e, f"KEY_{c}") for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"] + [getattr(e, f"KEY_{n}") for n in range(10)]


class VirtualInput:
    def __init__(self, with_mouse: bool = True) -> None:
        self.keyboard = UInput({e.EV_KEY: KEYBOARD_KEYS}, name="Pioneer TV Virtual Keyboard")
        self.mouse = None
        if with_mouse:
            self.mouse = UInput(
                {
                    e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE],
                    e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL],
                },
                name="Pioneer TV Virtual Mouse",
            )
        self._held: set[int] = set()
        log.info("virtual keyboard%s created", " and mouse" if with_mouse else "")

    @staticmethod
    def code(name: str) -> int:
        try:
            return getattr(e, name)
        except AttributeError as exc:
            raise ValueError(f"unknown key/button name {name!r}") from exc

    def key(self, name: str, down: bool, modifiers: list[str] | None = None) -> None:
        if self.keyboard.fd < 0:
            return  # already closed (shutdown)
        code = self.code(name)
        mods = [self.code(m) for m in (modifiers or [])]
        if down:
            for m in mods:
                self.keyboard.write(e.EV_KEY, m, 1)
            self.keyboard.write(e.EV_KEY, code, 1)
            self._held.add(code)
        else:
            self.keyboard.write(e.EV_KEY, code, 0)
            for m in reversed(mods):
                self.keyboard.write(e.EV_KEY, m, 0)
            self._held.discard(code)
        self.keyboard.syn()

    def tap(self, name: str, modifiers: list[str] | None = None) -> None:
        self.key(name, True, modifiers)
        self.key(name, False, modifiers)

    def mouse_button(self, name: str, down: bool) -> None:
        if self.mouse is None or self.mouse.fd < 0:
            return
        self.mouse.write(e.EV_KEY, self.code(name), 1 if down else 0)
        self.mouse.syn()

    def mouse_move(self, dx: int, dy: int) -> None:
        if self.mouse is None:
            return
        if dx:
            self.mouse.write(e.EV_REL, e.REL_X, dx)
        if dy:
            self.mouse.write(e.EV_REL, e.REL_Y, dy)
        if dx or dy:
            self.mouse.syn()

    def release_all(self) -> None:
        for code in list(self._held):
            self.keyboard.write(e.EV_KEY, code, 0)
        self._held.clear()
        self.keyboard.syn()

    def close(self) -> None:
        self.release_all()
        self.keyboard.close()
        if self.mouse is not None:
            self.mouse.close()
