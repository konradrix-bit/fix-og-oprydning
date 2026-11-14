export function createState() {
  return {
    menuOpen: true,
    tab: "esp",
    esp: {
      enabled: true,
      box2d: true,
      box3d: true,
      skeleton: true,
      names: true,
      distance: true,
      health: true,
      visibility: true,
      teammates: false,
      colorByVisibility: true,
      maxDistance: 80,
      thickness: 1.6,
      opacity: 92,
      colors: {
        box: "#6aa6ff",
        skeleton: "#c084fc",
        name: "#f4f7ff",
        visible: "#3ee0a2",
        occluded: "#ffb020",
        friendly: "#49e0c2",
      },
    },
    assist: {
      enabled: false,
      strength: 35,
      fov: 32,
      smoothness: 48,
      priority: "crosshair",
      bone: "chest",
      visibleOnly: true,
      teammates: false,
      drawFov: true,
    },
    aimbot: {
      enabled: false,
      fov: 20,
      smoothness: 24,
      bone: "head",
      priority: "crosshair",
      hotkey: "KeyQ",
      sticky: true,
      drawLine: true,
      visibleOnly: true,
      teammates: false,
    },
    trigger: {
      enabled: false,
      delay: 120,
      hotkey: "KeyT",
      scale: 1,
      visibleOnly: true,
      teammates: false,
    },
    crosshair: {
      enabled: true,
      style: "cross",
      color: "#e7f2ff",
      size: 8,
      gap: 4,
      thickness: 1.6,
      outline: true,
    },
    recoil: {
      enabled: true,
      strength: 45,
      showPattern: true,
    },
    hud: {
      fps: true,
      perf: true,
      playerInfo: true,
      hint: true,
    },
    camera: {
      fov: 75,
    },
    sim: {
      playerCount: 10,
      speed: 1,
    },
  };
}

/** Insert toggles the menu only. A held key's repeat events are ignored. */
export function toggleMenu(state, repeat = false) {
  if (repeat) return false;
  state.menuOpen = !state.menuOpen;
  return true;
}

/** ESP is its own switch. Opening or closing the menu never calls this. */
export function setEspEnabled(state, enabled) {
  state.esp.enabled = Boolean(enabled);
}

export function getPath(obj, path) {
  return path.split(".").reduce((current, key) => current[key], obj);
}

export function setPath(obj, path, value) {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i += 1) current = current[keys[i]];
  current[keys[keys.length - 1]] = value;
}

export function cloneState(state) {
  return structuredClone(state);
}
