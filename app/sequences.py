"""Rækkefølgen af tastetryk. Ingen hooks her, så den kan testes direkte."""

from __future__ import annotations

import random
from dataclasses import dataclass

from app.keys import display


@dataclass(frozen=True)
class Action:
    kind: str
    key: str = ""
    delay_ms: int = 0
    hold_ms: int = 0
    scroll: int = 0


def _gap(step: int) -> int:
    return max(0, int(step))


def _hold(step: int) -> int:
    return max(1, int(step))


def _reset(reset: str, gap: int, hold: int) -> list[Action]:
    if reset == "scroll_up":
        return [Action("scroll", scroll=1, delay_ms=gap)]
    if reset == "scroll_down":
        return [Action("scroll", scroll=-1, delay_ms=gap)]
    if not reset:
        return []
    return [Action("tap", reset, hold_ms=hold, delay_ms=gap)]


def instant_reset(edit: str, reset: str, confirm: str, step: int, mode: str) -> list[Action]:
    """Åbn edit, reset stykket, bekræft. Formen følger edit-måden."""
    if not edit:
        return []
    gap = _gap(step)
    hold = _hold(step)
    if mode == "release":
        return [
            Action("down", edit, delay_ms=gap),
            *_reset(reset, gap, hold),
            Action("up", edit, delay_ms=0),
        ]
    if mode == "double" and confirm and confirm != edit:
        return [
            Action("tap", edit, hold_ms=hold, delay_ms=gap),
            *_reset(reset, gap, hold),
            Action("tap", confirm, hold_ms=hold, delay_ms=0),
        ]
    return [
        Action("tap", edit, hold_ms=hold, delay_ms=gap),
        *_reset(reset, gap, hold),
        Action("tap", confirm or edit, hold_ms=hold, delay_ms=0),
    ]


def fast_confirm(edit: str, confirm: str, step: int, mode: str) -> list[Action]:
    """Edit uden reset: åbn og bekræft med det samme."""
    if not edit:
        return []
    gap = _gap(step)
    hold = _hold(step)
    if mode == "release":
        return [Action("down", edit, delay_ms=gap), Action("up", edit, delay_ms=0)]
    if mode == "double" and confirm and confirm != edit:
        return [
            Action("tap", edit, hold_ms=hold, delay_ms=gap),
            Action("tap", confirm, hold_ms=hold, delay_ms=0),
        ]
    return [
        Action("tap", edit, hold_ms=hold, delay_ms=gap),
        Action("tap", confirm or edit, hold_ms=hold, delay_ms=0),
    ]


def reset_only(reset: str, step: int) -> list[Action]:
    """Edit er allerede åben. Send kun reset."""
    return _reset(reset, 0, _hold(step))


def select_piece(game_key: str, place_key: str, step: int, auto_place: bool) -> list[Action]:
    if not game_key:
        return []
    hold = _hold(step)
    gap = _gap(step)
    actions = [Action("tap", game_key, hold_ms=hold, delay_ms=gap if auto_place else 0)]
    if auto_place and place_key:
        actions.append(Action("tap", place_key, hold_ms=hold, delay_ms=0))
    return actions


def execute(actions: list[Action], sender, sleep_ms, jitter_ms: int = 0, rng=None) -> None:
    rng = rng or random
    for action in actions:
        if action.kind == "down":
            if action.key:
                sender.down(action.key)
        elif action.kind == "up":
            if action.key:
                sender.up(action.key)
        elif action.kind == "tap":
            if action.key:
                sender.down(action.key)
                if action.hold_ms:
                    sleep_ms(action.hold_ms)
                sender.up(action.key)
        elif action.kind == "scroll":
            sender.scroll(action.scroll)
        pause = action.delay_ms
        if pause and jitter_ms:
            pause += rng.randint(0, int(jitter_ms))
        if pause:
            sleep_ms(pause)


def describe(actions: list[Action]) -> list[str]:
    lines = []
    for action in actions:
        if action.kind == "down":
            text = f"Hold {display(action.key)}"
        elif action.kind == "up":
            text = f"Slip {display(action.key)}"
        elif action.kind == "tap":
            text = f"Tryk {display(action.key)}"
        elif action.kind == "scroll":
            text = "Scroll op" if action.scroll > 0 else "Scroll ned"
        else:
            continue
        lines.append(f"{len(lines) + 1}. {text}")
    return lines


MODE_TITLE = {
    "release": "Ved slip",
    "same_key": "Samme tast",
    "double": "To taster",
}


def summary(cfg: dict) -> str:
    edit = cfg["edit"]
    step = cfg["step_ms"]
    mode = edit["mode"]
    lines = [
        f"Tilstand: {MODE_TITLE.get(mode, mode)}",
        f"Edit {display(edit['edit_key'])}  ·  Reset {display(edit['reset_key'])}  ·  Bekræft {display(edit['confirm_key'])}",
        f"Forsinkelse {cfg['step_ms']} ms",
        f"Tilfældig pause {cfg['jitter_ms']} ms",
        "",
        "Hurtig reset",
    ]
    reset = instant_reset(edit["edit_key"], edit["reset_key"], edit["confirm_key"], step, mode)
    lines.extend(describe(reset) or ["  Sæt en edit-tast"])
    lines.extend(["", "Hurtig edit"])
    lines.extend(describe(fast_confirm(edit["edit_key"], edit["confirm_key"], step, mode)) or ["  Sæt en edit-tast"])
    if mode == "release":
        lines.extend(
            [
                "",
                "Edit ved slip",
                f"1. Hold {display(edit['edit_key'])}",
                "2. Vælg felter med musen",
                f"3. Slip {display(edit['edit_key'])}",
                "Scroll eller hurtig reset mens du holder edit sender kun reset.",
            ]
        )
    if mode == "double" and edit["confirm_key"] == edit["edit_key"]:
        lines.extend(["", "Vælg en anden bekræft-tast end edit-tasten."])
    return "\n".join(lines)
