"""Hvilken genvej der gør hvad. Den første binding vinder, dubletter advares."""

from __future__ import annotations

from app.config import PIECE_ORDER
from app.keys import display


def iter_bindings(cfg: dict):
    edit = cfg["edit"]
    yield edit["instant_reset_hotkey"], "instant_reset"
    yield edit["fast_confirm_hotkey"], "fast_confirm"
    yield edit["turbo_hotkey"], "turbo"
    yield edit["cycle_hotkey"], "cycle_edit"
    if edit["mode"] == "release":
        yield edit["edit_key"], "edit_hold"
    if edit["scroll_reset"]:
        if edit["scroll_direction"] in ("up", "both"):
            yield "scroll_up", "scroll_reset"
        if edit["scroll_direction"] in ("down", "both"):
            yield "scroll_down", "scroll_reset"
    yield cfg["profile_cycle_hotkey"], "cycle_profile"
    build = cfg["build"]
    yield build["cycle_hotkey"], "cycle_build"
    for piece_id in PIECE_ORDER:
        piece = build["pieces"][piece_id]
        yield piece["hotkey"], f"piece:{piece_id}"
        yield piece["replace_hotkey"], f"replace:{piece_id}"
    extras = cfg["extras"]
    yield extras["pickup_hotkey"], "pickup"
    yield extras["slot_cycle_hotkey"], "cycle_slot"
    for slot_id, slot in extras["slots"].items():
        yield slot["hotkey"], f"slot:{slot_id}"


def resolve(cfg: dict) -> tuple[str, dict[str, str], list[tuple[str, str, str]]]:
    master = cfg["master_toggle"]
    actions: dict[str, str] = {}
    dupes: list[tuple[str, str, str]] = []
    for key, action in iter_bindings(cfg):
        if not key:
            continue
        if key == master:
            dupes.append((key, "master", action))
            continue
        if key in actions:
            dupes.append((key, actions[key], action))
            continue
        actions[key] = action
    return master, actions, dupes


def duplicate_text(dupes: list[tuple[str, str, str]]) -> str:
    if not dupes:
        return ""
    seen = []
    for key, _first, _second in dupes:
        label = display(key)
        if label not in seen:
            seen.append(label)
    return "Samme genvej er brugt flere steder: " + ", ".join(seen)
