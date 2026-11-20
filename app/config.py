"""Indstillinger. Alt der kan skiftes i vinduet ligger i denne dict."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from app.keys import clean_key

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"

MODES = ("release", "same_key", "double")
SCROLL_DIRECTIONS = ("both", "up", "down")

PIECE_ORDER = ("wall", "floor", "ramp", "cone", "trap")
PIECE_LABELS = {
    "wall": "Væg",
    "floor": "Gulv",
    "ramp": "Rampe",
    "cone": "Kegle",
    "trap": "Fælde",
}


def _piece(game_key: str, in_cycle: bool) -> dict:
    return {
        "game_key": game_key,
        "hotkey": "",
        "replace_hotkey": "",
        "in_cycle": in_cycle,
    }


def default_config() -> dict:
    return {
        "version": 1,
        "enabled": False,
        "master_toggle": "f8",
        "only_fortnite": True,
        "overlay": True,
        "overlay_x": 28,
        "overlay_y": 28,
        "beep_on_switch": True,
        "step_ms": 6,
        "jitter_ms": 1,
        "edit": {
            "mode": "release",
            "edit_key": "f",
            "reset_key": "g",
            "confirm_key": "f",
            "instant_reset_hotkey": "mouse_x1",
            "fast_confirm_hotkey": "",
            "turbo_hotkey": "",
            "turbo_ms": 35,
            "scroll_reset": True,
            "scroll_direction": "both",
            "cycle_hotkey": "f6",
            "cycle_keys": ["f", "mouse_x2", "g"],
        },
        "build": {
            "place_key": "mouse_left",
            "auto_place": False,
            "cycle_hotkey": "mouse_middle",
            "pieces": {
                "wall": _piece("q", True),
                "floor": _piece("x", True),
                "ramp": _piece("c", True),
                "cone": _piece("v", True),
                "trap": _piece("t", False),
            },
        },
        "extras": {
            "pickup_key": "e",
            "pickup_hotkey": "",
            "pickup_ms": 40,
            "slot_cycle_hotkey": "",
            "slots": {
                "1": {"game_key": "1", "hotkey": ""},
                "2": {"game_key": "2", "hotkey": ""},
                "3": {"game_key": "3", "hotkey": ""},
                "4": {"game_key": "4", "hotkey": ""},
                "5": {"game_key": "5", "hotkey": ""},
            },
        },
        "profiles": [
            {
                "name": "Keyboard",
                "edit_key": "f",
                "reset_key": "g",
                "confirm_key": "f",
                "mode": "release",
            },
            {
                "name": "Mus",
                "edit_key": "mouse_x2",
                "reset_key": "g",
                "confirm_key": "mouse_x2",
                "mode": "release",
            },
        ],
        "active_profile": "Keyboard",
        "profile_cycle_hotkey": "f7",
    }


def merge(default, loaded):
    if isinstance(default, dict):
        loaded = loaded if isinstance(loaded, dict) else {}
        out = {}
        for key, value in default.items():
            if key in loaded:
                out[key] = merge(value, loaded[key])
            else:
                out[key] = copy.deepcopy(value)
        return out
    if isinstance(default, list):
        if isinstance(loaded, list):
            return copy.deepcopy(loaded)
        return copy.deepcopy(default)
    if loaded is None:
        return copy.deepcopy(default)
    return loaded


def _as_int(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _clamp(value, low: int, high: int, fallback: int) -> int:
    return max(low, min(high, _as_int(value, fallback)))


def _as_bool(value, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    return fallback


def clamp_config(cfg: dict | None) -> dict:
    if not isinstance(cfg, dict):
        cfg = default_config()
    else:
        merged = merge(default_config(), cfg)
        cfg.clear()
        cfg.update(merged)
    base = default_config()
    cfg["version"] = 1
    cfg["enabled"] = _as_bool(cfg.get("enabled"), False)
    cfg["only_fortnite"] = _as_bool(cfg.get("only_fortnite"), True)
    cfg["overlay"] = _as_bool(cfg.get("overlay"), True)
    cfg["beep_on_switch"] = _as_bool(cfg.get("beep_on_switch"), True)
    cfg["step_ms"] = _clamp(cfg.get("step_ms"), 0, 50, 6)
    cfg["jitter_ms"] = _clamp(cfg.get("jitter_ms"), 0, 20, 1)
    cfg["overlay_x"] = _as_int(cfg.get("overlay_x"), 28)
    cfg["overlay_y"] = _as_int(cfg.get("overlay_y"), 28)
    cfg["master_toggle"] = clean_key(cfg.get("master_toggle")) or "f8"
    cfg["profile_cycle_hotkey"] = clean_key(cfg.get("profile_cycle_hotkey"))

    edit = cfg["edit"]
    if edit.get("mode") not in MODES:
        edit["mode"] = "release"
    if edit.get("scroll_direction") not in SCROLL_DIRECTIONS:
        edit["scroll_direction"] = "both"
    for field in (
        "edit_key",
        "reset_key",
        "confirm_key",
        "instant_reset_hotkey",
        "fast_confirm_hotkey",
        "turbo_hotkey",
        "cycle_hotkey",
    ):
        edit[field] = clean_key(edit.get(field))
    edit["scroll_reset"] = _as_bool(edit.get("scroll_reset"), True)
    edit["turbo_ms"] = _clamp(edit.get("turbo_ms"), 15, 150, 35)
    seen: list[str] = []
    for key in edit.get("cycle_keys") or []:
        cleaned = clean_key(key)
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    edit["cycle_keys"] = seen
    if edit["mode"] != "double":
        edit["confirm_key"] = edit["edit_key"]

    build = cfg["build"]
    build["place_key"] = clean_key(build.get("place_key")) or "mouse_left"
    build["auto_place"] = _as_bool(build.get("auto_place"), False)
    build["cycle_hotkey"] = clean_key(build.get("cycle_hotkey"))
    pieces = build["pieces"]
    for piece_id in PIECE_ORDER:
        piece = pieces[piece_id]
        fallback = base["build"]["pieces"][piece_id]["game_key"]
        piece["game_key"] = clean_key(piece.get("game_key")) or fallback
        piece["hotkey"] = clean_key(piece.get("hotkey"))
        piece["replace_hotkey"] = clean_key(piece.get("replace_hotkey"))
        piece["in_cycle"] = _as_bool(piece.get("in_cycle"), piece_id != "trap")

    extras = cfg["extras"]
    extras["pickup_key"] = clean_key(extras.get("pickup_key")) or "e"
    extras["pickup_hotkey"] = clean_key(extras.get("pickup_hotkey"))
    extras["pickup_ms"] = _clamp(extras.get("pickup_ms"), 15, 150, 40)
    extras["slot_cycle_hotkey"] = clean_key(extras.get("slot_cycle_hotkey"))
    for slot_id, slot in extras["slots"].items():
        slot["game_key"] = clean_key(slot.get("game_key")) or slot_id
        slot["hotkey"] = clean_key(slot.get("hotkey"))

    cleaned_profiles = []
    for profile in cfg.get("profiles") or []:
        if not isinstance(profile, dict):
            continue
        name = str(profile.get("name") or "").strip()
        if not name:
            continue
        mode = profile.get("mode")
        if mode not in MODES:
            mode = "release"
        edit_key = clean_key(profile.get("edit_key"))
        cleaned_profiles.append(
            {
                "name": name[:32],
                "edit_key": edit_key,
                "reset_key": clean_key(profile.get("reset_key")),
                "confirm_key": edit_key if mode != "double" else clean_key(profile.get("confirm_key")),
                "mode": mode,
            }
        )
    cfg["profiles"] = cleaned_profiles
    cfg["active_profile"] = str(cfg.get("active_profile") or "")
    return cfg


def load_config(path: Path | None = None) -> dict:
    path = Path(path) if path else CONFIG_PATH
    if not path.exists():
        return clamp_config(default_config())
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return clamp_config(default_config())
    return clamp_config(merge(default_config(), loaded))


def save_config(cfg: dict, path: Path | None = None) -> None:
    path = Path(path) if path else CONFIG_PATH
    clamp_config(cfg)
    path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def apply_profile(cfg: dict, profile: dict) -> None:
    edit = cfg["edit"]
    edit["mode"] = profile["mode"]
    edit["edit_key"] = profile["edit_key"]
    edit["reset_key"] = profile["reset_key"]
    edit["confirm_key"] = profile["confirm_key"] if profile["mode"] == "double" else profile["edit_key"]
    cfg["active_profile"] = profile["name"]


def upsert_profile(cfg: dict, name: str) -> bool:
    name = name.strip()[:32]
    if not name:
        return False
    edit = cfg["edit"]
    snap = {
        "name": name,
        "edit_key": edit["edit_key"],
        "reset_key": edit["reset_key"],
        "confirm_key": edit["confirm_key"],
        "mode": edit["mode"],
    }
    for index, profile in enumerate(cfg["profiles"]):
        if profile["name"] == name:
            cfg["profiles"][index] = snap
            break
    else:
        cfg["profiles"].append(snap)
    cfg["active_profile"] = name
    return True


def delete_profile(cfg: dict, name: str) -> None:
    cfg["profiles"] = [profile for profile in cfg["profiles"] if profile["name"] != name]
    if cfg["active_profile"] == name:
        cfg["active_profile"] = ""


def cycle_edit_key(cfg: dict) -> str:
    keys = [key for key in cfg["edit"]["cycle_keys"] if key]
    if not keys:
        return cfg["edit"]["edit_key"]
    current = cfg["edit"]["edit_key"]
    index = (keys.index(current) + 1) % len(keys) if current in keys else 0
    new = keys[index]
    cfg["edit"]["edit_key"] = new
    if cfg["edit"]["mode"] != "double":
        cfg["edit"]["confirm_key"] = new
    cfg["active_profile"] = ""
    return new


def cycle_profile(cfg: dict) -> str:
    profiles = cfg["profiles"]
    if not profiles:
        return ""
    names = [profile["name"] for profile in profiles]
    current = cfg.get("active_profile") or ""
    index = (names.index(current) + 1) % len(names) if current in names else 0
    apply_profile(cfg, profiles[index])
    return profiles[index]["name"]


def next_in_cycle(items: list[str], index: int) -> tuple[str | None, int]:
    if not items:
        return None, 0
    index = index % len(items)
    return items[index], (index + 1) % len(items)


def apply_preset(cfg: dict, name: str) -> None:
    presets = {
        "stabil": (12, 3),
        "hurtig": (6, 1),
        "instant": (1, 0),
    }
    if name not in presets:
        return
    cfg["step_ms"], cfg["jitter_ms"] = presets[name]


def recommend(cfg: dict) -> None:
    """En opsætning der er hurtig uden at blive ustabil."""
    edit = cfg["edit"]
    edit["mode"] = "release"
    edit["edit_key"] = "f"
    edit["reset_key"] = "g"
    edit["confirm_key"] = "f"
    edit["instant_reset_hotkey"] = "mouse_x1"
    edit["fast_confirm_hotkey"] = ""
    edit["turbo_hotkey"] = ""
    edit["turbo_ms"] = 35
    edit["scroll_reset"] = True
    edit["scroll_direction"] = "both"
    edit["cycle_hotkey"] = "f6"
    edit["cycle_keys"] = ["f", "mouse_x2", "g"]
    cfg["step_ms"] = 6
    cfg["jitter_ms"] = 1
    cfg["only_fortnite"] = True
    cfg["master_toggle"] = "f8"
    cfg["active_profile"] = ""
