#!/usr/bin/env python3
"""ISAKU — finds free guns.lol and Discord names and sends them to a webhook."""

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

LANG = "da"
COPY = {
    "da": {
        "webhook_label": "Webhook",
        "webhook_hint": "Indsæt din Discord-webhook",
        "webhook_bad": "Det skal være en https-webhook fra discord.com.",
        "count_label": "Antal",
        "count_hint": "Hvor mange ledige navne vil du have?",
        "count_bad": "Skriv et helt tal over 0.",
        "names_label": "Navne",
        "names_hint": "3 bogstaver    4 bogstaver    5 andre navne",
        "names_bad": "Skriv 3, 4 eller 5.",
        "place_label": "Sted",
        "place_hint": "1 guns.lol    2 discord    3 begge",
        "place_bad": "Skriv 1, 2 eller 3.",
        "tagline": "finder ledige navne på guns.lol og discord",
        "mixing_letters": "blander {count} {place}-navne på {length} bogstaver...",
        "mixing_other": "laver andre {place}-navne...",
        "searching": "leder efter {target} ledige {place}-navne",
        "searching_one": "leder efter {target} ledigt {place}-navn",
        "none_left": "Der er ikke flere nye {place}-navne tilbage.",
        "free": "ledig",
        "sent": "sendt til webhook",
        "webhook_status": "webhook svarede {status} {detail}",
        "webhook_silent": "webhook svarede ikke",
        "checking": "tjekker",
        "checked": "tjekket",
        "free_of": "ledige",
        "wait": "discord siger vent",
        "stopped": "stoppet.",
        "done": "færdig.",
        "saved": "{count} navne er gemt i fundet.txt",
        "saved_one": "{count} navn er gemt i fundet.txt",
        "partial": "færdig med {count} af {target}.",
        "partial_note": "de fundne navne ligger i fundet.txt",
        "none": "ingen ledige navne fundet.",
        "field_letters": "Bogstaver",
        "field_place": "Sted",
        "title": "Ledigt {place} navn",
        "load": [
            "starter isaku",
            "åbner session",
            "forbinder til guns.lol og discord",
            "klargør webhook",
            "bygger navne",
            "sidste detaljer",
        ],
    },
    "en": {
        "webhook_label": "Webhook",
        "webhook_hint": "Paste your Discord webhook",
        "webhook_bad": "It has to be an https webhook from discord.com.",
        "count_label": "Amount",
        "count_hint": "How many free names do you want?",
        "count_bad": "Enter a whole number above 0.",
        "names_label": "Names",
        "names_hint": "3 letters    4 letters    5 other names",
        "names_bad": "Enter 3, 4 or 5.",
        "place_label": "Where",
        "place_hint": "1 guns.lol    2 discord    3 both",
        "place_bad": "Enter 1, 2 or 3.",
        "tagline": "finds free names on guns.lol and discord",
        "mixing_letters": "shuffling {count} {place} names of {length} letters...",
        "mixing_other": "making other {place} names...",
        "searching": "looking for {target} free {place} names",
        "searching_one": "looking for {target} free {place} name",
        "none_left": "No new {place} names left.",
        "free": "free",
        "sent": "sent to webhook",
        "webhook_status": "webhook replied {status} {detail}",
        "webhook_silent": "webhook did not reply",
        "checking": "checking",
        "checked": "checked",
        "free_of": "free",
        "wait": "discord says wait",
        "stopped": "stopped.",
        "done": "done.",
        "saved": "{count} names saved in fundet.txt",
        "saved_one": "{count} name saved in fundet.txt",
        "partial": "finished with {count} of {target}.",
        "partial_note": "found names are in fundet.txt",
        "none": "no free names found.",
        "field_letters": "Letters",
        "field_place": "Where",
        "title": "Free {place} name",
        "load": [
            "starting isaku",
            "opening session",
            "connecting to guns.lol and discord",
            "preparing webhook",
            "building names",
            "last details",
        ],
    },
}


def t(key: str, **kwargs: object) -> str:
    return str(COPY[LANG][key]).format(**kwargs)


def format_count(value: int) -> str:
    text = f"{value:,}"
    return text.replace(",", ".") if LANG == "da" else text


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


def banner_cells() -> tuple[list[tuple[int, int, str]], int, int]:
    source = BANNER.splitlines()
    width = max(len(item) for item in source)
    raw = [item.ljust(width) for item in source]
    cells = []
    for row, line in enumerate(raw):
        for col, char in enumerate(line):
            if char != " ":
                cells.append((col, row, char))
    return cells, len(raw[0]), len(raw)


def fall_offset(progress: float, column: int, drop: int) -> int:
    """How many rows a glyph still has to fall. 0 means it has landed."""
    lag = (column % 6) * 0.07
    span = max(0.25, 1 - lag)
    local = min(1.0, max(0.0, (progress - lag) / span))
    landed = 1 - (1 - local) ** 3
    return int(round((1 - landed) * drop))


def loading_frame(percent: int, message: str) -> list[tuple[str, str]]:
    bar_width = 32
    filled = round(bar_width * percent / 100)
    bar = "█" * filled + "░" * (bar_width - filled)
    inner = 42

    def fit(value: str) -> str:
        value = value[:inner]
        return value + " " * (inner - len(value))

    rows = [
        ("┌" + "─" * (inner + 2) + "┐", PURPLE),
        ("│ " + fit("LOADING") + " │", BOLD + PURPLE_HOT),
        ("│ " + fit(f"{bar}  {percent:3d}%") + " │", PURPLE),
        ("│ " + fit(message) + " │", PURPLE_SOFT),
        ("└" + "─" * (inner + 2) + "┘", PURPLE),
    ]
    return rows


def paint_grid(grid: list[list[tuple[str, str]]]) -> None:
    sys.stdout.write("\033[H")
    for row in grid:
        line = []
        for char, color in row:
            line.append(f"{color}{char}" if color else char)
        sys.stdout.write("".join(line) + RESET + "\033[K\n")
    sys.stdout.flush()


def put(grid: list[list[tuple[str, str]]], row: int, col: int, char: str, color: str) -> None:
    if row < 0 or col < 0 or row >= len(grid) or col >= len(grid[0]) or char == " ":
        return
    grid[row][col] = (char, color)


def loading_screen() -> None:
    cells, art_width, art_height = banner_cells()
    drop = 11
    fall_frames = 26
    bar_frames = 28
    rest_row = 1
    pad = max(0, (terminal_width() - art_width) // 2)
    box_slot = rest_row + art_height + 2
    screen_rows = box_slot + 7
    screen_cols = max(terminal_width(), art_width + pad + 2)
    messages = COPY[LANG]["load"]
    sys.stdout.write(HIDE_CURSOR)
    clear_screen()
    try:
        total = fall_frames + bar_frames
        for frame in range(total + 1):
            grid = [[(" ", "")] * screen_cols for _ in range(screen_rows)]
            fall_progress = min(1.0, frame / fall_frames)
            for col, row, char in cells:
                offset = fall_offset(fall_progress, col, drop)
                y = rest_row + row - offset
                put(grid, y, pad + col, char, BOLD + PURPLE)
                if offset > 0:
                    put(grid, y - 1, pad + col, char, PURPLE_DEEP)
                    put(grid, y - 2, pad + col, "·", DIM + PURPLE_DEEP)
            if fall_progress >= 0.92:
                rule = "━" * art_width
                for index, char in enumerate(rule):
                    put(grid, rest_row + art_height, pad + index, char, PURPLE_DEEP)
                subtitle = "guns.lol   ·   discord"
                sub_pad = pad + max(0, (art_width - len(subtitle)) // 2)
                for index, char in enumerate(subtitle):
                    put(grid, rest_row + art_height + 1, sub_pad + index, char, DIM + PURPLE_SOFT)
            if frame >= fall_frames:
                bar_progress = (frame - fall_frames) / bar_frames
                percent = int(ease(bar_progress) * 100)
                message = messages[min(len(messages) - 1, int(bar_progress * len(messages)))]
                box = loading_frame(percent, message)
                box_drop = int(round((1 - ease(bar_progress)) * 5))
                box_width = len(box[0][0])
                box_pad = max(0, (screen_cols - box_width) // 2)
                for line_index, (text, color) in enumerate(box):
                    y = box_slot + line_index - box_drop
                    for index, char in enumerate(text):
                        put(grid, y, box_pad + index, char, color)
            paint_grid(grid)
            if frame == total:
                break
            time.sleep(0.04)
        time.sleep(0.28)
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


def prompt_language() -> None:
    global LANG
    clear_screen()
    write()
    write_centered("ISAKU", BOLD + PURPLE)
    write()
    write(f"  {PURPLE}Sprog / Language{RESET}")
    write(f"  {MUTED}1 Dansk    2 English{RESET}")
    while True:
        sys.stdout.write(f"  {PURPLE_HOT}›{RESET} ")
        sys.stdout.flush()
        value = input().strip().lower()
        if value in {"1", "da", "dansk", "danish"}:
            LANG = "da"
            return
        if value in {"2", "en", "engelsk", "english"}:
            LANG = "en"
            return
        write(f"  {ROSE}1 eller 2  /  1 or 2{RESET}")


def prompt_webhook() -> str:
    while True:
        value = ask(t("webhook_label"), t("webhook_hint"))
        if valid_webhook(value):
            return value.strip()
        write(f"  {ROSE}{t('webhook_bad')}{RESET}")


def prompt_count() -> int:
    while True:
        value = ask(t("count_label"), t("count_hint"))
        if value.isdigit() and int(value) > 0:
            return int(value)
        write(f"  {ROSE}{t('count_bad')}{RESET}")


def prompt_mode() -> str:
    while True:
        value = ask(t("names_label"), t("names_hint")).lower()
        if value in {"3", "three", "tre"}:
            return "3"
        if value in {"4", "four", "fire"}:
            return "4"
        if value in {"5", "other", "others", "andre", "andre navne", "names", "other names"}:
            return "other"
        write(f"  {ROSE}{t('names_bad')}{RESET}")


def prompt_places() -> list[str]:
    while True:
        value = ask(t("place_label"), t("place_hint")).lower()
        if value in {"1", "guns", "guns.lol"}:
            return ["guns"]
        if value in {"2", "discord", "dc"}:
            return ["discord"]
        if value in {"3", "begge", "alle", "both"}:
            return ["guns", "discord"]
        write(f"  {ROSE}{t('place_bad')}{RESET}")


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


def build_letter_names(length: int, skip: set[str]) -> list[str]:
    alphabet = string.ascii_lowercase
    names = []
    for chars in itertools.product(alphabet, repeat=length):
        name = "".join(chars)
        if name not in skip:
            names.append(name)
    random.shuffle(names)
    return names


def build_other_names(skip: set[str]) -> list[str]:
    """Pronounceable names, not a full 3- or 4-letter sweep."""
    consonants = "bcdfghjklmnpqrstvwxyz"
    vowels = "aeiou"
    patterns = ("cvc", "cvcv", "cvcc", "vcv", "cvvc", "cvcvc")
    names: set[str] = set()
    tries = 0
    while len(names) < 6000 and tries < 20000:
        tries += 1
        pattern = random.choice(patterns)
        name = "".join(random.choice(vowels if kind == "v" else consonants) for kind in pattern)
        if name not in skip:
            names.add(name)
    pool = list(names)
    random.shuffle(pool)
    return pool


def build_names(mode: str, skip: set[str]) -> list[str]:
    if mode == "other":
        return build_other_names(skip)
    return build_letter_names(int(mode), skip)


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
            f"\r  {ROSE}{t('wait')}{RESET}  {PURPLE_HOT}{mins:02d}:{secs:02d}{RESET}   "
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
        {"name": t("field_letters"), "value": str(len(name)), "inline": True},
        {"name": t("field_place"), "value": place, "inline": True},
    ]
    embed: dict[str, object] = {
        "title": t("title", place=place),
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
            return True, t("sent")
        if response.status_code == 429:
            try:
                wait = float(response.json().get("retry_after", 1))
            except Exception:
                wait = 1
            time.sleep(min(wait, 5))
            continue
        detail = response.text.strip().replace("\n", " ")[:140]
        return False, t("webhook_status", status=response.status_code, detail=detail).strip()
    return False, t("webhook_silent")


def status_line(platform: str, current: str, checked: int, found: int, target: int) -> None:
    line = (
        f"  {PURPLE}{PLACES[platform]:<10}{RESET} {INK}{current:<8}{RESET}"
        f"  {MUTED}{t('checked')} {checked}{RESET}"
        f"  {PURPLE_HOT}{t('free_of')} {found}/{target}{RESET}"
    )
    sys.stdout.write("\r" + line + " " * 8)
    sys.stdout.flush()


def clear_status() -> None:
    sys.stdout.write("\r" + " " * 90 + "\r")
    sys.stdout.flush()


def hunt(webhook: str, target: int, mode: str, platform: str) -> list[tuple[str, str]]:
    known = load_known(platform)
    place = PLACES[platform]
    delay = DISCORD_DELAY if platform == "discord" else GUNS_DELAY
    write()
    if mode == "other":
        mixing = t("mixing_other", place=place)
    else:
        mixing = t(
            "mixing_letters",
            count=format_count(26 ** int(mode)),
            place=place,
            length=mode,
        )
    write(f"  {MUTED}{mixing}{RESET}")
    names = build_names(mode, known)
    checker: Checker | DiscordChecker = DiscordChecker() if platform == "discord" else Checker()
    found: list[tuple[str, str]] = []
    checked = 0

    write()
    search_key = "searching_one" if target == 1 else "searching"
    write(f"  {PURPLE_SOFT}{t(search_key, target=target, place=place)}{RESET}")
    write()

    if not names:
        write(f"  {ROSE}{t('none_left', place=place)}{RESET}")
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
            write(f"  {MINT}{t('free')}{RESET}  {BOLD}{PURPLE_HOT}{name}{RESET}  {MUTED}{place}{RESET}")
            if platform == "guns":
                write(f"         {MUTED}{claim_url(name)}{RESET}")
            write(f"         {color}{note}{RESET}")
            write()
            time.sleep(delay)
    except KeyboardInterrupt:
        clear_status()
        write()
        write(f"  {ROSE}{t('stopped')}{RESET}")
        raise

    clear_status()
    return found


def show_menu() -> None:
    clear_screen()
    paint_watermark()
    write()
    write_centered(t("tagline"), MUTED)


def finish(found: list[tuple[str, str]], target: int) -> None:
    write()
    write(f"  {PURPLE}{'━' * 42}{RESET}")
    if found and len(found) >= target:
        saved_key = "saved_one" if len(found) == 1 else "saved"
        write(f"  {MINT}{t('done')}{RESET} {INK}{t(saved_key, count=len(found))}{RESET}")
    elif found:
        write(f"  {PURPLE_SOFT}{t('partial', count=len(found), target=target)}{RESET}")
        write(f"  {MUTED}{t('partial_note')}{RESET}")
    else:
        write(f"  {ROSE}{t('none')}{RESET}")
    for platform, name in found:
        write(f"    {PURPLE_HOT}{name}{RESET}  {MUTED}{PLACES[platform]}{RESET}")
    write()


def main() -> None:
    setup_console()
    prompt_language()
    loading_screen()
    show_menu()
    webhook = prompt_webhook()
    target = prompt_count()
    mode = prompt_mode()
    places = prompt_places()
    found: list[tuple[str, str]] = []
    try:
        for platform in places:
            found.extend(hunt(webhook, target, mode, platform))
    except KeyboardInterrupt:
        pass
    finish(found, target * len(places))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stdout.write(SHOW_CURSOR + "\n")
        write(f"{ROSE}{t('stopped')}{RESET}")
    finally:
        sys.stdout.write(SHOW_CURSOR)
        sys.stdout.flush()
