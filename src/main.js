import { updateCombat, createCombatMemory, decayRecoilIndex } from "./combat.js";
import { isTypingTarget } from "./keys.js";
import { drawOverlay, drawWorld } from "./render.js";
import { createCamera, createWorld, damagePlayer, refreshVisibility, stepWorld } from "./sim.js";
import { createState, setEspEnabled, toggleMenu } from "./state.js";
import { createUi } from "./ui.js";
import { clamp, distanceMeters } from "./math.js";

const worldCanvas = document.querySelector("#world");
const overlayCanvas = document.querySelector("#overlay");
const worldCtx = worldCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

const state = createState();
let world = createWorld(state.sim.playerCount);
let camera = createCamera();
const memory = createCombatMemory();
const held = new Set();
const floaters = [];

let insertDown = false;
let spraying = false;
let looking = false;
let lastShotAt = -1e9;
let hitFlash = 0;
let lastFrame = performance.now();
let fps = 60;
let frameMs = 0;

const ui = createUi(state, {
  onChange(path) {
    if (path === "sim.playerCount") rebuildPopulation();
  },
  onReset() {
    const menuOpen = state.menuOpen;
    const tab = state.tab;
    const fresh = createState();
    fresh.menuOpen = menuOpen;
    fresh.tab = tab;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, fresh);
    memory.stickyId = null;
    rebuildPopulation();
  },
});

function rebuildPopulation() {
  world = createWorld(state.sim.playerCount);
  memory.stickyId = null;
}

function prepare(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const bufferW = Math.floor(width * dpr);
  const bufferH = Math.floor(height * dpr);
  if (canvas.width !== bufferW || canvas.height !== bufferH) {
    canvas.width = bufferW;
    canvas.height = bufferH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function lookUsesRightMouse() {
  const aimOwns = state.aimbot.enabled && state.aimbot.hotkey === "Mouse2";
  const triggerOwns = state.trigger.enabled && state.trigger.hotkey === "Mouse2";
  return !aimOwns && !triggerOwns;
}

function cardFor(combat) {
  const picked = combat.aimTarget || combat.assistTarget;
  if (picked) {
    const player = world.players.find((entry) => entry.id === picked.id);
    return {
      name: picked.name,
      health: picked.health,
      distance: picked.distanceM,
      visible: player ? player.visible : picked.visible,
      team: picked.team === "friendly" ? "Friendly" : "Enemy",
      bone: combat.aimTarget ? state.aimbot.bone : state.assist.bone,
    };
  }
  if (combat.triggerTarget) {
    const player = combat.triggerTarget;
    return {
      name: player.name,
      health: player.health,
      distance: distanceMeters(camera, { x: player.x, y: player.y + 1.1, z: player.z }),
      visible: player.visible,
      team: player.team === "friendly" ? "Friendly" : "Enemy",
      bone: "body",
    };
  }
  let nearest = null;
  let nearestDist = Infinity;
  for (const player of world.players) {
    if (!player.alive || (player.team === "friendly" && !state.esp.teammates)) continue;
    const dist = Math.hypot(player.x - camera.x, player.z - camera.z);
    if (dist < nearestDist) {
      nearest = player;
      nearestDist = dist;
    }
  }
  if (!nearest) return null;
  return {
    name: nearest.name,
    health: nearest.health,
    distance: distanceMeters(camera, { x: nearest.x, y: nearest.y + 1.1, z: nearest.z }),
    visible: nearest.visible,
    team: nearest.team === "friendly" ? "Friendly" : "Enemy",
    bone: "—",
  };
}

function moveCamera(dt) {
  if (state.menuOpen || isTypingTarget(document.activeElement)) return;
  let forward = 0;
  let strafe = 0;
  if (held.has("KeyW")) forward += 1;
  if (held.has("KeyS")) forward -= 1;
  if (held.has("KeyD")) strafe += 1;
  if (held.has("KeyA")) strafe -= 1;
  if (!forward && !strafe) return;
  const length = Math.hypot(forward, strafe) || 1;
  const speed = (7.2 * dt) / length;
  const sin = Math.sin(camera.yaw);
  const cos = Math.cos(camera.yaw);
  camera.x = clamp(camera.x + (sin * forward + cos * strafe) * speed, -20, 20);
  camera.z = clamp(camera.z + (cos * forward - sin * strafe) * speed, -18, 22);
}

function frame(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
  lastFrame = now;
  const instant = dt > 0 ? 1 / dt : 60;
  fps += (instant - fps) * 0.08;
  frameMs += (dt * 1000 - frameMs) * 0.08;

  stepWorld(world, dt * state.sim.speed);
  moveCamera(dt);
  refreshVisibility(world.players, camera);

  let manualFire = false;
  if (spraying && !state.menuOpen && now - memory.lastManual > 90) {
    memory.lastManual = now;
    manualFire = true;
  }

  const size = prepare(worldCanvas, worldCtx);
  prepare(overlayCanvas, overlayCtx);
  const combat = updateCombat({
    players: world.players,
    camera,
    state,
    width: size.width,
    height: size.height,
    held,
    now,
    dt,
    memory,
    manualFire,
  });

  if (combat.fired && combat.victimId != null) {
    const player = world.players.find((entry) => entry.id === combat.victimId);
    const amount = combat.triggerHeld ? 16 : 12;
    if (player && damagePlayer(player, amount)) {
      floaters.push({
        x: player.x,
        y: player.y + 1.9,
        z: player.z,
        text: `-${amount}`,
        age: 0,
        life: 0.7,
      });
    }
    hitFlash = 1;
    lastShotAt = now;
  }

  for (const floater of floaters) floater.age += dt;
  for (let i = floaters.length - 1; i >= 0; i -= 1) {
    if (floaters[i].age >= floaters[i].life) floaters.splice(i, 1);
  }
  hitFlash = Math.max(0, hitFlash - dt * 5);
  decayRecoilIndex(memory, now, lastShotAt);

  drawWorld(worldCtx, {
    width: size.width,
    height: size.height,
    camera: combat.view,
    players: world.players,
    time: world.time,
  });
  drawOverlay(overlayCtx, {
    width: size.width,
    height: size.height,
    camera: combat.view,
    players: world.players,
    esp: state.esp,
    assist: state.assist,
    aimbot: state.aimbot,
    crosshair: state.crosshair,
    recoil: state.recoil,
    trigger: state.trigger,
    combat,
    floaters,
    patternIndex: memory.recoilIndex,
    hitFlash,
    time: world.time,
  });

  const visible = world.players.filter((player) => player.alive && player.visible && player.team === "enemy").length;
  ui.setStatus({
    fps: Math.round(fps),
    frameMs,
    entities: world.players.length,
    visible,
    assist: combat.assistTarget,
    aim: combat.aimTarget,
    aimHeld: combat.aimHeld,
    trigger: combat.triggerTarget,
    card: cardFor(combat),
  });

  requestAnimationFrame(frame);
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Insert" || event.key === "Insert") {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || insertDown) return;
    insertDown = true;
    ui.cancelListen();
    toggleMenu(state, false);
    ui.syncMenu();
    return;
  }
  if (ui.isListening()) {
    event.preventDefault();
    if (!event.repeat) ui.captureBind(event.code);
    return;
  }
  if (event.code === "F2" && !event.repeat && !isTypingTarget(event.target)) {
    event.preventDefault();
    setEspEnabled(state, !state.esp.enabled);
    ui.syncAll();
    return;
  }
  if (!event.repeat && !isTypingTarget(event.target)) held.add(event.code);
}, true);

window.addEventListener("keyup", (event) => {
  held.delete(event.code);
  if (event.code === "Insert" || event.key === "Insert") insertDown = false;
}, true);

window.addEventListener("mousedown", (event) => {
  const code = `Mouse${event.button + 1}`;
  if (ui.isListening()) {
    event.preventDefault();
    event.stopPropagation();
    ui.captureBind(code);
    return;
  }
  held.add(code);
}, true);

window.addEventListener("mouseup", (event) => {
  held.delete(`Mouse${event.button + 1}`);
  if (event.button === 0) spraying = false;
  if (event.button === 2) looking = false;
}, true);

window.addEventListener("blur", () => {
  held.clear();
  spraying = false;
  looking = false;
  insertDown = false;
});

window.addEventListener("contextmenu", (event) => event.preventDefault());

worldCanvas.addEventListener("mousedown", (event) => {
  if (state.menuOpen || ui.isListening()) return;
  if (event.button === 0) spraying = true;
  if (event.button === 2 && lookUsesRightMouse()) looking = true;
});

window.addEventListener("mousemove", (event) => {
  if (!looking || state.menuOpen) return;
  camera.yaw += event.movementX * 0.00215;
  camera.pitch = clamp(camera.pitch - event.movementY * 0.00215, -1.15, 1.15);
});

document.querySelector("#menu-toggle").addEventListener("click", () => {
  toggleMenu(state, false);
  ui.syncMenu();
});

window.__range = {
  get state() {
    return state;
  },
  get camera() {
    return camera;
  },
  get players() {
    return world.players;
  },
  toggleMenu(repeat = false) {
    const changed = toggleMenu(state, repeat);
    if (changed) ui.syncMenu();
    return state.menuOpen;
  },
  setEsp(enabled) {
    setEspEnabled(state, enabled);
    ui.syncAll();
    return state.esp.enabled;
  },
};

requestAnimationFrame(frame);
