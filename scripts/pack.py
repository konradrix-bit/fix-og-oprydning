#!/usr/bin/env python3
"""Zip the bot with index.js at the archive root, ready for Wispbyte."""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "bot.zip"
INCLUDE = [
    "index.js",
    "package.json",
    "package-lock.json",
    "README.md",
    ".env.example",
    ".gitignore",
    "data/.gitkeep",
]


def main() -> None:
    files = [ROOT / name for name in INCLUDE]
    files.extend(sorted((ROOT / "src").glob("*.js")))
    missing = [str(path) for path in files if not path.is_file()]
    if missing:
        raise SystemExit(f"Mangler filer: {', '.join(missing)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())
    print(OUT)


if __name__ == "__main__":
    main()
