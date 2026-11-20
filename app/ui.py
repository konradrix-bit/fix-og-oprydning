"""Loadout-vinduet. Al logikken er den samme. Kun fladen er bygget om."""

from __future__ import annotations

import sys

import customtkinter as ctk

from app.bindings import duplicate_text, resolve
from app.config import (
    PIECE_LABELS,
    PIECE_ORDER,
    apply_preset,
    apply_profile,
    clamp_config,
    delete_profile,
    load_config,
    recommend,
    save_config,
    upsert_profile,
)
from app.engine import Engine
from app.keys import display
from app.sequences import MODE_TITLE, describe, fast_confirm, instant_reset
from app.system import is_admin
from app.theme import (
    AMBER_BG,
    BG,
    HOT,
    KEY,
    LIME,
    LIME_INK,
    LINE,
    MUTED,
    PANEL,
    RAIL,
    STRIP,
    TEXT,
    WARN,
    choose_fonts,
    load_fonts,
)

MODE_CHOICES = (
    ("release", "Ved slip"),
    ("same_key", "Samme tast"),
    ("double", "To taster"),
)
MODE_HELP = {
    "release": "Hold edit og vælg felter med musen. Slip for at bekræfte. Sæt Edit on Release til i Fortnite.",
    "same_key": "Slå Edit on Release fra i Fortnite. Hurtig reset trykker edit, reset og edit igen.",
    "double": "Slå Edit on Release fra i Fortnite. Bekræft skal være en anden tast end edit.",
}
SCROLL_CHOICES = (("both", "Op og ned"), ("up", "Kun op"), ("down", "Kun ned"))
PAGES = (
    ("Edits", "01", "Hurtige edits"),
    ("Byg", "02", "Byg og skift"),
    ("Ekstra", "03", "Ekstra"),
    ("Profiler", "04", "Profiler"),
)


class KeyButton(ctk.CTkButton):
    def __init__(self, master, app: "App", on_change, empty: str = "—"):
        super().__init__(
            master,
            text=empty,
            width=168,
            height=34,
            corner_radius=0,
            border_width=1,
            border_color=LINE,
            fg_color=KEY,
            hover_color="#283246",
            text_color=TEXT,
            font=app.mono_font(14, "bold"),
            command=self._arm,
        )
        self.app = app
        self.on_change = on_change
        self.empty = empty
        self.value = ""

    def set_value(self, value: str) -> None:
        self.value = value or ""
        self.configure(
            text=display(self.value) if self.value else self.empty,
            fg_color=KEY,
            text_color=TEXT if self.value else MUTED,
            border_color=LINE,
        )

    def cancel(self) -> None:
        self.set_value(self.value)

    def _arm(self) -> None:
        self.configure(text="TRYK", fg_color=LIME, text_color=LIME_INK, border_color=LIME)
        self.app.arm_capture(self)

    def apply(self, name) -> None:
        if name is None:
            self.set_value(self.value)
            return
        self.set_value(name)
        self.on_change(name)


class ModePicker:
    def __init__(self, buttons: dict[str, ctk.CTkButton]):
        self.buttons = buttons

    def set(self, label: str) -> None:
        for name, button in self.buttons.items():
            on = name == label
            button.configure(
                fg_color=LIME if on else "#121722",
                hover_color="#eaff86" if on else "#1d2636",
                text_color=LIME_INK if on else TEXT,
                border_color=LIME if on else LINE,
            )


class Overlay(ctk.CTkToplevel):
    def __init__(self, app: "App"):
        super().__init__(app)
        self.app = app
        self.title("makro")
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        try:
            self.attributes("-alpha", 0.94)
        except Exception:
            pass
        try:
            self.attributes("-toolwindow", True)
        except Exception:
            pass
        self.configure(fg_color="#05060a")
        self.resizable(False, False)
        shell = ctk.CTkFrame(self, fg_color="#05060a", corner_radius=0)
        shell.pack(fill="both", expand=True)
        self.stripe = ctk.CTkFrame(shell, width=5, fg_color=HOT, corner_radius=0)
        self.stripe.pack(side="left", fill="y")
        self.label = ctk.CTkLabel(
            shell,
            text="",
            justify="left",
            anchor="w",
            text_color=TEXT,
            font=app.display_font(18, "bold"),
        )
        self.label.pack(side="left", padx=12, pady=10, anchor="w")
        self._drag_x = 0
        self._drag_y = 0
        for widget in (self, shell, self.label):
            widget.bind("<ButtonPress-1>", self._press)
            widget.bind("<B1-Motion>", self._drag)
            widget.bind("<ButtonRelease-1>", self._release)

    def place_saved(self) -> None:
        cfg = self.app.cfg
        x = int(cfg["overlay_x"])
        y = int(cfg["overlay_y"])
        if (x, y) == (28, 28):
            self.update_idletasks()
            x = max(12, self.winfo_screenwidth() - 250)
            y = 48
        self.geometry(f"230x108+{x}+{y}")

    def show_state(self, text: str) -> None:
        on = text.startswith("TIL")
        self.label.configure(text=text, text_color=LIME if on else TEXT)
        self.stripe.configure(fg_color=LIME if on else HOT)
        if self.app.cfg.get("overlay", True):
            self.deiconify()
            self.attributes("-topmost", True)
        else:
            self.withdraw()

    def _press(self, event) -> None:
        self._drag_x = event.x
        self._drag_y = event.y

    def _drag(self, event) -> None:
        x = self.winfo_x() + event.x - self._drag_x
        y = self.winfo_y() + event.y - self._drag_y
        self.geometry(f"+{x}+{y}")

    def _release(self, _event) -> None:
        self.app.cfg["overlay_x"] = self.winfo_x()
        self.app.cfg["overlay_y"] = self.winfo_y()
        self.app.commit()


class App(ctk.CTk):
    def __init__(self, cfg: dict):
        load_fonts()
        super().__init__()
        self.cfg = cfg
        self.display, self.mono = choose_fonts(self)
        self._loading = False
        self._capture_button: KeyButton | None = None
        self.binders: list[tuple[KeyButton, callable]] = []
        self.pages: dict[str, ctk.CTkScrollableFrame] = {}
        self.nav_buttons: dict[str, ctk.CTkButton] = {}
        self.title("Fortnite Makro")
        self.geometry("1240x860")
        self.minsize(1080, 700)
        self.configure(fg_color=BG)
        self._build()
        self.overlay = Overlay(self)
        self.overlay.place_saved()
        self.engine = Engine(self.cfg, on_event=self._engine_event)
        self.protocol("WM_DELETE_WINDOW", self._close)
        self._load_form()
        self.refresh_status()
        self.engine.start()

    def display_font(self, size: int, weight: str = "normal") -> ctk.CTkFont:
        return ctk.CTkFont(family=self.display, size=size, weight=weight)

    def mono_font(self, size: int, weight: str = "normal") -> ctk.CTkFont:
        return ctk.CTkFont(family=self.mono, size=size, weight=weight)

    def _build(self) -> None:
        self.grid_columnconfigure(0, minsize=236, weight=0)
        self.grid_columnconfigure(1, weight=1)
        self.grid_columnconfigure(2, minsize=332, weight=0)
        self.grid_rowconfigure(1, weight=1)
        accent = ctk.CTkFrame(self, height=4, fg_color=LIME, corner_radius=0)
        accent.grid(row=0, column=0, columnspan=3, sticky="ew")

        rail = ctk.CTkFrame(self, fg_color=RAIL, corner_radius=0)
        rail.grid(row=1, column=0, sticky="nsew")
        ctk.CTkLabel(rail, text="MAKRO", anchor="w", text_color=LIME, font=self.display_font(40, "bold")).pack(fill="x", padx=20, pady=(22, 0))
        ctk.CTkLabel(rail, text="EDIT DECK", anchor="w", text_color=MUTED, font=self.mono_font(12, "bold")).pack(fill="x", padx=22, pady=(0, 18))
        for name, number, _title in PAGES:
            button = ctk.CTkButton(
                rail,
                text=f"{number}    {name.upper()}",
                anchor="w",
                height=48,
                corner_radius=0,
                fg_color=RAIL,
                hover_color="#171c27",
                text_color=TEXT,
                font=self.display_font(22, "bold"),
                command=lambda page=name: self._show(page),
            )
            button.pack(fill="x", padx=12, pady=1)
            self.nav_buttons[name] = button

        ctk.CTkLabel(
            rail,
            text="Klik en tast. Delete rydder.\nEscape fortryder.",
            justify="left",
            anchor="w",
            text_color=MUTED,
            font=self.display_font(15),
        ).pack(side="bottom", fill="x", padx=20, pady=(0, 14))
        self.power = ctk.CTkFrame(rail, fg_color="#16080c", corner_radius=0)
        self.power.pack(side="bottom", fill="x", padx=12, pady=(8, 8))
        self.state_label = ctk.CTkLabel(self.power, text="FRA", text_color=HOT, font=self.display_font(42, "bold"))
        self.state_label.pack(anchor="w", padx=14, pady=(8, 0))
        self.toggle_button = ctk.CTkButton(
            self.power,
            text="TÆND",
            height=34,
            corner_radius=0,
            fg_color=HOT,
            hover_color="#ff6a80",
            text_color=LIME_INK,
            font=self.display_font(16, "bold"),
            command=self._click_toggle,
        )
        self.toggle_button.pack(fill="x", padx=12, pady=(4, 12))
        self.edit_readout = ctk.CTkLabel(rail, text="", justify="left", anchor="w", text_color=TEXT, font=self.display_font(16))
        self.edit_readout.pack(side="bottom", fill="x", padx=20, pady=(0, 8))

        self.stage = ctk.CTkFrame(self, fg_color=BG, corner_radius=0)
        self.stage.grid(row=1, column=1, sticky="nsew")
        self.stage.grid_rowconfigure(0, weight=1)
        self.stage.grid_columnconfigure(0, weight=1)
        for name, _number, _title in PAGES:
            page = ctk.CTkScrollableFrame(self.stage, fg_color=BG, scrollbar_button_color="#2a3344", scrollbar_button_hover_color=LIME)
            page.grid(row=0, column=0, sticky="nsew")
            self.pages[name] = page
        self._build_edit_tab(self.pages["Edits"])
        self._build_build_tab(self.pages["Byg"])
        self._build_extra_tab(self.pages["Ekstra"])
        self._build_profile_tab(self.pages["Profiler"])
        self._show("Edits")

        hud = ctk.CTkFrame(self, fg_color=RAIL, corner_radius=0)
        hud.grid(row=1, column=2, sticky="nsew")
        hud.grid_rowconfigure(1, weight=1)
        hud.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(hud, text="SEKVENS", anchor="w", text_color=LIME, font=self.display_font(22, "bold")).grid(row=0, column=0, sticky="ew", padx=16, pady=(18, 6))
        self.seq_box = ctk.CTkScrollableFrame(hud, fg_color=RAIL, scrollbar_button_color="#2a3344", scrollbar_button_hover_color=LIME)
        self.seq_box.grid(row=1, column=0, sticky="nsew", padx=8)
        self.warning = ctk.CTkLabel(hud, text="", text_color=WARN, wraplength=290, justify="left", anchor="w", font=self.display_font(15))
        self.warning.grid(row=2, column=0, sticky="ew", padx=16, pady=(6, 0))
        ctk.CTkLabel(hud, text="LOG", anchor="w", text_color=MUTED, font=self.mono_font(11, "bold")).grid(row=3, column=0, sticky="ew", padx=16, pady=(8, 0))
        self.log_box = ctk.CTkTextbox(hud, height=150, fg_color="#07080c", text_color="#c5d0c2", font=self.mono_font(12), corner_radius=0, border_width=1, border_color=LINE)
        self.log_box.grid(row=4, column=0, sticky="ew", padx=12, pady=(4, 14))
        self.log_box.configure(state="disabled")

    def _show(self, name: str) -> None:
        for key, page in self.pages.items():
            if key == name:
                page.grid()
            else:
                page.grid_remove()
        for key, button in self.nav_buttons.items():
            active = key == name
            button.configure(
                fg_color="#1b240f" if active else RAIL,
                hover_color="#243212" if active else "#171c27",
                text_color=LIME if active else TEXT,
            )

    def _page_head(self, parent, kicker: str, title: str, body: str) -> None:
        ctk.CTkLabel(parent, text=kicker, anchor="w", text_color=LIME, font=self.mono_font(12, "bold")).pack(fill="x", padx=22, pady=(18, 0))
        ctk.CTkLabel(parent, text=title, anchor="w", text_color=TEXT, font=self.display_font(36, "bold")).pack(fill="x", padx=20, pady=(0, 4))
        self._hint(parent, body)

    def _scroller(self, parent) -> ctk.CTkScrollableFrame:
        return parent

    def _hint(self, parent, text: str) -> ctk.CTkLabel:
        label = ctk.CTkLabel(parent, text=text, text_color=MUTED, wraplength=620, justify="left", anchor="w", font=self.display_font(16))
        label.pack(fill="x", padx=22, pady=(0, 12))
        return label

    def _section(self, parent, text: str) -> None:
        ctk.CTkLabel(parent, text=text.upper(), anchor="w", text_color=LIME, font=self.display_font(15, "bold")).pack(fill="x", padx=22, pady=(16, 6))

    def _key_row(self, parent, label: str, getter, setter, bg: str = STRIP, inset: int = 22) -> KeyButton:
        row = ctk.CTkFrame(parent, fg_color=bg, corner_radius=0, height=50)
        row.pack(fill="x", padx=inset, pady=1)
        row.pack_propagate(False)
        ctk.CTkLabel(row, text=label, anchor="w", text_color=TEXT, font=self.display_font(18)).pack(side="left", padx=14)
        button = KeyButton(row, self, setter)
        button.pack(side="right", padx=8)
        self.binders.append((button, getter))
        return button

    def _slider(self, parent, command, start: float, end: float, steps: int) -> tuple[ctk.CTkFrame, ctk.CTkLabel, ctk.CTkSlider]:
        block = ctk.CTkFrame(parent, fg_color="transparent")
        block.pack(fill="x", padx=22, pady=(8, 2))
        label = ctk.CTkLabel(block, text="", anchor="w", text_color=TEXT, font=self.display_font(16))
        label.pack(anchor="w")
        slider = ctk.CTkSlider(
            block,
            from_=start,
            to=end,
            number_of_steps=steps,
            command=command,
            progress_color=LIME,
            button_color=LIME,
            button_hover_color="#f3ffb0",
            fg_color="#2a3346",
        )
        slider.pack(fill="x", pady=(6, 2))
        return block, label, slider

    def _text_button(self, parent, text: str, command, lime: bool = False) -> ctk.CTkButton:
        return ctk.CTkButton(
            parent,
            text=text,
            height=34,
            corner_radius=0,
            border_width=1,
            border_color=LIME if lime else LINE,
            fg_color=LIME if lime else KEY,
            hover_color="#eaff86" if lime else "#283246",
            text_color=LIME_INK if lime else TEXT,
            font=self.display_font(15, "bold"),
            command=command,
        )

    def _build_edit_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._page_head(page, "01  /  EDIT", "Hurtige edits", "Sæt de samme taster i Fortnite. Makroen sender kun de tryk, du har valgt her.")
        self.mode_help = self._hint(page, "")
        modes = ctk.CTkFrame(page, fg_color="transparent")
        modes.pack(fill="x", padx=22, pady=(0, 12))
        buttons = {}
        for _mode, label in MODE_CHOICES:
            button = ctk.CTkButton(
                modes,
                text=label.upper(),
                height=46,
                corner_radius=0,
                border_width=1,
                border_color=LINE,
                fg_color="#121722",
                hover_color="#1d2636",
                text_color=TEXT,
                font=self.display_font(18, "bold"),
                command=lambda chosen=label: self._on_mode(chosen),
            )
            button.pack(side="left", fill="x", expand=True, padx=2)
            buttons[label] = button
        self.mode_switch = ModePicker(buttons)

        self._section(page, "Taster i spillet")
        self._key_row(page, "Edit", lambda: self.cfg["edit"]["edit_key"], self._set_edit_key)
        self.confirm_button = self._key_row(page, "Bekræft", lambda: self.cfg["edit"]["confirm_key"], lambda value: self._set_edit("confirm_key", value))
        self._key_row(page, "Reset", lambda: self.cfg["edit"]["reset_key"], lambda value: self._set_edit("reset_key", value))

        self._section(page, "Genveje")
        self._key_row(page, "Hurtig reset", lambda: self.cfg["edit"]["instant_reset_hotkey"], lambda value: self._set_edit("instant_reset_hotkey", value))
        self._key_row(page, "Hurtig edit", lambda: self.cfg["edit"]["fast_confirm_hotkey"], lambda value: self._set_edit("fast_confirm_hotkey", value))
        self._key_row(page, "Turbo-reset, hold", lambda: self.cfg["edit"]["turbo_hotkey"], lambda value: self._set_edit("turbo_hotkey", value))
        _block, self.turbo_label, self.turbo_slider = self._slider(page, self._on_turbo, 15, 150, 135)

        scroll = ctk.CTkFrame(page, fg_color=STRIP, corner_radius=0, height=52)
        scroll.pack(fill="x", padx=22, pady=(10, 1))
        scroll.pack_propagate(False)
        self.scroll_switch = ctk.CTkSwitch(
            scroll,
            text="Scroll er reset",
            command=self._on_scroll_switch,
            font=self.display_font(16),
            progress_color=LIME,
            button_color="#f4f7fb",
            button_hover_color=LIME,
            fg_color="#2a3346",
            text_color=TEXT,
        )
        self.scroll_switch.pack(side="left", padx=14)
        self.scroll_menu = ctk.CTkOptionMenu(
            scroll,
            values=[label for _key, label in SCROLL_CHOICES],
            command=self._on_scroll_dir,
            width=140,
            height=32,
            corner_radius=0,
            fg_color=KEY,
            button_color="#2a3346",
            button_hover_color=LIME,
            text_color=TEXT,
            dropdown_fg_color=PANEL,
            dropdown_text_color=TEXT,
            dropdown_hover_color="#1d2636",
            font=self.display_font(15),
        )
        self.scroll_menu.pack(side="right", padx=8)

        self._section(page, "Tempo")
        _block, self.step_value, self.step_slider = self._slider(page, self._on_step, 0, 50, 50)
        _block, self.jitter_value, self.jitter_slider = self._slider(page, self._on_jitter, 0, 20, 20)
        presets = ctk.CTkFrame(page, fg_color="transparent")
        presets.pack(fill="x", padx=22, pady=(8, 4))
        for name, label in (("stabil", "Stabil"), ("hurtig", "Hurtig"), ("instant", "Instant")):
            self._text_button(presets, label, lambda n=name: self._preset(n)).pack(side="left", padx=(0, 8))
        self._text_button(page, "Anbefalet opsætning", self._recommend, lime=True).pack(anchor="w", padx=22, pady=(6, 8))

        self._section(page, "Skift edit-tast")
        self._hint(page, "Genvejen hopper til næste edit-tast. Ved slip og samme tast følger bekræft med.")
        self._key_row(page, "Skift edit-tast", lambda: self.cfg["edit"]["cycle_hotkey"], lambda value: self._set_edit("cycle_hotkey", value))
        self.cycle_frame = ctk.CTkFrame(page, fg_color="transparent")
        self.cycle_frame.pack(fill="x", padx=22, pady=6)
        self.add_cycle = KeyButton(page, self, self._add_cycle_key, empty="+ TAST")
        self.add_cycle.pack(anchor="w", padx=22, pady=(0, 18))

    def _build_build_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._page_head(page, "02  /  BYG", "Byg og skift", "Spiltasten er den, Fortnite allerede bruger. Genvejen trykker den. Replace placerer også.")
        self._key_row(page, "Placer", lambda: self.cfg["build"]["place_key"], lambda value: self._set_build("place_key", value))
        self.auto_place = ctk.CTkSwitch(
            page,
            text="Placer med det samme på bygge-genveje",
            command=self._on_auto_place,
            font=self.display_font(16),
            progress_color=LIME,
            button_color="#f4f7fb",
            button_hover_color=LIME,
            fg_color="#2a3346",
            text_color=TEXT,
        )
        self.auto_place.pack(anchor="w", padx=22, pady=10)
        self._key_row(page, "Skift byggedel", lambda: self.cfg["build"]["cycle_hotkey"], lambda value: self._set_build("cycle_hotkey", value))
        self.piece_game = {}
        self.piece_hot = {}
        self.piece_replace = {}
        self.piece_cycle = {}
        for piece_id in PIECE_ORDER:
            card = ctk.CTkFrame(page, fg_color="#10151f", corner_radius=0, border_width=1, border_color=LINE)
            card.pack(fill="x", padx=22, pady=(10, 0))
            head = ctk.CTkFrame(card, fg_color="transparent")
            head.pack(fill="x", padx=14, pady=(10, 4))
            ctk.CTkLabel(head, text=PIECE_LABELS[piece_id].upper(), text_color=TEXT, font=self.display_font(24, "bold")).pack(side="left")
            box = ctk.CTkCheckBox(
                head,
                text="I skift",
                command=lambda pid=piece_id: self._on_piece_cycle(pid),
                font=self.display_font(15),
                text_color=TEXT,
                fg_color=LIME,
                hover_color=LIME,
                border_color=LINE,
                checkmark_color=LIME_INK,
            )
            box.pack(side="right")
            self.piece_cycle[piece_id] = box
            self.piece_game[piece_id] = self._key_row(
                card,
                "I spillet",
                lambda pid=piece_id: self.cfg["build"]["pieces"][pid]["game_key"],
                lambda value, pid=piece_id: self._set_piece(pid, "game_key", value),
                bg="#10151f",
                inset=12,
            )
            self.piece_hot[piece_id] = self._key_row(
                card,
                "Genvej",
                lambda pid=piece_id: self.cfg["build"]["pieces"][pid]["hotkey"],
                lambda value, pid=piece_id: self._set_piece(pid, "hotkey", value),
                bg="#10151f",
                inset=12,
            )
            self.piece_replace[piece_id] = self._key_row(
                card,
                "Replace",
                lambda pid=piece_id: self.cfg["build"]["pieces"][pid]["replace_hotkey"],
                lambda value, pid=piece_id: self._set_piece(pid, "replace_hotkey", value),
                bg="#10151f",
                inset=12,
            )
        ctk.CTkFrame(page, fg_color="transparent", height=16).pack()

    def _switch(self, parent, text: str, command) -> ctk.CTkSwitch:
        switch = ctk.CTkSwitch(
            parent,
            text=text,
            command=command,
            font=self.display_font(16),
            progress_color=LIME,
            button_color="#f4f7fb",
            button_hover_color=LIME,
            fg_color="#2a3346",
            text_color=TEXT,
        )
        switch.pack(anchor="w", padx=22, pady=5)
        return switch

    def _build_extra_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._page_head(page, "03  /  EKSTRA", "Ekstra", "Ryd en genvej, hvis du ikke vil bruge den. Makroen gør ingenting, før du tænder den.")
        self._key_row(page, "Saml op i spillet", lambda: self.cfg["extras"]["pickup_key"], lambda value: self._set_extra("pickup_key", value))
        self._key_row(page, "Saml op, hold", lambda: self.cfg["extras"]["pickup_hotkey"], lambda value: self._set_extra("pickup_hotkey", value))
        _block, self.pickup_value, self.pickup_slider = self._slider(page, self._on_pickup, 15, 150, 135)

        self._section(page, "Våben")
        self._key_row(page, "Skift slot", lambda: self.cfg["extras"]["slot_cycle_hotkey"], lambda value: self._set_extra("slot_cycle_hotkey", value))
        for slot_id in ("1", "2", "3", "4", "5"):
            self._key_row(
                page,
                f"Slot {slot_id} i spillet",
                lambda sid=slot_id: self.cfg["extras"]["slots"][sid]["game_key"],
                lambda value, sid=slot_id: self._set_slot(sid, "game_key", value),
            )
            self._key_row(
                page,
                f"Slot {slot_id} genvej",
                lambda sid=slot_id: self.cfg["extras"]["slots"][sid]["hotkey"],
                lambda value, sid=slot_id: self._set_slot(sid, "hotkey", value),
            )

        self._section(page, "Makroen")
        self._key_row(page, "Tænd / sluk", lambda: self.cfg["master_toggle"], self._set_master)
        self.fortnite_switch = self._switch(page, "Kun når Fortnite er i fokus", self._on_fortnite_only)
        self.overlay_switch = self._switch(page, "Vis overlay", self._on_overlay)
        self.beep_switch = self._switch(page, "Lyd når edit-tast eller profil skifter", self._on_beep)
        self._hint(page, "Overlayet kan trækkes. Fokus-tjekket virker på Windows, så tasterne er i fred i Discord.")

        self._section(page, "Test")
        self.test_label = ctk.CTkLabel(page, text="Sender tasterne om 3 sekunder til det vindue, der har fokus.", text_color=MUTED, anchor="w", font=self.display_font(16))
        self.test_label.pack(fill="x", padx=22, pady=(0, 8))
        tests = ctk.CTkFrame(page, fg_color="transparent")
        tests.pack(fill="x", padx=22, pady=(0, 8))
        self._text_button(tests, "Test hurtig reset", lambda: self._arm_test("instant_reset")).pack(side="left", padx=(0, 8))
        self._text_button(tests, "Test hurtig edit", lambda: self._arm_test("fast_confirm")).pack(side="left")
        self.admin_label = ctk.CTkLabel(page, text="", text_color=MUTED, anchor="w", justify="left", wraplength=620, font=self.display_font(15))
        self.admin_label.pack(fill="x", padx=22, pady=(8, 4))
        if sys.platform == "win32" and not is_admin():
            self._text_button(page, "Start som administrator", self._relaunch_admin, lime=True).pack(anchor="w", padx=22, pady=(0, 16))

    def _build_profile_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._page_head(page, "04  /  PROFIL", "Profiler", "En profil gemmer edit-tilstand og edit-, reset- og bekræft-tast. Genvejen hopper til næste.")
        self._key_row(page, "Skift profil", lambda: self.cfg["profile_cycle_hotkey"], lambda value: self._set_root("profile_cycle_hotkey", value))
        row = ctk.CTkFrame(page, fg_color="transparent")
        row.pack(fill="x", padx=22, pady=8)
        self.profile_name = ctk.CTkEntry(
            row,
            placeholder_text="Navn på profil",
            height=36,
            corner_radius=0,
            border_width=1,
            border_color=LINE,
            fg_color="#0c1018",
            text_color=TEXT,
            placeholder_text_color=MUTED,
            font=self.display_font(16),
        )
        self.profile_name.pack(side="left", fill="x", expand=True, padx=(0, 8))
        self._text_button(row, "Gem nuværende", self._save_profile, lime=True).pack(side="right")
        self.profile_list = ctk.CTkFrame(page, fg_color="transparent")
        self.profile_list.pack(fill="x", padx=22, pady=6)

    def arm_capture(self, button: KeyButton) -> None:
        if self._capture_button and self._capture_button is not button:
            self._capture_button.cancel()
        self._capture_button = button
        self.engine.begin_capture(True)

    def commit(self) -> None:
        if self._loading:
            return
        clamp_config(self.cfg)
        save_config(self.cfg)
        self.refresh_status()

    def refresh_status(self) -> None:
        edit = self.cfg["edit"]
        on = self.engine.enabled if hasattr(self, "engine") else self.cfg["enabled"]
        self.state_label.configure(text="TIL" if on else "FRA", text_color=LIME if on else HOT)
        self.power.configure(fg_color="#14200a" if on else "#16080c")
        self.toggle_button.configure(
            text="SLUK" if on else "TÆND",
            fg_color=LIME if on else HOT,
            hover_color="#eaff86" if on else "#ff6a80",
            text_color=LIME_INK,
        )
        profile = self.cfg.get("active_profile") or "ikke gemt"
        self.edit_readout.configure(
            text=f"EDIT  {display(edit['edit_key'])}\n{MODE_TITLE.get(edit['mode'], edit['mode'])}  ·  {profile}"
        )
        self._render_sequence()
        notes = []
        _master, _actions, dupes = resolve(self.cfg)
        if dupes:
            notes.append(duplicate_text(dupes))
        if edit["mode"] == "double" and edit["confirm_key"] == edit["edit_key"]:
            notes.append("Vælg en anden bekræft-tast end edit.")
        self.warning.configure(text="\n".join(notes), fg_color=AMBER_BG if notes else "transparent")
        if hasattr(self, "overlay"):
            state = "TIL" if on else "FRA"
            self.overlay.show_state(f"{state}\nEDIT   {display(edit['edit_key'])}\nRESET  {display(edit['reset_key'])}")
        if hasattr(self, "admin_label"):
            if sys.platform == "win32":
                self.admin_label.configure(
                    text="Kører som administrator." if is_admin() else "Ikke administrator. Hvis genvejene udebliver i spillet, så start den som administrator."
                )
            else:
                self.admin_label.configure(text="Bygget til Windows. Her kan du sætte tasterne, men selve spillet kører der.")

    def _render_sequence(self) -> None:
        for child in self.seq_box.winfo_children():
            child.destroy()
        edit = self.cfg["edit"]
        step = self.cfg["step_ms"]
        blocks = [
            ("Hurtig reset", describe(instant_reset(edit["edit_key"], edit["reset_key"], edit["confirm_key"], step, edit["mode"]))),
            ("Hurtig edit", describe(fast_confirm(edit["edit_key"], edit["confirm_key"], step, edit["mode"]))),
        ]
        if edit["mode"] == "release":
            blocks.append(
                (
                    "Ved slip",
                    [
                        f"1. Hold {display(edit['edit_key'])}",
                        "2. Vælg felter med musen",
                        f"3. Slip {display(edit['edit_key'])}",
                    ],
                )
            )
        for title, lines in blocks:
            ctk.CTkLabel(self.seq_box, text=title.upper(), anchor="w", text_color=MUTED, font=self.mono_font(11, "bold")).pack(fill="x", padx=8, pady=(10, 4))
            if not lines:
                ctk.CTkLabel(self.seq_box, text="Sæt en edit-tast", anchor="w", text_color=TEXT, font=self.display_font(16)).pack(fill="x", padx=8)
                continue
            for line in lines:
                text = line.split(". ", 1)[-1]
                number = line.split(".", 1)[0] if ". " in line else ""
                row = ctk.CTkFrame(self.seq_box, fg_color="transparent")
                row.pack(fill="x", padx=8, pady=2)
                badge = ctk.CTkLabel(row, text=number, width=26, height=26, fg_color=LIME, text_color=LIME_INK, font=self.mono_font(12, "bold"))
                badge.pack(side="left", padx=(0, 8))
                ctk.CTkLabel(row, text=text, anchor="w", text_color=TEXT, font=self.display_font(16)).pack(side="left")

    def _load_form(self) -> None:
        self._loading = True
        try:
            edit = self.cfg["edit"]
            for button, getter in self.binders:
                button.set_value(getter())
            self.add_cycle.set_value("")
            self.add_cycle.configure(text="+ TAST", text_color=LIME, border_color=LIME, fg_color="#141a0c")
            self.mode_switch.set(dict(MODE_CHOICES)[edit["mode"]])
            self.mode_help.configure(text=MODE_HELP[edit["mode"]])
            if edit["mode"] == "double":
                self.confirm_button.configure(state="normal")
                self.confirm_button.set_value(edit["confirm_key"])
            else:
                self.confirm_button.configure(state="disabled", fg_color="#10141c", text_color="#667084", border_color="#242b3a")
            self.turbo_slider.set(edit["turbo_ms"])
            self.turbo_label.configure(text=f"Turbo-interval   {edit['turbo_ms']} ms")
            self.step_slider.set(self.cfg["step_ms"])
            self.step_value.configure(text=f"Forsinkelse   {self.cfg['step_ms']} ms")
            self.jitter_slider.set(self.cfg["jitter_ms"])
            self.jitter_value.configure(text=f"Tilfældig pause   {self.cfg['jitter_ms']} ms")
            if edit["scroll_reset"]:
                self.scroll_switch.select()
            else:
                self.scroll_switch.deselect()
            self.scroll_menu.set(dict(SCROLL_CHOICES)[edit["scroll_direction"]])
            if self.cfg["build"]["auto_place"]:
                self.auto_place.select()
            else:
                self.auto_place.deselect()
            for piece_id, box in self.piece_cycle.items():
                if self.cfg["build"]["pieces"][piece_id]["in_cycle"]:
                    box.select()
                else:
                    box.deselect()
            self.pickup_slider.set(self.cfg["extras"]["pickup_ms"])
            self.pickup_value.configure(text=f"Saml op-interval   {self.cfg['extras']['pickup_ms']} ms")
            self._set_switch(self.fortnite_switch, self.cfg["only_fortnite"])
            self._set_switch(self.overlay_switch, self.cfg["overlay"])
            self._set_switch(self.beep_switch, self.cfg["beep_on_switch"])
            self._reload_cycle()
            self._reload_profiles()
        finally:
            self._loading = False

    def _reload_cycle(self) -> None:
        for child in self.cycle_frame.winfo_children():
            child.destroy()
        for key in self.cfg["edit"]["cycle_keys"]:
            row = ctk.CTkFrame(self.cycle_frame, fg_color=STRIP, corner_radius=0, height=44)
            row.pack(fill="x", pady=1)
            row.pack_propagate(False)
            ctk.CTkLabel(row, text=display(key), anchor="w", text_color=TEXT, font=self.mono_font(14, "bold")).pack(side="left", padx=12)
            self._text_button(row, "Fjern", lambda k=key: self._remove_cycle_key(k)).pack(side="right", padx=6, pady=5)

    def _reload_profiles(self) -> None:
        for child in self.profile_list.winfo_children():
            child.destroy()
        if not self.cfg["profiles"]:
            ctk.CTkLabel(self.profile_list, text="Ingen profiler endnu.", text_color=MUTED, font=self.display_font(16)).pack(anchor="w")
            return
        for profile in self.cfg["profiles"]:
            active = profile["name"] == self.cfg.get("active_profile")
            row = ctk.CTkFrame(self.profile_list, fg_color="#1b240f" if active else STRIP, corner_radius=0, border_width=1, border_color=LIME if active else LINE)
            row.pack(fill="x", pady=4)
            text = ctk.CTkFrame(row, fg_color="transparent")
            text.pack(side="left", padx=12, pady=8)
            ctk.CTkLabel(text, text=profile["name"], anchor="w", text_color=LIME if active else TEXT, font=self.display_font(22, "bold")).pack(anchor="w")
            ctk.CTkLabel(
                text,
                text=f"{display(profile['edit_key'])}   ·   {MODE_TITLE.get(profile['mode'], profile['mode'])}",
                anchor="w",
                text_color=MUTED,
                font=self.display_font(15),
            ).pack(anchor="w")
            self._text_button(row, "Slet", lambda n=profile["name"]: self._delete_profile(n)).pack(side="right", padx=8, pady=10)
            self._text_button(row, "Brug", lambda n=profile["name"]: self._use_profile(n), lime=active).pack(side="right", pady=10)

    def _engine_event(self, kind: str, payload) -> None:
        self.after(0, lambda: self._on_engine(kind, payload))

    def _on_engine(self, kind: str, payload) -> None:
        if kind == "log" and payload:
            self._append_log(payload)
        elif kind == "capture":
            button = self._capture_button
            self._capture_button = None
            if button is not None:
                button.apply(payload)
        elif kind in ("toggle", "changed"):
            if kind == "changed":
                self._load_form()
            save_config(self.cfg)
            self.refresh_status()

    def _append_log(self, text: str) -> None:
        self.log_box.configure(state="normal")
        self.log_box.insert("end", text + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _set_switch(self, switch: ctk.CTkSwitch, value: bool) -> None:
        if value:
            switch.select()
        else:
            switch.deselect()

    def _set_edit(self, field: str, value: str) -> None:
        self.cfg["edit"][field] = value
        if field in ("edit_key", "reset_key", "confirm_key"):
            self.cfg["active_profile"] = ""
        self.commit()

    def _set_edit_key(self, value: str) -> None:
        self.cfg["edit"]["edit_key"] = value
        if self.cfg["edit"]["mode"] != "double":
            self.cfg["edit"]["confirm_key"] = value
        self.cfg["active_profile"] = ""
        self.commit()
        self._load_form()

    def _set_build(self, field: str, value: str) -> None:
        self.cfg["build"][field] = value
        self.commit()

    def _set_piece(self, piece_id: str, field: str, value: str) -> None:
        self.cfg["build"]["pieces"][piece_id][field] = value
        self.commit()

    def _set_extra(self, field: str, value: str) -> None:
        self.cfg["extras"][field] = value
        self.commit()

    def _set_slot(self, slot_id: str, field: str, value: str) -> None:
        self.cfg["extras"]["slots"][slot_id][field] = value
        self.commit()

    def _set_root(self, field: str, value: str) -> None:
        self.cfg[field] = value
        self.commit()

    def _set_master(self, value: str) -> None:
        self.cfg["master_toggle"] = value or "f8"
        self.commit()

    def _on_mode(self, label: str) -> None:
        if self._loading:
            return
        mode = next(mode for mode, text in MODE_CHOICES if text == label)
        self.cfg["edit"]["mode"] = mode
        if mode != "double":
            self.cfg["edit"]["confirm_key"] = self.cfg["edit"]["edit_key"]
        self.cfg["active_profile"] = ""
        self.commit()
        self._load_form()

    def _on_turbo(self, value: float) -> None:
        if self._loading:
            return
        self.cfg["edit"]["turbo_ms"] = int(round(value))
        self.turbo_label.configure(text=f"Turbo-interval   {self.cfg['edit']['turbo_ms']} ms")
        self.commit()

    def _on_step(self, value: float) -> None:
        if self._loading:
            return
        self.cfg["step_ms"] = int(round(value))
        self.step_value.configure(text=f"Forsinkelse   {self.cfg['step_ms']} ms")
        self.commit()

    def _on_jitter(self, value: float) -> None:
        if self._loading:
            return
        self.cfg["jitter_ms"] = int(round(value))
        self.jitter_value.configure(text=f"Tilfældig pause   {self.cfg['jitter_ms']} ms")
        self.commit()

    def _on_pickup(self, value: float) -> None:
        if self._loading:
            return
        self.cfg["extras"]["pickup_ms"] = int(round(value))
        self.pickup_value.configure(text=f"Saml op-interval   {self.cfg['extras']['pickup_ms']} ms")
        self.commit()

    def _on_scroll_switch(self) -> None:
        if self._loading:
            return
        self.cfg["edit"]["scroll_reset"] = bool(self.scroll_switch.get())
        self.commit()

    def _on_scroll_dir(self, label: str) -> None:
        if self._loading:
            return
        self.cfg["edit"]["scroll_direction"] = next(key for key, text in SCROLL_CHOICES if text == label)
        self.commit()

    def _on_auto_place(self) -> None:
        if self._loading:
            return
        self.cfg["build"]["auto_place"] = bool(self.auto_place.get())
        self.commit()

    def _on_piece_cycle(self, piece_id: str) -> None:
        if self._loading:
            return
        self.cfg["build"]["pieces"][piece_id]["in_cycle"] = bool(self.piece_cycle[piece_id].get())
        self.commit()

    def _on_fortnite_only(self) -> None:
        if self._loading:
            return
        self.cfg["only_fortnite"] = bool(self.fortnite_switch.get())
        self.engine._focus_checked = 0
        self.commit()

    def _on_overlay(self) -> None:
        if self._loading:
            return
        self.cfg["overlay"] = bool(self.overlay_switch.get())
        self.commit()

    def _on_beep(self) -> None:
        if self._loading:
            return
        self.cfg["beep_on_switch"] = bool(self.beep_switch.get())
        self.commit()

    def _preset(self, name: str) -> None:
        apply_preset(self.cfg, name)
        self._load_form()
        self.commit()

    def _recommend(self) -> None:
        recommend(self.cfg)
        self._load_form()
        self.commit()

    def _add_cycle_key(self, value: str) -> None:
        keys = self.cfg["edit"]["cycle_keys"]
        if value and value not in keys and len(keys) < 6:
            keys.append(value)
        self.commit()
        self._load_form()

    def _remove_cycle_key(self, key: str) -> None:
        self.cfg["edit"]["cycle_keys"] = [item for item in self.cfg["edit"]["cycle_keys"] if item != key]
        self.commit()
        self._load_form()

    def _save_profile(self) -> None:
        if upsert_profile(self.cfg, self.profile_name.get()):
            self.profile_name.delete(0, "end")
            self.commit()
            self._load_form()

    def _use_profile(self, name: str) -> None:
        for profile in self.cfg["profiles"]:
            if profile["name"] == name:
                apply_profile(self.cfg, profile)
                break
        self.commit()
        self._load_form()

    def _delete_profile(self, name: str) -> None:
        delete_profile(self.cfg, name)
        self.commit()
        self._load_form()

    def _click_toggle(self) -> None:
        self.engine._toggle()

    def _arm_test(self, action: str) -> None:
        self.test_label.configure(text="Sender om 3 sekunder. Klik over i det vindue, der skal have tasterne.")
        self.after(3000, lambda: self.engine.run_action(action, force=True))

    def _relaunch_admin(self) -> None:
        import ctypes
        import os

        script = os.path.abspath(sys.argv[0])
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, f'"{script}"', os.getcwd(), 1)
        self._close()

    def _close(self) -> None:
        try:
            save_config(self.cfg)
        finally:
            self.engine.shutdown()
            self.destroy()


def run(cfg: dict | None = None) -> None:
    load_fonts()
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")
    app = App(cfg or load_config())
    app.mainloop()
