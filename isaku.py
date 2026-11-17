#!/usr/bin/env python3
"""ISAKU — finder ledige 3- og 4-bogstavsnavne på guns.lol og Discord og sender dem til en webhook."""

from __future__ import annotations

import itertools
import os
import random
import string
import sys
import time
import shutil
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent
FOUND_FILE = ROOT / "fundet.txt"
GUNS_URL = "https://guns.lol/{name}"
CLAIM_URL = "https://guns.lol/register?claim={name}&ref=claim_user_page"
DISCORD_URL = "https://discord.com/api/v9/unique-username/username-attempt-unauthed"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
GUNS_DELAY = 0.35
DISCORD_DELAY = 1.2
PLACES = {"guns": "guns.lol", "discord": "Discord"}
WEBHOOK_HOSTS = {
    "discord.com",
    "discordapp.com",
    "canary.discord.com",
    "ptb.discord.com",
}

BANNER = """\
██╗███████╗ █████╗ ██╗  ██╗██╗   ██╗
██║██╔════╝██╔══██╗██║ ██╔╝██║   ██║
██║███████╗███████║█████╔╝ ██║   ██║
██║╚════██║██╔══██║██╔═██╗ ██║   ██║
██║███████║██║  ██║██║  ██╗╚██████╔╝
╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝"""

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"


def rgb(red: int, green: int, blue: int) -> str:
    return f"\033[38;2;{red};{green};{blue}m"


PURPLE = rgb(168, 85, 247)
PURPLE_DEEP = rgb(88, 28, 135)
PURPLE_SOFT = rgb(216, 180, 254)
PURPLE_HOT = rgb(192, 132, 252)
INK = rgb(245, 243, 255)
MUTED = rgb(161, 161, 170)
MINT = rgb(74, 222, 128)
ROSE = rgb(251, 113, 133)


def setup_console() -> None:
    if os.name == "nt":
        try:
            import ctypes

            handle = ctypes.windll.kernel32.GetStdHandle(-11)
            mode = ctypes.c_uint()
            if ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                ctypes.windll.kernel32.SetConsoleMode(handle, mode.value | 0x0004)
        except Exception:
            pass
    for stream in (sys.stdout, sys.stdin):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8")
        except Exception:
            pass


def terminal_width() -> int:
    return max(40, shutil.get_terminal_size((100, 30)).columns)


def center(text: str) -> str:
    pad = max(0, (terminal_width() - len(text)) // 2)
    return " " * pad + text


def write(text: str = "") -> None:
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def write_centered(plain: str, color: str) -> None:
    pad = max(0, (terminal_width() - len(plain)) // 2)
    sys.stdout.write(f"{' ' * pad}{color}{plain}{RESET}\n")


def paint_watermark() -> int:
    """Print the purple ISAKU watermark. Returns how many rows it used."""
    raw_lines = BANNER.splitlines()
    art_width = max(len(line) for line in raw_lines)
    lines = [line.ljust(art_width) for line in raw_lines]
    sys.stdout.write("\n")
    for line in lines:
        write_centered(line, BOLD + PURPLE)
    write_centered("━" * art_width, PURPLE_DEEP)
    write_centered("guns.lol   ·   discord", PURPLE_SOFT + DIM)
    sys.stdout.flush()
    return len(lines) + 3


def clear_screen() -> None:
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def ease(progress: float) -> float:
    progress = min(1.0, max(0.0, progress))
    return progress * progress * (3 - 2 * progress)


def loading_frame(percent: int, message: str) -> list[str]:
    bar_width = 32
    filled = round(bar_width * percent / 100)
    bar = "█" * filled + "░" * (bar_width - filled)
    inner = 42

    def fit(value: str) -> str:
        value = value[:inner]
        return value + " " * (inner - len(value))

    return [
        "┌" + "─" * (inner + 2) + "┐",
        "│ " + fit("LOADING") + " │",
        "│ " + fit(f"{bar}  {percent:3d}%") + " │",
        "│ " + fit(message) + " │",
        "└" + "─" * (inner + 2) + "┘",
    ]


def loading_screen() -> None:
    clear_screen()
    sys.stdout.write(HIDE_CURSOR)
    try:
        used = paint_watermark()
        write()
        origin = used + 2
        started = time.perf_counter()
        duration = 3.6
        messages = (
            (0.00, "starter isaku"),
            (0.16, "åbner session"),
            (0.34, "forbinder til guns.lol og discord"),
            (0.52, "klargør webhook"),
            (0.70, "bygger bogstavrum"),
            (0.86, "sidste detaljer"),
        )
        while True:
            progress = min(1.0, (time.perf_counter() - started) / duration)
            percent = int(ease(progress) * 100)
            message = messages[0][1]
            for threshold, label in messages:
                if progress >= threshold:
                    message = label
            frame = loading_frame(percent, message)
            colors = (PURPLE, BOLD + PURPLE_HOT, PURPLE, PURPLE_SOFT, PURPLE)
            for offset, (line, color) in enumerate(zip(frame, colors)):
                sys.stdout.write(f"\033[{origin + offset};1H{color}{center(line)}{RESET}")
            sys.stdout.flush()
            if progress >= 1:
                break
            time.sleep(0.045)
        time.sleep(0.45)
    finally:
        sys.stdout.write(SHOW_CURSOR)
        sys.stdout.flush()


def ask(label: str, hint: str) -> str:
    write()
    write(f"  {PURPLE}{label}{RESET}")
    write(f"  {MUTED}{hint}{RESET}")
    sys.stdout.write(f"  {PURPLE_HOT}›{RESET} ")
    sys.stdout.flush()
    return input().strip()


def valid_webhook(url: str) -> bool:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    return (
        parsed.scheme == "https"
        and host in WEBHOOK_HOSTS
        and "/api/webhooks/" in parsed.path
    )


def prompt_webhook() -> str:
    while True:
        value = ask("Webhook", "Indsæt din Discord-webhook")
        if valid_webhook(value):
            return value.strip()
        write(f"  {ROSE}Det skal være en https-webhook fra discord.com.{RESET}")


def prompt_count() -> int:
    while True:
        value = ask("Antal", "Hvor mange ledige navne vil du have?")
        if value.isdigit() and int(value) > 0:
            return int(value)
        write(f"  {ROSE}Skriv et helt tal over 0.{RESET}")


def prompt_length() -> int:
    while True:
        value = ask("Bogstaver", "Vælg 3 eller 4")
        if value in {"3", "4"}:
            return int(value)
        write(f"  {ROSE}Skriv 3 eller 4.{RESET}")


def prompt_places() -> list[str]:
    while True:
        value = ask("Sted", "1 guns.lol    2 discord    3 begge").lower()
        if value in {"1", "guns", "guns.lol"}:
            return ["guns"]
        if value in {"2", "discord", "dc"}:
            return ["discord"]
        if value in {"3", "begge", "alle", "both"}:
            return ["guns", "discord"]
        write(f"  {ROSE}Skriv 1, 2 eller 3.{RESET}")


def load_known(platform: str) -> set[str]:
    if not FOUND_FILE.exists():
        return set()
    names = set()
    for line in FOUND_FILE.read_text(encoding="utf-8").splitlines():
        raw = line.strip().lower()
        if not raw:
            continue
        if ":" in raw:
            place, _, user = raw.partition(":")
            if place == platform and user:
                names.add(user)
        elif platform == "guns":
            names.add(raw)
    return names


def remember(platform: str, name: str) -> None:
    with FOUND_FILE.open("a", encoding="utf-8") as handle:
        handle.write(f"{platform}:{name}\n")


def build_names(length: int, skip: set[str]) -> list[str]:
    alphabet = string.ascii_lowercase
    names = []
    for chars in itertools.product(alphabet, repeat=length):
        name = "".join(chars)
        if name not in skip:
            names.append(name)
    random.shuffle(names)
    return names


class Checker:
    def __init__(self) -> None:
        self.session = self._new_session()

    def _new_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )
        return session

    def check(self, name: str) -> str:
        """Return 'free', 'taken', or 'error'."""
        url = GUNS_URL.format(name=name)
        resets = 0
        for attempt in range(6):
            try:
                response = self.session.get(url, allow_redirects=False, timeout=20)
            except requests.RequestException:
                time.sleep(1.2 + attempt)
                continue

            status = response.status_code
            if status in {301, 302, 307, 308}:
                if attempt >= 2 and resets == 0:
                    self.session = self._new_session()
                    resets += 1
                continue
            if status == 429:
                time.sleep(2.5 + attempt)
                continue
            if status == 404:
                return "free"
            if status != 200:
                time.sleep(0.8 + attempt)
                continue

            text = response.text
            if "Username not found" in text and "Claim this username" in text:
                return "free"
            return "taken"
        return "error"


def wait_out(seconds: float) -> None:
    """Show a countdown while Discord's rate limit is in effect."""
    seconds = max(0.0, seconds)
    if seconds < 1.5:
        time.sleep(seconds)
        return
    end = time.perf_counter() + seconds
    while True:
        left = end - time.perf_counter()
        if left <= 0:
            break
        mins, secs = divmod(int(left) + 1, 60)
        sys.stdout.write(
            f"\r  {ROSE}discord siger vent{RESET}  {PURPLE_HOT}{mins:02d}:{secs:02d}{RESET}   "
        )
        sys.stdout.flush()
        time.sleep(min(1.0, left))
    sys.stdout.write("\r" + " " * 48 + "\r")
    sys.stdout.flush()


class DiscordChecker:
    """Checks Discord's public signup endpoint. It does not claim the name."""

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Origin": "https://discord.com",
                "Referer": "https://discord.com/register",
            }
        )

    def check(self, name: str) -> str:
        """Return 'free', 'taken', or 'error'."""
        for attempt in range(3):
            try:
                response = self.session.post(
                    DISCORD_URL, json={"username": name}, timeout=20
                )
            except requests.RequestException:
                time.sleep(1.2 + attempt)
                continue

            if response.status_code == 429:
                wait_out(retry_after(response))
                continue
            if response.status_code == 400:
                return "taken"
            if response.status_code != 200:
                time.sleep(1.0 + attempt)
                continue
            try:
                taken = response.json().get("taken")
            except ValueError:
                return "error"
            if taken is True:
                return "taken"
            if taken is False:
                return "free"
            return "error"
        return "error"


def retry_after(response: requests.Response) -> float:
    try:
        payload = response.json()
        if "retry_after" in payload:
            return float(payload["retry_after"])
    except (ValueError, TypeError):
        pass
    header = response.headers.get("Retry-After")
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    return 5.0


def claim_url(name: str) -> str:
    return CLAIM_URL.format(name=name)


def send_webhook(webhook: str, platform: str, name: str) -> tuple[bool, str]:
    place = PLACES[platform]
    fields = [
        {"name": "Username", "value": f"`{name}`", "inline": True},
        {"name": "Bogstaver", "value": str(len(name)), "inline": True},
        {"name": "Sted", "value": place, "inline": True},
    ]
    embed: dict[str, object] = {
        "title": f"Ledigt {place} navn",
        "description": f"```\n{name}\n```",
        "color": 0xA855F7,
        "fields": fields,
        "footer": {"text": "ISAKU"},
    }
    if platform == "guns":
        embed["url"] = claim_url(name)
        fields.append({"name": "Claim", "value": claim_url(name)})
    payload = {"username": "ISAKU", "embeds": [embed]}
    for attempt in range(3):
        try:
            response = requests.post(webhook, json=payload, timeout=15)
        except requests.RequestException as exc:
            if attempt == 2:
                return False, str(exc)
            time.sleep(1)
            continue
        if response.status_code in {200, 204}:
            return True, "sendt til webhook"
        if response.status_code == 429:
            try:
                wait = float(response.json().get("retry_after", 1))
            except Exception:
                wait = 1
            time.sleep(min(wait, 5))
            continue
        detail = response.text.strip().replace("\n", " ")[:140]
        return False, f"webhook svarede {response.status_code} {detail}".strip()
    return False, "webhook svarede ikke"


def status_line(platform: str, current: str, checked: int, found: int, target: int) -> None:
    line = (
        f"  {PURPLE}{PLACES[platform]:<10}{RESET} {INK}{current:<8}{RESET}"
        f"  {MUTED}tjekket {checked}{RESET}"
        f"  {PURPLE_HOT}ledige {found}/{target}{RESET}"
    )
    sys.stdout.write("\r" + line + " " * 8)
    sys.stdout.flush()


def clear_status() -> None:
    sys.stdout.write("\r" + " " * 90 + "\r")
    sys.stdout.flush()


def hunt(webhook: str, target: int, length: int, platform: str) -> list[tuple[str, str]]:
    known = load_known(platform)
    place = PLACES[platform]
    delay = DISCORD_DELAY if platform == "discord" else GUNS_DELAY
    write()
    write(
        f"  {MUTED}blander {26 ** length:,} {place}-navne på {length} bogstaver...{RESET}".replace(
            ",", "."
        )
    )
    names = build_names(length, known)
    checker: Checker | DiscordChecker = DiscordChecker() if platform == "discord" else Checker()
    found: list[tuple[str, str]] = []
    checked = 0

    write()
    write(f"  {PURPLE_SOFT}leder efter {target} ledige {place}-navne{RESET}")
    write()

    if not names:
        write(f"  {ROSE}Der er ikke flere nye {place}-navne tilbage i den længde.{RESET}")
        return found

    try:
        for name in names:
            if len(found) >= target:
                break
            checked += 1
            status_line(platform, name, checked, len(found), target)
            result = checker.check(name)
            if result != "free":
                time.sleep(delay)
                continue

            clear_status()
            remember(platform, name)
            found.append((platform, name))
            ok, note = send_webhook(webhook, platform, name)
            color = MINT if ok else ROSE
            write(f"  {MINT}ledig{RESET}  {BOLD}{PURPLE_HOT}{name}{RESET}  {MUTED}{place}{RESET}")
            if platform == "guns":
                write(f"         {MUTED}{claim_url(name)}{RESET}")
            write(f"         {color}{note}{RESET}")
            write()
            time.sleep(delay)
    except KeyboardInterrupt:
        clear_status()
        write()
        write(f"  {ROSE}stoppet.{RESET}")
        raise

    clear_status()
    return found


def show_menu() -> None:
    clear_screen()
    paint_watermark()
    write()
    write_centered("finder ledige navne på guns.lol og discord", MUTED)


def finish(found: list[tuple[str, str]], target: int) -> None:
    write()
    write(f"  {PURPLE}{'━' * 42}{RESET}")
    if found and len(found) >= target:
        write(f"  {MINT}færdig.{RESET} {INK}{len(found)} navne er gemt i fundet.txt{RESET}")
    elif found:
        write(f"  {PURPLE_SOFT}færdig med {len(found)} af {target}.{RESET}")
        write(f"  {MUTED}de fundne navne ligger i fundet.txt{RESET}")
    else:
        write(f"  {ROSE}ingen ledige navne fundet.{RESET}")
    for platform, name in found:
        write(f"    {PURPLE_HOT}{name}{RESET}  {MUTED}{PLACES[platform]}{RESET}")
    write()


def main() -> None:
    setup_console()
    loading_screen()
    show_menu()
    webhook = prompt_webhook()
    target = prompt_count()
    length = prompt_length()
    places = prompt_places()
    found: list[tuple[str, str]] = []
    try:
        for platform in places:
            found.extend(hunt(webhook, target, length, platform))
    except KeyboardInterrupt:
        pass
    finish(found, target * len(places))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stdout.write(SHOW_CURSOR + "\n")
        write(f"{ROSE}stoppet.{RESET}")
    finally:
        sys.stdout.write(SHOW_CURSOR)
        sys.stdout.flush()
