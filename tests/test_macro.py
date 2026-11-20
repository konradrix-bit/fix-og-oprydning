from __future__ import annotations

import json

import pytest

from app.bindings import duplicate_text, resolve
from app.config import (
    apply_preset,
    clamp_config,
    cycle_edit_key,
    cycle_profile,
    default_config,
    delete_profile,
    load_config,
    merge,
    recommend,
    save_config,
    upsert_profile,
)
from app.engine import Engine
from app.keys import (
    WM_KEYDOWN,
    WM_KEYUP,
    WM_MOUSEWHEEL,
    WM_XBUTTONDOWN,
    WM_XBUTTONUP,
    clean_key,
    display,
    is_injected_keyboard,
    is_injected_mouse,
    keyboard_event,
    mouse_event,
    name_from_vk,
    vk_from_name,
)
from app.sequences import describe, execute, fast_confirm, instant_reset, select_piece, summary
from app.system import focus_allows, is_fortnite_title


class FakeSender:
    def __init__(self):
        self.events = []

    def down(self, key):
        self.events.append(("down", key))

    def up(self, key):
        self.events.append(("up", key))

    def scroll(self, amount):
        self.events.append(("scroll", amount))


class Seq:
    def __init__(self, values):
        self.values = list(values)

    def randint(self, _low, _high):
        return self.values.pop(0)


@pytest.fixture
def cfg():
    data = default_config()
    data["enabled"] = True
    data["only_fortnite"] = False
    data["beep_on_switch"] = False
    return data


@pytest.fixture
def engine(cfg):
    sender = FakeSender()
    eng = Engine(cfg, sender=sender, title_provider=lambda: "Fortnite")
    eng.sleep_ms = lambda _ms: None
    eng.trust_injected = True
    eng.platform = "win32"
    return eng


def test_release_reset_holds_edit_across_reset():
    actions = instant_reset("f", "g", "f", 0, "release")
    assert describe(actions) == ["1. Hold F", "2. Tryk G", "3. Slip F"]


def test_same_key_reset_is_three_taps():
    actions = instant_reset("f", "g", "f", 4, "same_key")
    assert [item.kind for item in actions] == ["tap", "tap", "tap"]
    assert [item.key for item in actions] == ["f", "g", "f"]


def test_double_edit_uses_confirm_key():
    actions = instant_reset("f", "g", "h", 4, "double")
    assert [item.key for item in actions] == ["f", "g", "h"]


def test_fast_confirm_release_is_tap_open_and_close():
    actions = fast_confirm("f", "f", 6, "release")
    assert describe(actions) == ["1. Hold F", "2. Slip F"]


def test_empty_edit_does_nothing():
    assert instant_reset("", "g", "", 6, "release") == []


def test_select_piece_can_place():
    placed = select_piece("q", "mouse_left", 6, True)
    assert [item.key for item in placed] == ["q", "mouse_left"]
    held = select_piece("q", "mouse_left", 6, False)
    assert [item.key for item in held] == ["q"]


def test_scroll_reset_action():
    actions = instant_reset("f", "scroll_up", "f", 6, "release")
    assert actions[1].kind == "scroll"
    assert actions[1].scroll == 1


def test_jitter_is_added_only_to_the_gap():
    sender = FakeSender()
    slept = []
    actions = instant_reset("f", "g", "f", 4, "same_key")
    execute(actions, sender, slept.append, jitter_ms=5, rng=Seq([5, 5, 5]))
    assert ("down", "f") in sender.events
    assert slept == [4, 9, 4, 9, 4]


def test_summary_mentions_the_active_edit_key():
    text = summary(default_config())
    assert "Edit F" in text
    assert "Hurtig reset" in text
    assert "Hold F" in text


def test_vk_and_mouse_messages():
    assert name_from_vk(0x46) == "f"
    assert name_from_vk(0x31) == "1"
    assert name_from_vk(0x77) == "f8"
    assert name_from_vk(0x20) == "space"
    assert vk_from_name("mouse_x1") == 5
    assert keyboard_event(WM_KEYDOWN, 0x46) == ("f", True)
    assert keyboard_event(WM_KEYUP, 0x46) == ("f", False)
    assert mouse_event(WM_XBUTTONDOWN, 1 << 16) == ("mouse_x1", True)
    assert mouse_event(WM_XBUTTONUP, 2 << 16) == ("mouse_x2", False)
    assert mouse_event(WM_MOUSEWHEEL, 120 << 16) == ("scroll_up", True)
    assert mouse_event(WM_MOUSEWHEEL, ((-120) & 0xFFFF) << 16) == ("scroll_down", True)
    assert is_injected_keyboard(0x10)
    assert not is_injected_keyboard(0)
    assert is_injected_mouse(0x01)
    assert clean_key("  F ") == "f"
    assert clean_key("mouse_x2") == "mouse_x2"
    assert clean_key("å") == "å"
    assert clean_key("ikke en tast") == ""
    assert display("mouse_x1") == "Mus side 1"


def test_fortnite_window_match():
    assert is_fortnite_title("Fortnite")
    assert is_fortnite_title("FortniteClient-Win64-Shipping")
    assert not is_fortnite_title("FortniteLauncher")
    assert not is_fortnite_title("Epic Games Launcher")
    assert not is_fortnite_title("Discord")
    assert focus_allows(True, "Discord", "win32") is False
    assert focus_allows(True, "Fortnite", "win32") is True
    assert focus_allows(False, "Discord", "win32") is True
    assert focus_allows(True, "", "linux") is True


def test_config_clamps_merges_and_roundtrips(tmp_path):
    loaded = merge(default_config(), {"step_ms": 3, "edit": {"edit_key": "k"}})
    assert loaded["edit"]["edit_key"] == "k"
    assert loaded["edit"]["reset_key"] == "g"
    cfg = clamp_config({"step_ms": 999, "jitter_ms": -4, "edit": {"turbo_ms": 1, "mode": "nope"}})
    assert cfg["step_ms"] == 50
    assert cfg["jitter_ms"] == 0
    assert cfg["edit"]["turbo_ms"] == 15
    assert cfg["edit"]["mode"] == "release"
    assert load_config(tmp_path / "missing.json")["edit"]["edit_key"] == "f"
    broken = tmp_path / "bad.json"
    broken.write_text("{", encoding="utf-8")
    assert load_config(broken)["master_toggle"] == "f8"
    path = tmp_path / "config.json"
    original = default_config()
    original["edit"]["edit_key"] = "l"
    original["edit"]["mode"] = "double"
    original["edit"]["confirm_key"] = "h"
    save_config(original, path)
    again = load_config(path)
    assert again["edit"]["confirm_key"] == "h"
    assert json.loads(path.read_text(encoding="utf-8"))["edit"]["edit_key"] == "l"


def test_profiles_and_edit_cycle_change_the_live_keys():
    cfg = default_config()
    assert cycle_edit_key(cfg) == "mouse_x2"
    assert cfg["edit"]["confirm_key"] == "mouse_x2"
    cfg["edit"]["mode"] = "double"
    cfg["edit"]["confirm_key"] = "h"
    cfg["edit"]["edit_key"] = "f"
    assert cycle_edit_key(cfg) == "mouse_x2"
    assert cfg["edit"]["confirm_key"] == "h"
    assert cycle_profile(default_config()) == "Mus"
    mus = default_config()
    cycle_profile(mus)
    assert mus["edit"]["edit_key"] == "mouse_x2"
    assert upsert_profile(cfg, "  Nat  ")
    assert cfg["active_profile"] == "Nat"
    delete_profile(cfg, "Nat")
    assert cfg["active_profile"] == ""
    apply_preset(cfg, "instant")
    assert cfg["step_ms"] == 1
    assert cfg["jitter_ms"] == 0
    recommend(cfg)
    assert cfg["edit"]["mode"] == "release"
    assert cfg["edit"]["instant_reset_hotkey"] == "mouse_x1"


def test_duplicate_hotkeys_keep_the_first_action():
    cfg = default_config()
    cfg["edit"]["fast_confirm_hotkey"] = "mouse_x1"
    _master, actions, dupes = resolve(cfg)
    assert actions["mouse_x1"] == "instant_reset"
    assert "Mus side 1" in duplicate_text(dupes)
    cfg["master_toggle"] = "mouse_x1"
    _master, actions, dupes = resolve(cfg)
    assert "mouse_x1" not in actions
    assert dupes


def test_instant_reset_sends_edit_reset_release(engine):
    engine._dispatch(engine.cfg["edit"]["instant_reset_hotkey"], True)
    assert engine.sender.events == [("down", "f"), ("down", "g"), ("up", "g"), ("up", "f")]


def test_key_repeat_does_not_fire_twice(engine):
    engine._dispatch("mouse_x1", True)
    count = len(engine.sender.events)
    engine._dispatch("mouse_x1", True)
    assert len(engine.sender.events) == count
    engine._dispatch("mouse_x1", False)
    engine._dispatch("mouse_x1", True)
    assert len(engine.sender.events) > count


def test_scroll_while_editing_only_resets(engine):
    engine._dispatch("f", True)
    engine.sender.events.clear()
    engine._dispatch("scroll_up", True)
    engine._dispatch("scroll_up", True)
    assert engine.sender.events == [("down", "g"), ("up", "g"), ("down", "g"), ("up", "g")]


def test_same_key_and_double_modes(engine):
    engine.cfg["edit"]["mode"] = "same_key"
    engine._dispatch("mouse_x1", True, False)
    assert [event[0] for event in engine.sender.events] == ["down", "up", "down", "up", "down", "up"]
    engine.sender.events.clear()
    engine.physically_held.discard("mouse_x1")
    engine.cfg["edit"]["mode"] = "double"
    engine.cfg["edit"]["confirm_key"] = "h"
    engine._dispatch("mouse_x1", True)
    assert engine.sender.events[-2:] == [("down", "h"), ("up", "h")]


def test_toggle_releases_a_held_edit(engine):
    engine._dispatch("f", True)
    assert ("down", "f") in engine.sender.events
    engine._dispatch("f8", True)
    assert engine.enabled is False
    assert ("up", "f") in engine.sender.events
    engine.sender.events.clear()
    engine._dispatch("mouse_x1", True)
    assert engine.sender.events == []


def test_ignores_other_windows_on_windows(engine):
    engine.cfg["only_fortnite"] = True
    engine.title_provider = lambda: "Discord"
    engine._focus_checked = 0
    engine._dispatch("mouse_x1", True)
    assert engine.sender.events == []
    engine._dispatch("f8", True)
    assert engine.enabled is False


def test_swallow_rules(engine):
    assert engine.should_swallow("f") is True
    assert engine.should_swallow("f8") is False
    engine.enabled = False
    assert engine.should_swallow("f") is False
    engine.enabled = True
    engine.platform = "win32"
    engine.cfg["only_fortnite"] = True
    engine.title_provider = lambda: "Discord"
    engine._focus_checked = 0
    assert engine.should_swallow("mouse_x1") is False
    engine.title_provider = lambda: "Fortnite"
    engine._focus_checked = 0
    assert engine.should_swallow("mouse_x1") is True
    engine.begin_capture(lambda _name: None)
    engine.title_provider = lambda: "Discord"
    engine._focus_checked = 0
    assert engine.should_swallow("a") is True


def test_capture_cancel_and_clear(engine):
    got = []
    engine.begin_capture(got.append)
    engine._dispatch("k", True)
    engine.begin_capture(got.append)
    engine._dispatch("esc", True)
    engine.begin_capture(got.append)
    engine._dispatch("delete", True)
    assert got == ["k", None, ""]


def test_cycles_build_and_slots(engine):
    engine._dispatch("f7", True)
    assert engine.cfg["active_profile"] == "Mus"
    assert engine.cfg["edit"]["edit_key"] == "mouse_x2"
    engine.cfg["active_profile"] = "Keyboard"
    engine.cfg["edit"]["edit_key"] = "f"
    engine.cfg["edit"]["confirm_key"] = "f"
    engine.physically_held.discard("f7")
    engine._dispatch("f6", True)
    assert engine.cfg["edit"]["edit_key"] == "mouse_x2"
    engine.cfg["build"]["pieces"]["wall"]["hotkey"] = "z"
    engine.cfg["build"]["pieces"]["wall"]["replace_hotkey"] = "y"
    engine._dispatch("z", True)
    assert ("down", "q") in engine.sender.events
    assert ("down", "mouse_left") not in engine.sender.events
    engine.sender.events.clear()
    engine._dispatch("y", True)
    assert ("down", "q") in engine.sender.events
    assert ("down", "mouse_left") in engine.sender.events
    engine.sender.events.clear()
    engine._dispatch("mouse_middle", True)
    assert engine.sender.events[0] == ("down", "q")


def test_turbo_and_pickup_respect_interval(engine):
    engine.cfg["edit"]["turbo_hotkey"] = "b"
    engine._dispatch("b", True)
    count = len(engine.sender.events)
    assert count > 0
    engine._service_holds()
    assert len(engine.sender.events) == count
    engine.cfg["extras"]["pickup_hotkey"] = "n"
    engine._dispatch("n", True)
    assert ("down", "e") in engine.sender.events


def test_linux_echo_is_consumed_once(engine):
    engine.trust_injected = False
    engine._dispatch("mouse_x1", True)
    count = len(engine.sender.events)
    engine._dispatch("f", True)
    assert len(engine.sender.events) == count


def test_ui_module_imports():
    import app.ui

    assert app.ui.MODE_HELP["release"]
