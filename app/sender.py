"""Sender tastetryk via pynput. Importeres først når makroen starter."""

from __future__ import annotations

from app.keys import MOUSE_KEYS


class UnavailableSender:
    def __init__(self, reason: str):
        self.reason = reason

    def down(self, key: str) -> None:
        raise RuntimeError(self.reason)

    def up(self, key: str) -> None:
        raise RuntimeError(self.reason)

    def scroll(self, amount: int) -> None:
        raise RuntimeError(self.reason)


class PynputSender:
    def __init__(self):
        from pynput.keyboard import Controller as Keyboard
        from pynput.keyboard import Key
        from pynput.mouse import Button
        from pynput.mouse import Controller as Mouse

        self.keyboard = Keyboard()
        self.mouse = Mouse()
        self._keys = {
            "space": Key.space,
            "shift": Key.shift,
            "ctrl": Key.ctrl,
            "alt": Key.alt,
            "tab": Key.tab,
            "caps_lock": Key.caps_lock,
            "enter": Key.enter,
            "esc": Key.esc,
            "backspace": Key.backspace,
            "delete": Key.delete,
            "insert": Key.insert,
            "up": Key.up,
            "down": Key.down,
            "left": Key.left,
            "right": Key.right,
            "home": Key.home,
            "end": Key.end,
            "page_up": Key.page_up,
            "page_down": Key.page_down,
            "cmd": Key.cmd,
            "f1": Key.f1,
            "f2": Key.f2,
            "f3": Key.f3,
            "f4": Key.f4,
            "f5": Key.f5,
            "f6": Key.f6,
            "f7": Key.f7,
            "f8": Key.f8,
            "f9": Key.f9,
            "f10": Key.f10,
            "f11": Key.f11,
            "f12": Key.f12,
        }
        self._buttons = {
            "mouse_left": Button.left,
            "mouse_right": Button.right,
            "mouse_middle": Button.middle,
            "mouse_x1": Button.x1,
            "mouse_x2": Button.x2,
        }

    def down(self, key: str) -> None:
        if key in self._buttons:
            self.mouse.press(self._buttons[key])
            return
        if key in ("scroll_up", "scroll_down"):
            self.scroll(1 if key == "scroll_up" else -1)
            return
        self.keyboard.press(self._keys.get(key, key))

    def up(self, key: str) -> None:
        if key in MOUSE_KEYS and key in self._buttons:
            self.mouse.release(self._buttons[key])
            return
        if key in ("scroll_up", "scroll_down"):
            return
        self.keyboard.release(self._keys.get(key, key))

    def scroll(self, amount: int) -> None:
        self.mouse.scroll(0, amount)


def build_sender():
    try:
        return PynputSender()
    except Exception as exc:
        return UnavailableSender(f"pynput kunne ikke starte ({exc})")
