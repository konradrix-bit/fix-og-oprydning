"""Start Fortnite Makro."""

from __future__ import annotations

import sys

from app.config import load_config
from app.sequences import summary


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    cfg = load_config()
    if "--check" in argv:
        print(summary(cfg))
        return 0
    from app.ui import run

    run(cfg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
