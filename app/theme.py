"""Udseende. Barlow Condensed ligger med i fonts/ og registreres ved start."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BG = "#07080c"
RAIL = "#0c0e13"
PANEL = "#121722"
STRIP = "#161c28"
KEY = "#1c2433"
LINE = "#313b4f"
TEXT = "#f4f7fb"
MUTED = "#8d98ab"
LIME = "#d6ff3c"
LIME_INK = "#101406"
HOT = "#ff3d5a"
WARN = "#ffc14d"
AMBER_BG = "#2a2110"

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
    display = next((name for name in ("Barlow Condensed", "Segoe UI", "Cantarell") if name in have), "Cantarell")
    mono = next(
        (name for name in ("JetBrains Mono", "Cascadia Mono", "Cascadia Code", "Consolas", "DejaVu Sans Mono") if name in have),
        "DejaVu Sans Mono",
    )
    return display, mono
