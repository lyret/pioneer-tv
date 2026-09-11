"""Configuration: TOML file merged over built-in defaults."""
from __future__ import annotations

import copy
import tomllib
from pathlib import Path
from typing import Any

DEFAULT_PATHS = [Path("/etc/pioneer-tv/config.toml"), Path(__file__).resolve().parent.parent / "config.toml"]

DEFAULTS: dict[str, Any] = {
    "daemon": {"host": "127.0.0.1", "port": 8765, "log_level": "info"},
    "cec": {
        "enabled": True,
        "device": "/dev/cec0",
        "osd_name": "Pioneer TV",
        "tv_address": 0,
        "tv_on_gamepad_connect": True,
        "monitor": True,
        # TV remote key (cec-ctl ui-cmd name) → action
        "remote": {
            "up": {"key": "KEY_UP"},
            "down": {"key": "KEY_DOWN"},
            "left": {"key": "KEY_LEFT"},
            "right": {"key": "KEY_RIGHT"},
            "select": {"key": "KEY_ENTER"},
            "exit": {"key": "KEY_ESC"},
            "back": {"key": "KEY_ESC"},
            "ac-back": {"key": "KEY_ESC"},
            "root-menu": {"system": "home"},
            "setup-menu": {"system": "menu"},
            "contents-menu": {"system": "menu"},
            "play": {"key": "KEY_SPACE"},
            "pause": {"key": "KEY_SPACE"},
            "stop": {"key": "KEY_SPACE"},
            "rewind": {"key": "KEY_LEFT"},
            "fast-forward": {"key": "KEY_RIGHT"},
        },
    },
    "gamepad": {
        "stick_deadzone": 0.45,      # left stick acts as a d-pad past this
        "trigger_threshold": 0.5,
        "long_press_ms": 800,
        "repeat_ms": 220,            # for actions marked repeat = true
        "unipolar_axes": ["ABS_Z", "ABS_RZ", "ABS_BRAKE", "ABS_GAS", "ABS_THROTTLE"],
        "invert_axes": [],           # e.g. ["ABS_Y", "ABS_RY"]; Nintendo pads get this automatically
        "buttons": {
            # Pads whose d-pad is buttons rather than a hat (Nintendo, some 8BitDo modes).
            "BTN_DPAD_UP": {"key": "KEY_UP"},
            "BTN_DPAD_DOWN": {"key": "KEY_DOWN"},
            "BTN_DPAD_LEFT": {"key": "KEY_LEFT"},
            "BTN_DPAD_RIGHT": {"key": "KEY_RIGHT"},
            "BTN_SOUTH": {"key": "KEY_ENTER"},
            "BTN_EAST": {"key": "KEY_ESC"},
            "BTN_WEST": {"key": "KEY_SPACE"},
            "BTN_NORTH": {"system": "keyboard"},
            "BTN_TL": {"key": "KEY_LEFT", "modifiers": ["KEY_LEFTALT"]},   # browser back
            "BTN_TR": {"key": "KEY_RIGHT", "modifiers": ["KEY_LEFTALT"]},  # browser forward
            "BTN_TL2": {"cec": "volume_down", "repeat": True},
            "BTN_TR2": {"cec": "volume_up", "repeat": True},
            "BTN_SELECT": {"system": "status", "long": {"cec": "tv_toggle"}},
            "BTN_START": {"system": "menu"},
            "BTN_MODE": {"system": "home"},
            "BTN_THUMBL": {"mouse_button": "BTN_RIGHT"},
            "BTN_THUMBR": {"mouse_button": "BTN_LEFT"},
        },
        "axes": {
            "ABS_HAT0X": {"negative": {"key": "KEY_LEFT"}, "positive": {"key": "KEY_RIGHT"}},
            "ABS_HAT0Y": {"negative": {"key": "KEY_UP"}, "positive": {"key": "KEY_DOWN"}},
            "ABS_X": {"negative": {"key": "KEY_LEFT"}, "positive": {"key": "KEY_RIGHT"}},
            "ABS_Y": {"negative": {"key": "KEY_UP"}, "positive": {"key": "KEY_DOWN"}},
            "ABS_RX": {"mouse": "x"},
            "ABS_RY": {"mouse": "y"},
            "ABS_Z": {"positive": {"cec": "volume_down", "repeat": True}},
            "ABS_RZ": {"positive": {"cec": "volume_up", "repeat": True}},
        },
    },
    "mouse": {"deadzone": 0.15, "max_speed": 1100.0, "curve": 2.0, "hz": 60},
    "ui": {"auto_keyboard": True},
    "chromium": {"log_file": "/home/pi/.pioneer-tv/chromium.log"},
    "remote": {"token": ""},
    "bluetooth": {"auto_connect": True, "reconnect_interval": 20},
    "services": [],
}


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load(path: str | None = None) -> dict:
    candidates = [Path(path)] if path else DEFAULT_PATHS
    for p in candidates:
        if p.is_file():
            with open(p, "rb") as f:
                data = tomllib.load(f)
            cfg = _merge(DEFAULTS, data)
            cfg["_path"] = str(p)
            return cfg
    cfg = copy.deepcopy(DEFAULTS)
    cfg["_path"] = None
    return cfg
