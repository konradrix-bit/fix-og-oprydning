"""Udseende. Rajdhani ligger med i fonts/ og registreres ved start."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BG = "#0b0c0e"
RAIL = "#101114"
PANEL = "#16181c"
STRIP = "#1c1f25"
KEY = "#23262d"
LINE = "#2e323a"
TEXT = "#f3f4f6"
MUTED = "#8d929b"
ACCENT = "#f4f5f7"
ACCENT_INK = "#121316"
MARK = "#7aa2ff"
HOT = "#e25b5b"
OK = "#3dcc8e"
WARN = "#d7b15e"
AMBER_BG = "#2a2418"
HOVER = "#2a2e36"
HOVER_LIGHT = "#d9dbe0"

FONT_DIR = Path(__file__).resolve().parent.parent / "fonts"


def load_fonts() -> None:
    files = sorted(FONT_DIR.glob("*.ttf"))
    if not files:
        return
    if sys.platform == "win32":
        import ctypes

        for path in files:
            ctypes.windll.gdi32.AddFontResourceExW(str(path), 0x10, 0)
        return
    dest = Path.home() / ".local" / "share" / "fonts" / "fortnite-makro"
    dest.mkdir(parents=True, exist_ok=True)
    for path in files:
        target = dest / path.name
        data = path.read_bytes()
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
    subprocess.run(["fc-cache", "-f", str(dest)], check=False, capture_output=True)


def choose_fonts(root) -> tuple[str, str]:
    import tkinter.font as tkfont

    have = set(tkfont.families(root))
    display = next((name for name in ("Rajdhani", "Segoe UI", "Cantarell") if name in have), "Cantarell")
    mono = next(
        (name for name in ("JetBrains Mono", "Cascadia Mono", "Cascadia Code", "Consolas", "DejaVu Sans Mono") if name in have),
        "DejaVu Sans Mono",
    )
    return display, mono
