"""Navne på taster, visning og Windows-koder.

Makroen bruger sine egne navne ("f", "mouse_x1", "scroll_up"), så resten af
koden ikke behøver at kende pynput eller virtuelle key codes.
"""

from __future__ import annotations

import re

WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105

WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
WM_RBUTTONDOWN = 0x0204
WM_RBUTTONUP = 0x0205
WM_MBUTTONDOWN = 0x0207
WM_MBUTTONUP = 0x0208
WM_MOUSEWHEEL = 0x020A
WM_XBUTTONDOWN = 0x020B
WM_XBUTTONUP = 0x020C

LLKHF_INJECTED = 0x00000010
LLKHF_LOWER_IL_INJECTED = 0x00000002
LLMHF_INJECTED = 0x00000001
LLMHF_LOWER_IL_INJECTED = 0x00000002

# Virtuelle koder der ikke er bogstaver. Bogstaver og tal regnes ud direkte.
_VK_TO_NAME = {
    1: "mouse_left",
    2: "mouse_right",
    4: "mouse_middle",
    5: "mouse_x1",
    6: "mouse_x2",
    8: "backspace",
    9: "tab",
    13: "enter",
    16: "shift",
    17: "ctrl",
    18: "alt",
    20: "caps_lock",
    27: "esc",
    32: "space",
    33: "page_up",
    34: "page_down",
    35: "end",
    36: "home",
    37: "left",
    38: "up",
    39: "right",
    40: "down",
    45: "insert",
    46: "delete",
    91: "cmd",
    92: "cmd",
    160: "shift",
    161: "shift",
    162: "ctrl",
    163: "ctrl",
    164: "alt",
    165: "alt",
    112: "f1",
    113: "f2",
    114: "f3",
    115: "f4",
    116: "f5",
    117: "f6",
    118: "f7",
    119: "f8",
    120: "f9",
    121: "f10",
    122: "f11",
    123: "f12",
}

_NAME_TO_VK = {
    "mouse_left": 1,
    "mouse_right": 2,
    "mouse_middle": 4,
    "mouse_x1": 5,
    "mouse_x2": 6,
    "backspace": 8,
    "tab": 9,
    "enter": 13,
    "shift": 16,
    "ctrl": 17,
    "alt": 18,
    "caps_lock": 20,
    "esc": 27,
    "space": 32,
    "page_up": 33,
    "page_down": 34,
    "end": 35,
    "home": 36,
    "left": 37,
    "up": 38,
    "right": 39,
    "down": 40,
    "insert": 45,
    "delete": 46,
    "cmd": 91,
}
for _vk, _name in list(_VK_TO_NAME.items()):
    if _name.startswith("f") and _name[1:].isdigit():
        _NAME_TO_VK[_name] = _vk

LABELS = {
    "mouse_left": "Venstreklik",
    "mouse_right": "Højreklik",
    "mouse_middle": "Midterklik",
    "mouse_x1": "Mus side 1",
    "mouse_x2": "Mus side 2",
    "scroll_up": "Scroll op",
    "scroll_down": "Scroll ned",
    "space": "Mellemrum",
    "shift": "Shift",
    "ctrl": "Ctrl",
    "alt": "Alt",
    "tab": "Tab",
    "caps_lock": "Caps Lock",
    "enter": "Enter",
    "esc": "Esc",
    "backspace": "Backspace",
    "delete": "Delete",
    "insert": "Insert",
    "up": "Pil op",
    "down": "Pil ned",
    "left": "Pil venstre",
    "right": "Pil højre",
    "home": "Home",
    "end": "End",
    "page_up": "Page Up",
    "page_down": "Page Down",
    "cmd": "Win",
}

PULSE_KEYS = frozenset({"scroll_up", "scroll_down"})
MOUSE_KEYS = frozenset(
    {"mouse_left", "mouse_right", "mouse_middle", "mouse_x1", "mouse_x2"}
)
_KEY_RE = re.compile(r"^[a-z0-9_]+$")


def display(name: str) -> str:
    if not name:
        return "Ikke sat"
    if name in LABELS:
        return LABELS[name]
    if len(name) == 1:
        return name.upper()
    return name.upper() if name.startswith("f") and name[1:].isdigit() else name


def clean_key(value) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip().lower()
    if not value:
        return ""
    if len(value) == 1 and value.isprintable() and value not in "\r\n\t":
        return value
    if _KEY_RE.fullmatch(value):
        return value
    return ""


def name_from_vk(vk: int) -> str:
    if 0x41 <= vk <= 0x5A:
        return chr(vk).lower()
    if 0x30 <= vk <= 0x39:
        return chr(vk)
    return _VK_TO_NAME.get(int(vk), "")


def vk_from_name(name: str) -> int | None:
    if len(name) == 1 and "a" <= name <= "z":
        return ord(name.upper())
    if len(name) == 1 and name.isdigit():
        return ord(name)
    return _NAME_TO_VK.get(name)


def keyboard_event(msg: int, vk: int) -> tuple[str, bool] | None:
    if msg in (WM_KEYDOWN, WM_SYSKEYDOWN):
        pressed = True
    elif msg in (WM_KEYUP, WM_SYSKEYUP):
        pressed = False
    else:
        return None
    return name_from_vk(vk), pressed


def mouse_event(msg: int, mouse_data: int) -> tuple[str, bool] | None:
    buttons = {
        WM_LBUTTONDOWN: ("mouse_left", True),
        WM_LBUTTONUP: ("mouse_left", False),
        WM_RBUTTONDOWN: ("mouse_right", True),
        WM_RBUTTONUP: ("mouse_right", False),
        WM_MBUTTONDOWN: ("mouse_middle", True),
        WM_MBUTTONUP: ("mouse_middle", False),
    }
    if msg in buttons:
        return buttons[msg]
    if msg in (WM_XBUTTONDOWN, WM_XBUTTONUP):
        which = (mouse_data >> 16) & 0xFFFF
        name = {1: "mouse_x1", 2: "mouse_x2"}.get(which, "")
        if not name:
            return None
        return name, msg == WM_XBUTTONDOWN
    if msg == WM_MOUSEWHEEL:
        raw = (mouse_data >> 16) & 0xFFFF
        if raw >= 0x8000:
            raw -= 0x10000
        if raw > 0:
            return "scroll_up", True
        if raw < 0:
            return "scroll_down", True
    return None


def is_injected_keyboard(flags: int) -> bool:
    return bool(flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED))


def is_injected_mouse(flags: int) -> bool:
    return bool(flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED))


def button_name(name: str) -> str:
    return {
        "left": "mouse_left",
        "right": "mouse_right",
        "middle": "mouse_middle",
        "x1": "mouse_x1",
        "x2": "mouse_x2",
    }.get(name, "")
