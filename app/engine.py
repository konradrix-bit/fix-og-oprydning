"""Lytter efter genveje og sender sekvenserne.

Tastatur-hooken må ikke selv kalde SendInput. Den lægger bare hændelsen i en
kø, og en worker sender tasterne bagefter. Ellers kan Windows hænge.
"""

from __future__ import annotations

import queue
import sys
import threading
import time
from collections import deque

from app.bindings import resolve
from app.config import PIECE_ORDER, cycle_edit_key, cycle_profile, next_in_cycle
from app.keys import (
    PULSE_KEYS,
    button_name,
    display,
    is_injected_keyboard,
    is_injected_mouse,
    keyboard_event,
    mouse_event,
)
from app.sequences import (
    execute,
    fast_confirm,
    instant_reset,
    reset_only,
    select_piece,
)
from app.system import focus_allows, foreground_title, key_is_down


class _Guard:
    def __init__(self, engine: "Engine"):
        self.engine = engine

    def down(self, key: str) -> None:
        self.engine._mark_sent(key)
        self.engine.sender.down(key)
        self.engine.output_held.add(key)

    def up(self, key: str) -> None:
        self.engine._mark_sent(key)
        self.engine.sender.up(key)
        self.engine.output_held.discard(key)

    def scroll(self, amount: int) -> None:
        self.engine._mark_sent("scroll_up" if amount > 0 else "scroll_down")
        self.engine.sender.scroll(amount)


class Engine:
    def __init__(self, cfg: dict, sender=None, on_event=None, title_provider=None, key_down=None):
        self.cfg = cfg
        self.sender = sender
        self.on_event = on_event or (lambda *_args: None)
        self.title_provider = title_provider or foreground_title
        self.key_down = key_down or key_is_down
        self.platform = sys.platform
        self.trust_injected = sys.platform == "win32"
        self.enabled = bool(cfg.get("enabled", False))
        self.edit_held = False
        self.physically_held: set[str] = set()
        self.output_held: set[str] = set()
        self.capture = None
        self.log: deque[str] = deque(maxlen=40)
        self.sleep_ms = _precise_sleep
        self._queue: queue.Queue = queue.Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._send_lock = threading.Lock()
        self._lock = threading.RLock()
        self._kb = None
        self._mouse = None
        self._guard = _Guard(self)
        self._synth: dict[str, int] = {}
        self._build_index = 0
        self._slot_index = 0
        self._turbo_next = 0.0
        self._pickup_next = 0.0
        self._focus_checked = 0.0
        self._focus_value = False
        self._rng = __import__("random")

    def start(self) -> None:
        if self.sender is None:
            from app.sender import build_sender

            self.sender = build_sender()
        if self._thread is None:
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="fortnite-macro", daemon=True)
            self._thread.start()
        self._start_listeners()

    def shutdown(self) -> None:
        self._stop.set()
        self._release_outputs()
        for listener in (self._kb, self._mouse):
            if listener is not None:
                try:
                    listener.stop()
                except Exception:
                    pass
        self._kb = None
        self._mouse = None

    def begin_capture(self, callback) -> None:
        with self._lock:
            self.capture = callback

    def cancel_capture(self) -> None:
        with self._lock:
            self.capture = None

    def run_action(self, action: str, force: bool = False) -> None:
        threading.Thread(
            target=self._run_action,
            args=(action, force),
            name="macro-test",
            daemon=True,
        ).start()

    def should_swallow(self, name: str) -> bool:
        with self._lock:
            if not name:
                return False
            if self.capture is not None:
                return True
            if not self.enabled or not self._focused():
                return False
            master, actions, _dupes = resolve(self.cfg)
            if name == master:
                return False
            return name in actions

    def note(self, text: str) -> None:
        self.log.append(text)
        self.on_event("log", text)

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._service_holds()
            try:
                item = self._queue.get(timeout=0.01)
            except queue.Empty:
                continue
            try:
                self._dispatch(*item)
            except Exception as exc:
                self.note(f"Fejl: {exc}")

    def _start_listeners(self) -> None:
        try:
            from pynput import keyboard, mouse
        except Exception as exc:
            self.note(f"Genveje virker ikke her: {exc}")
            return
        try:
            self._kb = keyboard.Listener(
                on_press=self._on_press,
                on_release=self._on_release,
                win32_event_filter=self._keyboard_filter,
            )
            self._mouse = mouse.Listener(
                on_click=self._on_click,
                on_scroll=self._on_scroll,
                win32_event_filter=self._mouse_filter,
            )
            self._kb.start()
            self._mouse.start()
            self.note("Lytter efter genveje")
        except Exception as exc:
            self.note(f"Kunne ikke lytte: {exc}")

    def _keyboard_filter(self, msg, data) -> bool:
        if is_injected_keyboard(int(data.flags)):
            return False
        parsed = keyboard_event(int(msg), int(data.vkCode))
        if parsed is None or not parsed[0]:
            return True
        name, pressed = parsed
        if self.should_swallow(name):
            self._queue.put((name, pressed, False))
            self._kb.suppress_event()
        return True

    def _mouse_filter(self, msg, data) -> bool:
        if is_injected_mouse(int(data.flags)):
            return False
        parsed = mouse_event(int(msg), int(data.mouseData))
        if parsed is None:
            return True
        name, pressed = parsed
        if self.should_swallow(name):
            self._queue.put((name, pressed, False))
            self._mouse.suppress_event()
        return True

    def _on_press(self, key, injected=False) -> None:
        name = _from_pynput_key(key)
        if name:
            self._queue.put((name, True, bool(injected)))

    def _on_release(self, key, injected=False) -> None:
        name = _from_pynput_key(key)
        if name:
            self._queue.put((name, False, bool(injected)))

    def _on_click(self, _x, _y, button, pressed, injected=False) -> None:
        name = button_name(getattr(button, "name", ""))
        if name:
            self._queue.put((name, bool(pressed), bool(injected)))

    def _on_scroll(self, _x, _y, _dx, dy, injected=False) -> None:
        if dy > 0:
            self._queue.put(("scroll_up", True, bool(injected)))
        elif dy < 0:
            self._queue.put(("scroll_down", True, bool(injected)))

    def _dispatch(self, name: str, pressed: bool, injected: bool = False) -> None:
        if injected:
            return
        if not self.trust_injected and self._synth.get(name, 0) > 0:
            self._synth[name] -= 1
            return

        callback = None
        captured = None
        with self._lock:
            if self.capture is not None and pressed:
                callback = self.capture
                self.capture = None
                if name == "esc":
                    captured = None
                elif name == "delete":
                    captured = ""
                else:
                    captured = name
            elif name in PULSE_KEYS:
                if not pressed:
                    return
            elif pressed:
                if name in self.physically_held:
                    return
                self.physically_held.add(name)
            else:
                self.physically_held.discard(name)

        if callback is not None:
            if callable(callback):
                callback(captured)
            self.on_event("capture", captured)
            if captured:
                self.note(f"Tast sat: {display(captured)}")
            elif captured is None:
                self.note("Binding annulleret")
            else:
                self.note("Tast ryddet")
            return

        master, actions, _dupes = resolve(self.cfg)
        if name == master and pressed:
            self._toggle()
            return
        if not self._can_run():
            return
        action = actions.get(name)
        if action == "edit_hold":
            self._edit_hold(pressed)
            return
        if not pressed or action in (None, "turbo", "pickup"):
            self._service_holds()
            return
        self._run_action(action, force=False)
        self._service_holds()

    def _toggle(self) -> None:
        release = None
        with self._lock:
            self.enabled = not self.enabled
            self.cfg["enabled"] = self.enabled
            if not self.enabled:
                self.edit_held = False
                release = True
        if release:
            self._release_outputs()
        state = "Makro til" if self.enabled else "Makro fra"
        self.note(state)
        self.on_event("toggle", self.enabled)

    def _can_run(self) -> bool:
        with self._lock:
            return self.enabled and self._focused()

    def _focused(self) -> bool:
        if not self.cfg.get("only_fortnite", True):
            return True
        now = time.perf_counter()
        if now - self._focus_checked > 0.1:
            try:
                title = self.title_provider()
            except Exception:
                title = ""
            self._focus_value = focus_allows(True, title, self.platform)
            self._focus_checked = now
        return self._focus_value

    def _edit_hold(self, pressed: bool) -> None:
        with self._lock:
            edit = self.cfg["edit"]["edit_key"]
            if not edit:
                return
            self.edit_held = pressed
        if pressed:
            self._perform([_down(edit)], "Edit åben")
        else:
            self._perform([_up(edit)], "Edit bekræftet")

    def _run_action(self, action: str, force: bool = False) -> None:
        with self._lock:
            if not force and not (self.enabled and self._focused()):
                return
            actions, message, changed = self._plan(action)
        if changed:
            self.on_event("changed", None)
        if actions:
            self._perform(actions, message or action)
        elif message:
            self.note(message if changed else f"{message}: ingen taster sat")

    def _plan(self, action: str):
        edit = self.cfg["edit"]
        step = self.cfg["step_ms"]
        mode = edit["mode"]
        if action in ("instant_reset", "scroll_reset"):
            if self.edit_held and mode == "release":
                return reset_only(edit["reset_key"], step), "Reset", False
            return (
                instant_reset(edit["edit_key"], edit["reset_key"], edit["confirm_key"], step, mode),
                "Hurtig reset",
                False,
            )
        if action == "fast_confirm":
            return (
                fast_confirm(edit["edit_key"], edit["confirm_key"], step, mode),
                "Hurtig edit",
                False,
            )
        if action == "cycle_edit":
            new = cycle_edit_key(self.cfg)
            self._beep()
            return None, f"Edit-tast {display(new)}", True
        if action == "cycle_profile":
            name = cycle_profile(self.cfg)
            self._beep()
            return None, f"Profil {name}" if name else "Ingen profiler", True
        if action == "cycle_build":
            piece_id, self._build_index = next_in_cycle(self._cycle_pieces(), self._build_index)
            if not piece_id:
                return None, "Ingen byggedele i skiftet", False
            return self._piece_actions(piece_id, replace=False), f"Byg {self._piece_label(piece_id)}", False
        if action.startswith("piece:"):
            return self._piece_actions(action.split(":", 1)[1], replace=False), "Byg", False
        if action.startswith("replace:"):
            piece_id = action.split(":", 1)[1]
            return self._piece_actions(piece_id, replace=True), f"Replace {self._piece_label(piece_id)}", False
        if action == "cycle_slot":
            slot_id, self._slot_index = next_in_cycle(list(self.cfg["extras"]["slots"]), self._slot_index)
            if not slot_id:
                return None, "Ingen våben-slots", False
            return self._slot_actions(slot_id), f"Våben {slot_id}", False
        if action.startswith("slot:"):
            return self._slot_actions(action.split(":", 1)[1]), "Våben", False
        return None, None, False

    def _piece_actions(self, piece_id: str, replace: bool):
        piece = self.cfg["build"]["pieces"].get(piece_id)
        if not piece:
            return []
        return select_piece(
            piece["game_key"],
            self.cfg["build"]["place_key"],
            self.cfg["step_ms"],
            True if replace else self.cfg["build"]["auto_place"],
        )

    def _slot_actions(self, slot_id: str):
        slot = self.cfg["extras"]["slots"].get(slot_id)
        if not slot or not slot.get("game_key"):
            return []
        from app.sequences import Action

        return [Action("tap", slot["game_key"], hold_ms=max(1, self.cfg["step_ms"]), delay_ms=0)]

    def _cycle_pieces(self) -> list[str]:
        return [
            piece_id
            for piece_id in PIECE_ORDER
            if self.cfg["build"]["pieces"][piece_id].get("in_cycle")
        ]

    def _piece_label(self, piece_id: str) -> str:
        return {"wall": "væg", "floor": "gulv", "ramp": "rampe", "cone": "kegle", "trap": "fælde"}.get(
            piece_id, piece_id
        )

    def _service_holds(self) -> None:
        release_edit = None
        turbo = None
        pickup = None
        with self._lock:
            if not self.enabled or not self._focused():
                if self.edit_held:
                    self.edit_held = False
                    release_edit = self.cfg["edit"]["edit_key"]
            else:
                edit = self.cfg["edit"]["edit_key"]
                if self.edit_held and edit and self.key_down(edit) is False:
                    self.edit_held = False
                    self.physically_held.discard(edit)
                    release_edit = edit
                now = time.perf_counter()
                if edit and self.cfg["edit"]["turbo_hotkey"] in self.physically_held and now >= self._turbo_next:
                    self._turbo_next = now + self.cfg["edit"]["turbo_ms"] / 1000
                    turbo = True
                pickup_key = self.cfg["extras"]["pickup_hotkey"]
                if pickup_key and pickup_key in self.physically_held and now >= self._pickup_next:
                    self._pickup_next = now + self.cfg["extras"]["pickup_ms"] / 1000
                    pickup = self.cfg["extras"]["pickup_key"]
        if release_edit:
            self._perform([_up(release_edit)], "Edit sluppet")
        if turbo:
            self._run_action("instant_reset", force=False)
        if pickup:
            self._perform(_tap(pickup), "Saml op")

    def _perform(self, actions, label: str) -> None:
        if not actions:
            self.note(f"{label}: ingen taster sat")
            return
        self.note(label)
        try:
            with self._send_lock:
                execute(
                    actions,
                    self._guard,
                    self.sleep_ms,
                    jitter_ms=int(self.cfg.get("jitter_ms", 0)),
                    rng=self._rng,
                )
        except Exception as exc:
            self.note(f"Kunne ikke sende taster: {exc}")

    def _release_outputs(self) -> None:
        stuck = list(self.output_held)
        self.output_held.clear()
        self.edit_held = False
        for key in stuck:
            try:
                self.sender.up(key)
            except Exception:
                pass

    def _mark_sent(self, key: str) -> None:
        self._synth[key] = self._synth.get(key, 0) + 1

    def _beep(self) -> None:
        if not self.cfg.get("beep_on_switch", True):
            return
        try:
            if sys.platform == "win32":
                import winsound

                winsound.Beep(880, 40)
            else:
                sys.stdout.write("\a")
                sys.stdout.flush()
        except Exception:
            pass


def _down(key: str):
    from app.sequences import Action

    return Action("down", key, delay_ms=0)


def _up(key: str):
    from app.sequences import Action

    return Action("up", key, delay_ms=0)


def _tap(key: str):
    from app.sequences import Action

    if not key:
        return []
    return [Action("tap", key, hold_ms=1, delay_ms=0)]


def _precise_sleep(ms: float) -> None:
    if ms <= 0:
        return
    end = time.perf_counter() + (ms / 1000)
    if ms >= 8:
        time.sleep((ms - 3) / 1000)
    while time.perf_counter() < end:
        pass


def _from_pynput_key(key) -> str:
    try:
        from pynput.keyboard import Key, KeyCode
    except Exception:
        return ""
    if isinstance(key, Key):
        mapping = {
            Key.space: "space",
            Key.shift: "shift",
            Key.shift_l: "shift",
            Key.shift_r: "shift",
            Key.ctrl: "ctrl",
            Key.ctrl_l: "ctrl",
            Key.ctrl_r: "ctrl",
            Key.alt: "alt",
            Key.alt_l: "alt",
            Key.alt_r: "alt",
            Key.tab: "tab",
            Key.caps_lock: "caps_lock",
            Key.enter: "enter",
            Key.esc: "esc",
            Key.backspace: "backspace",
            Key.delete: "delete",
            Key.insert: "insert",
            Key.up: "up",
            Key.down: "down",
            Key.left: "left",
            Key.right: "right",
            Key.home: "home",
            Key.end: "end",
            Key.page_up: "page_up",
            Key.page_down: "page_down",
            Key.cmd: "cmd",
            Key.cmd_l: "cmd",
            Key.cmd_r: "cmd",
            Key.f1: "f1",
            Key.f2: "f2",
            Key.f3: "f3",
            Key.f4: "f4",
            Key.f5: "f5",
            Key.f6: "f6",
            Key.f7: "f7",
            Key.f8: "f8",
            Key.f9: "f9",
            Key.f10: "f10",
            Key.f11: "f11",
            Key.f12: "f12",
        }
        return mapping.get(key, "")
    if isinstance(key, KeyCode) and key.char:
        char = key.char.lower()
        if len(char) == 1 and char.isprintable():
            return char
    return ""
