"""Vindue i fokus og administrator. Kun Windows kan se Fortnite-vinduet."""

from __future__ import annotations

import sys

from app.keys import vk_from_name


def is_fortnite_title(title: str) -> bool:
    text = (title or "").casefold()
    if "fortnite" not in text:
        return False
    if "launcher" in text or "epic games" in text:
        return False
    return True


def focus_allows(only_fortnite: bool, title: str, platform: str) -> bool:
    if not only_fortnite:
        return True
    if platform != "win32":
        return True
    return is_fortnite_title(title)


def foreground_title() -> str:
    if sys.platform != "win32":
        return ""
    import ctypes

    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def is_admin() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except (AttributeError, OSError):
        return False


def key_is_down(name: str) -> bool | None:
    """True/False hvis Windows kan se tasten. None på andre systemer."""
    if sys.platform != "win32" or not name:
        return None
    vk = vk_from_name(name)
    if vk is None:
        return None
    import ctypes

    return bool(ctypes.windll.user32.GetAsyncKeyState(vk) & 0x8000)
