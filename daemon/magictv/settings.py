"""User-editable settings: a JSON overlay saved next to config.toml.

config.toml stays the place for advanced things (full button maps). The
settings page edits the fields declared in SCHEMA plus the services list;
those are written to settings.json and merged in-place into the live config.
"""
from __future__ import annotations

import copy
import json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger("magictv.settings")

SCHEMA: list[dict] = [
    {
        "id": "controls", "title": "Kontroller",
        "fields": [
            {"path": "mouse.max_speed", "type": "number", "label": "Pekarhastighet", "min": 200, "max": 3000, "step": 100, "unit": "px/s"},
            {"path": "mouse.deadzone", "type": "number", "label": "Pekare dödzon", "min": 0.05, "max": 0.5, "step": 0.05},
            {"path": "gamepad.stick_deadzone", "type": "number", "label": "Spak som styrkors, tröskel", "min": 0.2, "max": 0.9, "step": 0.05},
            {"path": "gamepad.long_press_ms", "type": "number", "label": "Långtryck", "min": 300, "max": 2000, "step": 100, "unit": "ms"},
            {"path": "gamepad.repeat_ms", "type": "number", "label": "Volymrepetition", "min": 100, "max": 600, "step": 20, "unit": "ms"},
            {"path": "ui.auto_keyboard", "type": "bool", "label": "Öppna skärmtangentbordet automatiskt i textfält"},
        ],
    },
    {
        "id": "tv", "title": "TV",
        "fields": [
            {"path": "cec.enabled", "type": "bool", "label": "HDMI-CEC"},
            {"path": "cec.tv_on_gamepad_connect", "type": "bool", "label": "Väck TV:n när en handkontroll ansluter"},
            {"path": "cec.monitor", "type": "bool", "label": "Lyssna på TV:ns fjärrkontroll och standby"},
            {"path": "cec.osd_name", "type": "text", "label": "Namn som TV:n visar", "maxlength": 14},
        ],
    },
    {
        "id": "remote", "title": "Fjärråtkomst",
        "fields": [
            {"path": "remote.token", "type": "text", "label": "Åtkomstnyckel (tom = bara lokalt / Tailscale serve)", "secret": True},
        ],
    },
]

SERVICE_FIELDS = ["id", "name", "tagline", "url", "search_url", "color", "glyph", "logo"]


def overlay_path(cfg: dict) -> Path:
    base = cfg.get("_path")
    directory = Path(base).parent if base else Path("/etc/magic-tv")
    return directory / "settings.json"


def get_path(cfg: dict, path: str) -> Any:
    cur: Any = cfg
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def set_path(cfg: dict, path: str, value: Any) -> None:
    parts = path.split(".")
    cur = cfg
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def deep_update(target: dict, src: dict) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(target.get(k), dict):
            deep_update(target[k], v)
        else:
            target[k] = copy.deepcopy(v)


def load_overlay(cfg: dict) -> dict:
    p = overlay_path(cfg)
    if not p.is_file():
        return {}
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError) as exc:
        log.warning("could not read %s: %s", p, exc)
        return {}


def apply_overlay(cfg: dict) -> None:
    ov = load_overlay(cfg)
    if not ov:
        return
    for path, value in (ov.get("values") or {}).items():
        set_path(cfg, path, value)
    if isinstance(ov.get("services"), list):
        cfg["services"] = ov["services"]
    log.info("applied settings overlay from %s", overlay_path(cfg))


def save_overlay(cfg: dict, overlay: dict) -> None:
    p = overlay_path(cfg)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(overlay, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def _field(path: str) -> dict | None:
    for section in SCHEMA:
        for f in section["fields"]:
            if f["path"] == path:
                return f
    return None


def _coerce(field: dict, value: Any) -> Any:
    t = field["type"]
    if t == "bool":
        return bool(value) if not isinstance(value, str) else value.lower() in ("1", "true", "on", "yes")
    if t == "number":
        v = float(value)
        if "min" in field:
            v = max(field["min"], v)
        if "max" in field:
            v = min(field["max"], v)
        return int(v) if float(v).is_integer() and field.get("step", 1) >= 1 else v
    if t == "text":
        s = str(value)
        return s[: field["maxlength"]] if "maxlength" in field else s
    return value


def describe(cfg: dict) -> dict:
    """Schema plus current values, for the settings page."""
    sections = []
    for section in SCHEMA:
        fields = []
        for f in section["fields"]:
            item = dict(f)
            v = get_path(cfg, f["path"])
            item["value"] = "" if f.get("secret") and v else v
            item["is_set"] = bool(v) if f.get("secret") else None
            fields.append(item)
        sections.append({"id": section["id"], "title": section["title"], "fields": fields})
    return {"sections": sections, "services": cfg.get("services", []), "service_fields": SERVICE_FIELDS}


def update(cfg: dict, payload: dict) -> dict:
    """Validate, apply in-place and persist. Returns the stored overlay."""
    overlay = load_overlay(cfg)
    values = overlay.setdefault("values", {})
    for path, raw in (payload.get("values") or {}).items():
        field = _field(path)
        if field is None:
            raise ValueError(f"unknown setting {path}")
        if field.get("secret") and raw == "":
            continue  # blank secret means "keep"
        value = _coerce(field, raw)
        values[path] = value
        set_path(cfg, path, value)
    if "services" in payload:
        services = []
        for s in payload["services"] or []:
            if not isinstance(s, dict) or not s.get("name") or not s.get("url"):
                continue
            clean = {k: str(s[k]).strip() for k in SERVICE_FIELDS if s.get(k) not in (None, "")}
            clean.setdefault("id", clean["name"].lower().replace(" ", "-"))
            services.append(clean)
        overlay["services"] = services
        cfg["services"] = services
    save_overlay(cfg, overlay)
    return overlay
