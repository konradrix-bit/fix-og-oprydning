"""Vinduet hvor alting kan skiftes."""

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
from app.sequences import MODE_TITLE, summary
from app.system import is_admin

BG = "#10141b"
PANEL = "#171d27"
PANEL_2 = "#121820"
LINE = "#2c3646"
TEXT = "#e8eef7"
MUTED = "#93a0b5"
BUTTON = "#243044"
HOVER = "#31445e"
ARMED = "#2f6f9f"
ON = "#1f7a4d"
ON_HOVER = "#289262"
OFF = "#8c3140"
OFF_HOVER = "#a84354"
WARN = "#e0b15a"

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


class KeyButton(ctk.CTkButton):
    def __init__(self, master, app: "App", on_change):
        super().__init__(
            master,
            text="Ikke sat",
            width=150,
            height=30,
            corner_radius=8,
            fg_color=BUTTON,
            hover_color=HOVER,
            text_color=TEXT,
            command=self._arm,
        )
        self.app = app
        self.on_change = on_change
        self.value = ""

    def set_value(self, value: str) -> None:
        self.value = value or ""
        self.configure(text=display(self.value) if self.value else "Ikke sat", fg_color=BUTTON)

    def cancel(self) -> None:
        self.set_value(self.value)

    def _arm(self) -> None:
        self.configure(text="Tryk en tast…", fg_color=ARMED)
        self.app.arm_capture(self)

    def apply(self, name) -> None:
        if name is None:
            self.set_value(self.value)
            return
        self.set_value(name)
        self.on_change(name)


class Overlay(ctk.CTkToplevel):
    def __init__(self, app: "App"):
        super().__init__(app)
        self.app = app
        self.title("makro")
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        try:
            self.attributes("-alpha", 0.92)
        except Exception:
            pass
        try:
            self.attributes("-toolwindow", True)
        except Exception:
            pass
        self.configure(fg_color="#0d131c")
        self.resizable(False, False)
        self.label = ctk.CTkLabel(self, text="", justify="left", anchor="w", text_color=TEXT, font=ctk.CTkFont(size=13, weight="bold"))
        self.label.pack(padx=12, pady=8, anchor="w")
        self._drag_x = 0
        self._drag_y = 0
        self.bind("<ButtonPress-1>", self._press)
        self.bind("<B1-Motion>", self._drag)
        self.bind("<ButtonRelease-1>", self._release)
        self.label.bind("<ButtonPress-1>", self._press)
        self.label.bind("<B1-Motion>", self._drag)
        self.label.bind("<ButtonRelease-1>", self._release)

    def place_saved(self) -> None:
        cfg = self.app.cfg
        x = int(cfg["overlay_x"])
        y = int(cfg["overlay_y"])
        if (x, y) == (28, 28):
            self.update_idletasks()
            x = max(12, self.winfo_screenwidth() - 220)
            y = 40
        self.geometry(f"200x86+{x}+{y}")

    def show_state(self, text: str) -> None:
        self.label.configure(text=text)
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
        super().__init__()
        self.cfg = cfg
        self._loading = False
        self._capture_button: KeyButton | None = None
        self.binders: list[tuple[KeyButton, callable]] = []
        self.title("Fortnite Makro")
        self.geometry("1120x860")
        self.minsize(980, 680)
        self.configure(fg_color=BG)
        self._build()
        self.overlay = Overlay(self)
        self.overlay.place_saved()
        self.engine = Engine(self.cfg, on_event=self._engine_event)
        self.protocol("WM_DELETE_WINDOW", self._close)
        self._load_form()
        self.refresh_status()
        self.engine.start()

    def _build(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=0)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, fg_color=PANEL, corner_radius=0, height=78)
        header.grid(row=0, column=0, columnspan=2, sticky="ew")
        header.grid_propagate(False)
        self.toggle_button = ctk.CTkButton(header, text="Slå til", width=130, height=40, corner_radius=10, command=self._click_toggle)
        self.toggle_button.pack(side="left", padx=(16, 10), pady=18)
        self.state_label = ctk.CTkLabel(header, text="FRA", width=72, font=ctk.CTkFont(size=18, weight="bold"))
        self.state_label.pack(side="left")
        self.summary_label = ctk.CTkLabel(header, text="", text_color=TEXT, font=ctk.CTkFont(size=15))
        self.summary_label.pack(side="left", padx=18)
        self.delay_label = ctk.CTkLabel(header, text="", text_color=MUTED)
        self.delay_label.pack(side="right", padx=18)

        tabs = ctk.CTkTabview(
            self,
            fg_color=PANEL,
            segmented_button_fg_color=BUTTON,
            segmented_button_selected_color="#2f6f9f",
            segmented_button_selected_hover_color="#3c82b6",
            segmented_button_unselected_color=BUTTON,
            segmented_button_unselected_hover_color=HOVER,
            text_color=TEXT,
        )
        tabs.grid(row=1, column=0, sticky="nsew", padx=(12, 6), pady=12)
        for name in ("Edits", "Byg", "Ekstra", "Profiler"):
            tabs.add(name)
            tabs.tab(name).grid_columnconfigure(0, weight=1)
            tabs.tab(name).grid_rowconfigure(0, weight=1)
        self._build_edit_tab(tabs.tab("Edits"))
        self._build_build_tab(tabs.tab("Byg"))
        self._build_extra_tab(tabs.tab("Ekstra"))
        self._build_profile_tab(tabs.tab("Profiler"))

        side = ctk.CTkFrame(self, fg_color=PANEL, width=340)
        side.grid(row=1, column=1, sticky="nsew", padx=(6, 12), pady=12)
        side.grid_propagate(False)
        ctk.CTkLabel(side, text="Sekvens", anchor="w", font=ctk.CTkFont(size=15, weight="bold")).pack(fill="x", padx=12, pady=(12, 4))
        self.preview = ctk.CTkTextbox(side, height=340, fg_color=PANEL_2, text_color=TEXT, wrap="word")
        self.preview.pack(fill="both", expand=True, padx=12, pady=4)
        self.preview.configure(state="disabled")
        self.warning = ctk.CTkLabel(side, text="", text_color=WARN, wraplength=310, justify="left", anchor="w")
        self.warning.pack(fill="x", padx=12, pady=(4, 0))
        ctk.CTkLabel(side, text="Log", anchor="w", text_color=MUTED).pack(fill="x", padx=12, pady=(8, 0))
        self.log_box = ctk.CTkTextbox(side, height=150, fg_color=PANEL_2, text_color=MUTED, wrap="word")
        self.log_box.pack(fill="x", padx=12, pady=(4, 12))
        self.log_box.configure(state="disabled")

        footer = ctk.CTkLabel(
            self,
            text="Klik på en tast og tryk den nye. Delete rydder. Escape annullerer. F8 tænder og slukker.",
            text_color=MUTED,
            anchor="w",
        )
        footer.grid(row=2, column=0, columnspan=2, sticky="ew", padx=16, pady=(0, 10))

    def _scroller(self, parent) -> ctk.CTkScrollableFrame:
        frame = ctk.CTkScrollableFrame(parent, fg_color="transparent")
        frame.grid(row=0, column=0, sticky="nsew")
        return frame

    def _hint(self, parent, text: str) -> ctk.CTkLabel:
        label = ctk.CTkLabel(parent, text=text, text_color=MUTED, wraplength=640, justify="left", anchor="w")
        label.pack(fill="x", pady=(0, 8))
        return label

    def _section(self, parent, text: str) -> None:
        ctk.CTkLabel(parent, text=text, anchor="w", font=ctk.CTkFont(size=15, weight="bold")).pack(fill="x", pady=(12, 4))

    def _key_row(self, parent, label: str, getter, setter) -> KeyButton:
        row = ctk.CTkFrame(parent, fg_color="transparent")
        row.pack(fill="x", pady=3)
        ctk.CTkLabel(row, text=label, width=250, anchor="w").pack(side="left")
        button = KeyButton(row, self, setter)
        button.pack(side="right")
        self.binders.append((button, getter))
        return button

    def _build_edit_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._hint(
            page,
            "Sæt de samme taster i Fortnite under Edit og Reset. Makroen sender kun de tryk, du har valgt her.",
        )
        self.mode_help = self._hint(page, "")
        labels = [label for _mode, label in MODE_CHOICES]
        self.mode_switch = ctk.CTkSegmentedButton(page, values=labels, command=self._on_mode)
        self.mode_switch.pack(fill="x", pady=(0, 8))

        self._key_row(page, "Edit-tast i spillet", lambda: self.cfg["edit"]["edit_key"], self._set_edit_key)
        self.confirm_button = self._key_row(
            page, "Bekræft-tast i spillet", lambda: self.cfg["edit"]["confirm_key"], lambda value: self._set_edit("confirm_key", value)
        )
        self._key_row(page, "Reset-tast i spillet", lambda: self.cfg["edit"]["reset_key"], lambda value: self._set_edit("reset_key", value))
        self._key_row(
            page,
            "Genvej: hurtig reset",
            lambda: self.cfg["edit"]["instant_reset_hotkey"],
            lambda value: self._set_edit("instant_reset_hotkey", value),
        )
        self._key_row(
            page,
            "Genvej: hurtig edit",
            lambda: self.cfg["edit"]["fast_confirm_hotkey"],
            lambda value: self._set_edit("fast_confirm_hotkey", value),
        )
        self._key_row(
            page,
            "Genvej: turbo-reset (hold)",
            lambda: self.cfg["edit"]["turbo_hotkey"],
            lambda value: self._set_edit("turbo_hotkey", value),
        )

        turbo = ctk.CTkFrame(page, fg_color="transparent")
        turbo.pack(fill="x", pady=3)
        self.turbo_label = ctk.CTkLabel(turbo, text="", width=250, anchor="w")
        self.turbo_label.pack(side="left")
        self.turbo_slider = ctk.CTkSlider(turbo, from_=15, to=150, number_of_steps=135, command=self._on_turbo)
        self.turbo_slider.pack(side="right", fill="x", expand=True, padx=(8, 0))

        scroll = ctk.CTkFrame(page, fg_color="transparent")
        scroll.pack(fill="x", pady=6)
        self.scroll_switch = ctk.CTkSwitch(scroll, text="Scroll er reset", command=self._on_scroll_switch)
        self.scroll_switch.pack(side="left")
        self.scroll_menu = ctk.CTkOptionMenu(scroll, values=[label for _key, label in SCROLL_CHOICES], command=self._on_scroll_dir, width=140)
        self.scroll_menu.pack(side="right")

        self._section(page, "Tempo")
        step = ctk.CTkFrame(page, fg_color="transparent")
        step.pack(fill="x", pady=3)
        self.step_value = ctk.CTkLabel(step, text="", width=250, anchor="w")
        self.step_value.pack(side="left")
        self.step_slider = ctk.CTkSlider(step, from_=0, to=50, number_of_steps=50, command=self._on_step)
        self.step_slider.pack(side="right", fill="x", expand=True, padx=(8, 0))
        jitter = ctk.CTkFrame(page, fg_color="transparent")
        jitter.pack(fill="x", pady=3)
        self.jitter_value = ctk.CTkLabel(jitter, text="", width=250, anchor="w")
        self.jitter_value.pack(side="left")
        self.jitter_slider = ctk.CTkSlider(jitter, from_=0, to=20, number_of_steps=20, command=self._on_jitter)
        self.jitter_slider.pack(side="right", fill="x", expand=True, padx=(8, 0))
        presets = ctk.CTkFrame(page, fg_color="transparent")
        presets.pack(fill="x", pady=8)
        for name, label in (("stabil", "Stabil"), ("hurtig", "Hurtig"), ("instant", "Instant")):
            ctk.CTkButton(presets, text=label, width=100, fg_color=BUTTON, hover_color=HOVER, command=lambda n=name: self._preset(n)).pack(side="left", padx=(0, 8))
        ctk.CTkButton(page, text="Anbefalet opsætning", fg_color=BUTTON, hover_color=HOVER, command=self._recommend).pack(anchor="w", pady=(4, 8))

        self._section(page, "Skift edit-tast")
        self._hint(page, "Genvejen hopper til næste edit-tast. I tilstandene Ved slip og Samme tast følger bekræft med.")
        self._key_row(
            page,
            "Genvej: skift edit-tast",
            lambda: self.cfg["edit"]["cycle_hotkey"],
            lambda value: self._set_edit("cycle_hotkey", value),
        )
        self.cycle_frame = ctk.CTkFrame(page, fg_color="transparent")
        self.cycle_frame.pack(fill="x", pady=4)
        self.add_cycle = KeyButton(page, self, self._add_cycle_key)
        self.add_cycle.pack(anchor="w", pady=4)

    def _build_build_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._hint(page, "Spiltasten er den tast, Fortnite allerede bruger. Genvejen trykker den for dig. Replace trykker også placer.")
        self._key_row(page, "Placer-tast", lambda: self.cfg["build"]["place_key"], lambda value: self._set_build("place_key", value))
        self.auto_place = ctk.CTkSwitch(page, text="Placer med det samme på bygge-genveje", command=self._on_auto_place)
        self.auto_place.pack(anchor="w", pady=6)
        self._key_row(
            page,
            "Genvej: skift byggedel",
            lambda: self.cfg["build"]["cycle_hotkey"],
            lambda value: self._set_build("cycle_hotkey", value),
        )
        self.piece_game = {}
        self.piece_hot = {}
        self.piece_replace = {}
        self.piece_cycle = {}
        for piece_id in PIECE_ORDER:
            self._section(page, PIECE_LABELS[piece_id])
            self.piece_game[piece_id] = self._key_row(
                page, "Tast i spillet", lambda pid=piece_id: self.cfg["build"]["pieces"][pid]["game_key"], lambda value, pid=piece_id: self._set_piece(pid, "game_key", value)
            )
            self.piece_hot[piece_id] = self._key_row(
                page, "Genvej", lambda pid=piece_id: self.cfg["build"]["pieces"][pid]["hotkey"], lambda value, pid=piece_id: self._set_piece(pid, "hotkey", value)
            )
            self.piece_replace[piece_id] = self._key_row(
                page,
                "Replace-genvej",
                lambda pid=piece_id: self.cfg["build"]["pieces"][pid]["replace_hotkey"],
                lambda value, pid=piece_id: self._set_piece(pid, "replace_hotkey", value),
            )
            box = ctk.CTkCheckBox(page, text="Med i bygge-skift", command=lambda pid=piece_id: self._on_piece_cycle(pid))
            box.pack(anchor="w", pady=(0, 4))
            self.piece_cycle[piece_id] = box

    def _build_extra_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._hint(page, "Alt her kan slås fra ved at rydde genvejen. Makroen gør ingenting, før du slår den til.")
        self._key_row(page, "Saml op-tast i spillet", lambda: self.cfg["extras"]["pickup_key"], lambda value: self._set_extra("pickup_key", value))
        self._key_row(page, "Genvej: saml op (hold)", lambda: self.cfg["extras"]["pickup_hotkey"], lambda value: self._set_extra("pickup_hotkey", value))
        pickup = ctk.CTkFrame(page, fg_color="transparent")
        pickup.pack(fill="x", pady=3)
        self.pickup_value = ctk.CTkLabel(pickup, text="", width=250, anchor="w")
        self.pickup_value.pack(side="left")
        self.pickup_slider = ctk.CTkSlider(pickup, from_=15, to=150, number_of_steps=135, command=self._on_pickup)
        self.pickup_slider.pack(side="right", fill="x", expand=True, padx=(8, 0))

        self._section(page, "Våben")
        self._key_row(
            page,
            "Genvej: skift slot",
            lambda: self.cfg["extras"]["slot_cycle_hotkey"],
            lambda value: self._set_extra("slot_cycle_hotkey", value),
        )
        for slot_id in ("1", "2", "3", "4", "5"):
            row_label = f"Slot {slot_id}"
            self._key_row(
                page,
                f"{row_label} i spillet",
                lambda sid=slot_id: self.cfg["extras"]["slots"][sid]["game_key"],
                lambda value, sid=slot_id: self._set_slot(sid, "game_key", value),
            )
            self._key_row(
                page,
                f"{row_label} genvej",
                lambda sid=slot_id: self.cfg["extras"]["slots"][sid]["hotkey"],
                lambda value, sid=slot_id: self._set_slot(sid, "hotkey", value),
            )

        self._section(page, "Makroen")
        self._key_row(page, "Tænd / sluk", lambda: self.cfg["master_toggle"], self._set_master)
        self.fortnite_switch = ctk.CTkSwitch(page, text="Kun når Fortnite er i fokus", command=self._on_fortnite_only)
        self.fortnite_switch.pack(anchor="w", pady=4)
        self.overlay_switch = ctk.CTkSwitch(page, text="Vis overlay", command=self._on_overlay)
        self.overlay_switch.pack(anchor="w", pady=4)
        self.beep_switch = ctk.CTkSwitch(page, text="Lyd når edit-tast eller profil skifter", command=self._on_beep)
        self.beep_switch.pack(anchor="w", pady=4)
        self._hint(page, "Overlayet kan trækkes. Fokus-tjekket virker på Windows og lader tasterne være i fred i Discord.")

        self._section(page, "Test")
        self.test_label = ctk.CTkLabel(page, text="Sender tasterne om 3 sekunder til det vindue, der har fokus.", text_color=MUTED, anchor="w")
        self.test_label.pack(fill="x", pady=(0, 6))
        tests = ctk.CTkFrame(page, fg_color="transparent")
        tests.pack(fill="x")
        ctk.CTkButton(tests, text="Test hurtig reset", fg_color=BUTTON, hover_color=HOVER, command=lambda: self._arm_test("instant_reset")).pack(side="left", padx=(0, 8))
        ctk.CTkButton(tests, text="Test hurtig edit", fg_color=BUTTON, hover_color=HOVER, command=lambda: self._arm_test("fast_confirm")).pack(side="left")
        self.admin_label = ctk.CTkLabel(page, text="", text_color=MUTED, anchor="w")
        self.admin_label.pack(fill="x", pady=(12, 4))
        if sys.platform == "win32" and not is_admin():
            ctk.CTkButton(page, text="Start som administrator", fg_color=BUTTON, hover_color=HOVER, command=self._relaunch_admin).pack(anchor="w", pady=(0, 8))

    def _build_profile_tab(self, parent) -> None:
        page = self._scroller(parent)
        self._hint(page, "En profil gemmer edit-tilstand og edit-, reset- og bekræft-tast. Genvejen skifter til næste profil.")
        self._key_row(
            page,
            "Genvej: skift profil",
            lambda: self.cfg["profile_cycle_hotkey"],
            lambda value: self._set_root("profile_cycle_hotkey", value),
        )
        row = ctk.CTkFrame(page, fg_color="transparent")
        row.pack(fill="x", pady=6)
        self.profile_name = ctk.CTkEntry(row, placeholder_text="Navn på profil")
        self.profile_name.pack(side="left", fill="x", expand=True, padx=(0, 8))
        ctk.CTkButton(row, text="Gem nuværende", width=140, fg_color=BUTTON, hover_color=HOVER, command=self._save_profile).pack(side="right")
        self.profile_list = ctk.CTkFrame(page, fg_color="transparent")
        self.profile_list.pack(fill="x", pady=6)

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
        self.state_label.configure(text="TIL" if on else "FRA", text_color=ON if on else OFF)
        self.toggle_button.configure(
            text="Slå fra" if on else "Slå til",
            fg_color=ON if on else OFF,
            hover_color=ON_HOVER if on else OFF_HOVER,
        )
        profile = self.cfg.get("active_profile") or "ikke gemt"
        self.summary_label.configure(
            text=f"Edit {display(edit['edit_key'])}   ·   {MODE_TITLE.get(edit['mode'], edit['mode'])}   ·   {profile}"
        )
        self.delay_label.configure(text=f"{self.cfg['step_ms']} ms")
        self._set_text(self.preview, summary(self.cfg))
        _master, _actions, dupes = resolve(self.cfg)
        self.warning.configure(text=duplicate_text(dupes))
        if hasattr(self, "overlay"):
            state = "TIL" if on else "FRA"
            self.overlay.show_state(f"{state}\nEdit  {display(edit['edit_key'])}\nReset {display(edit['reset_key'])}")
        if hasattr(self, "admin_label"):
            if sys.platform == "win32":
                self.admin_label.configure(
                    text="Kører som administrator." if is_admin() else "Ikke administrator. Hvis genvejene udebliver i spillet, så start den som administrator."
                )
            else:
                self.admin_label.configure(text="Bygget til Windows. Her kan du sætte tasterne, men selve spillet kører der.")

    def _load_form(self) -> None:
        self._loading = True
        try:
            edit = self.cfg["edit"]
            for button, getter in self.binders:
                button.set_value(getter())
            self.add_cycle.set_value("")
            self.add_cycle.configure(text="Tilføj edit-tast")
            mode_label = dict(MODE_CHOICES)[edit["mode"]]
            self.mode_switch.set(mode_label)
            self.mode_help.configure(text=MODE_HELP[edit["mode"]])
            self.confirm_button.configure(state="normal" if edit["mode"] == "double" else "disabled")
            self.turbo_slider.set(edit["turbo_ms"])
            self.turbo_label.configure(text=f"Turbo-interval  {edit['turbo_ms']} ms")
            self.step_slider.set(self.cfg["step_ms"])
            self.step_value.configure(text=f"Forsinkelse  {self.cfg['step_ms']} ms")
            self.jitter_slider.set(self.cfg["jitter_ms"])
            self.jitter_value.configure(text=f"Tilfældig pause  {self.cfg['jitter_ms']} ms")
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
            self.pickup_value.configure(text=f"Saml op-interval  {self.cfg['extras']['pickup_ms']} ms")
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
            row = ctk.CTkFrame(self.cycle_frame, fg_color="transparent")
            row.pack(fill="x", pady=2)
            ctk.CTkLabel(row, text=display(key), anchor="w").pack(side="left")
            ctk.CTkButton(
                row,
                text="Fjern",
                width=70,
                fg_color=BUTTON,
                hover_color=HOVER,
                command=lambda k=key: self._remove_cycle_key(k),
            ).pack(side="right")

    def _reload_profiles(self) -> None:
        for child in self.profile_list.winfo_children():
            child.destroy()
        if not self.cfg["profiles"]:
            ctk.CTkLabel(self.profile_list, text="Ingen profiler endnu.", text_color=MUTED).pack(anchor="w")
            return
        for profile in self.cfg["profiles"]:
            row = ctk.CTkFrame(self.profile_list, fg_color=PANEL_2, corner_radius=8)
            row.pack(fill="x", pady=3)
            active = profile["name"] == self.cfg.get("active_profile")
            ctk.CTkLabel(
                row,
                text=f"{profile['name']}   ·   {display(profile['edit_key'])}   ·   {MODE_TITLE.get(profile['mode'], profile['mode'])}",
                anchor="w",
                text_color=TEXT if active else MUTED,
            ).pack(side="left", padx=10, pady=8)
            ctk.CTkButton(row, text="Slet", width=60, fg_color=BUTTON, hover_color=HOVER, command=lambda n=profile["name"]: self._delete_profile(n)).pack(side="right", padx=8, pady=6)
            ctk.CTkButton(row, text="Brug", width=60, fg_color=BUTTON, hover_color=HOVER, command=lambda n=profile["name"]: self._use_profile(n)).pack(side="right", pady=6)

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

    def _set_text(self, box: ctk.CTkTextbox, text: str) -> None:
        box.configure(state="normal")
        box.delete("1.0", "end")
        box.insert("1.0", text)
        box.configure(state="disabled")

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
        self.turbo_label.configure(text=f"Turbo-interval  {self.cfg['edit']['turbo_ms']} ms")
        self.commit()

    def _on_step(self, value: float) -> None:
        if self._loading:
            return
        self.cfg["step_ms"] = int(round(value))
        self.step_value.configure(text=f"Forsinkelse  {self.cfg['step_ms']} ms")
        self.commit()

    def _on_jitter(self, value: float) -> None:
        if self._loading:
            return
        self.cfg["jitter_ms"] = int(round(value))
        self.jitter_value.configure(text=f"Tilfældig pause  {self.cfg['jitter_ms']} ms")
        self.commit()

    def _on_pickup(self, value: float) -> None:
        if self._loading:
            return
        self.cfg["extras"]["pickup_ms"] = int(round(value))
        self.pickup_value.configure(text=f"Saml op-interval  {self.cfg['extras']['pickup_ms']} ms")
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
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")
    app = App(cfg or load_config())
    app.mainloop()
