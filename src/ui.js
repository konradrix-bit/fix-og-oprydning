import { formatBind, RESERVED_BINDS } from "./keys.js";
import { getPath, setPath } from "./state.js";

function formatValue(path, value) {
  if (path === "camera.fov" || path.endsWith(".fov")) return `${Math.round(value)}°`;
  if (path === "trigger.delay") return `${Math.round(value)} ms`;
  if (path === "sim.speed" || path === "trigger.scale") return `${Number(value).toFixed(2)}×`;
  if (path === "esp.opacity") return `${Math.round(value)}%`;
  if (path === "esp.thickness" || path === "crosshair.thickness") return Number(value).toFixed(1);
  return `${Math.round(value)}`;
}

function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const span = max - min || 1;
  input.style.setProperty("--fill", `${((value - min) / span) * 100}%`);
}

export function createUi(state, { onChange, onReset }) {
  const menu = document.querySelector("#menu");
  const panels = [...document.querySelectorAll("[data-panel]")];
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const fields = [...document.querySelectorAll("[data-path]")];
  const keyButtons = [...document.querySelectorAll("[data-key]")];
  let listening = null;

  function applyTab() {
    for (const tab of tabs) {
      const active = tab.dataset.tab === state.tab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const panel of panels) {
      panel.classList.toggle("is-on", panel.dataset.panel === state.tab);
    }
  }

  function syncMenu() {
    const open = state.menuOpen;
    menu.classList.toggle("is-closed", !open);
    menu.inert = !open;
    menu.setAttribute("aria-hidden", String(!open));
    document.documentElement.dataset.menu = open ? "open" : "closed";
    if (!open && menu.contains(document.activeElement)) document.activeElement.blur();
  }

  function writeControl(el) {
    const value = getPath(state, el.dataset.path);
    if (el.type === "checkbox") el.checked = Boolean(value);
    else el.value = value;
    if (el.type === "range") {
      paintRange(el);
      const label = document.querySelector(`[data-for="${el.dataset.path}"]`);
      if (label) label.textContent = formatValue(el.dataset.path, value);
    }
  }

  function syncAll() {
    for (const el of fields) writeControl(el);
    for (const button of keyButtons) {
      button.textContent = formatBind(getPath(state, button.dataset.key));
      button.classList.remove("is-listening");
    }
    applyTab();
    syncMenu();
    updateBindNote();
    document.documentElement.dataset.esp = state.esp.enabled ? "on" : "off";
  }

  function updateBindNote() {
    const note = document.querySelector("#bind-note");
    if (!note) return;
    note.textContent = state.aimbot.hotkey === state.trigger.hotkey
      ? "Aimbot and triggerbot are using the same key."
      : "Insert toggles this menu. F2 toggles ESP.";
  }

  function stopListening() {
    listening = null;
    for (const button of keyButtons) button.classList.remove("is-listening");
    syncAll();
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      applyTab();
    });
  }

  for (const el of fields) {
    const event = el.type === "range" ? "input" : "change";
    el.addEventListener(event, () => {
      const value = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
      setPath(state, el.dataset.path, value);
      if (el.type === "range") {
        paintRange(el);
        const label = document.querySelector(`[data-for="${el.dataset.path}"]`);
        if (label) label.textContent = formatValue(el.dataset.path, value);
      }
      document.documentElement.dataset.esp = state.esp.enabled ? "on" : "off";
      onChange?.(el.dataset.path);
    });
  }

  for (const button of keyButtons) {
    button.addEventListener("click", () => {
      listening = button.dataset.key;
      for (const other of keyButtons) {
        other.classList.toggle("is-listening", other === button);
        if (other === button) other.textContent = "PRESS";
      }
    });
  }

  document.querySelector("#reset").addEventListener("click", () => {
    onReset();
    syncAll();
  });

  document.querySelector("#menu-close").addEventListener("click", () => {
    state.menuOpen = false;
    syncMenu();
  });

  function setStatus(status) {
    const fps = document.querySelector("#fps");
    const frame = document.querySelector("#frame-ms");
    const entities = document.querySelector("#entity-count");
    const visible = document.querySelector("#visible-count");
    const chip = document.querySelector("#esp-chip");
    fps.textContent = String(status.fps);
    frame.textContent = `${status.frameMs.toFixed(1)} ms`;
    entities.textContent = `${status.entities} players`;
    visible.textContent = `${status.visible} in sight`;
    chip.textContent = state.esp.enabled ? "ESP ON" : "ESP OFF";
    chip.classList.toggle("is-off", !state.esp.enabled);
    document.querySelector("#perf").hidden = !state.hud.fps && !state.hud.perf;
    document.querySelector("#fps-wrap").hidden = !state.hud.fps;
    document.querySelector("#perf-detail").hidden = !state.hud.perf;
    document.querySelector("#player-card").hidden = !state.hud.playerInfo;
    document.querySelector("#menu-toggle").hidden = !state.hud.hint;

    const cardName = document.querySelector("#pcard-name");
    const card = status.card;
    cardName.textContent = card ? card.name : "No target";
    document.querySelector("#pcard-hp").textContent = card ? `${Math.round(card.health)}` : "—";
    document.querySelector("#pcard-dist").textContent = card ? `${card.distance.toFixed(0)}m` : "—";
    document.querySelector("#pcard-vis").textContent = card ? (card.visible ? "Visible" : "Occluded") : "—";
    document.querySelector("#pcard-bone").textContent = card ? card.bone : "—";
    document.querySelector("#pcard-team").textContent = card ? card.team : "—";

    const assist = document.querySelector("#assist-readout");
    const aim = document.querySelector("#aim-readout");
    const trigger = document.querySelector("#trigger-readout");
    assist.textContent = status.assist
      ? `${status.assist.name} · ${status.assist.distanceM.toFixed(0)}m · ${Math.round(status.assist.distPx)}px`
      : "No target inside the assist FOV";
    aim.textContent = status.aim
      ? `${status.aimHeld ? "Tracking" : "Selected"} ${status.aim.name} · ${state.aimbot.bone}`
      : "No target inside the aimbot FOV";
    trigger.textContent = status.trigger
      ? `${status.triggerHeld ? "On target" : "In the crosshair"} · ${status.trigger.name} · ${state.trigger.delay} ms`
      : "Crosshair is clear";
    document.documentElement.dataset.esp = state.esp.enabled ? "on" : "off";
  }

  syncAll();

  return {
    syncMenu,
    syncAll,
    setStatus,
    isListening: () => listening !== null,
    captureBind(code) {
      if (!listening) return false;
      if (RESERVED_BINDS.has(code)) {
        stopListening();
        return true;
      }
      setPath(state, listening, code);
      stopListening();
      return true;
    },
    cancelListen() {
      if (!listening) return;
      stopListening();
    },
  };
}
