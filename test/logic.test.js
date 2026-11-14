import assert from "node:assert/strict";
import test from "node:test";
import { updateCombat, createCombatMemory } from "../src/combat.js";
import { project, pickTarget, stepTrigger } from "../src/math.js";
import { createCamera, createWorld, refreshVisibility } from "../src/sim.js";
import { createState, setEspEnabled, toggleMenu } from "../src/state.js";

test("launch defaults show the menu and ESP together", () => {
  const state = createState();
  assert.equal(state.menuOpen, true);
  assert.equal(state.esp.enabled, true);
});

test("Insert toggles only the menu and ignores key repeat", () => {
  const state = createState();
  state.esp.enabled = false;
  state.esp.colors.box = "#112233";
  state.aimbot.smoothness = 12;

  assert.equal(toggleMenu(state, false), true);
  assert.equal(state.menuOpen, false);
  assert.equal(state.esp.enabled, false);
  assert.equal(state.esp.colors.box, "#112233");
  assert.equal(state.aimbot.smoothness, 12);

  assert.equal(toggleMenu(state, true), false);
  assert.equal(state.menuOpen, false);

  assert.equal(toggleMenu(state, false), true);
  assert.equal(state.menuOpen, true);
  assert.equal(state.esp.colors.box, "#112233");
});

test("ESP toggles without changing menu visibility", () => {
  const state = createState();
  toggleMenu(state, false);
  setEspEnabled(state, false);
  assert.equal(state.menuOpen, false);
  assert.equal(state.esp.enabled, false);
  setEspEnabled(state, true);
  assert.equal(state.menuOpen, false);
  assert.equal(state.esp.enabled, true);
});

test("projection puts a forward point on center and drops points behind the camera", () => {
  const camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 90 };
  const ahead = project({ x: 0, y: 0, z: 10 }, camera, 200, 100);
  assert.ok(ahead);
  assert.ok(Math.abs(ahead.x - 100) < 0.001);
  assert.ok(Math.abs(ahead.y - 50) < 0.001);
  assert.equal(project({ x: 0, y: 0, z: -4 }, camera, 200, 100), null);
});

test("target priority and sticky lock choose different dummies", () => {
  const candidates = [
    { id: "a", distPx: 10, distanceM: 40, health: 90 },
    { id: "b", distPx: 30, distanceM: 5, health: 20 },
  ];
  assert.equal(pickTarget(candidates, { priority: "crosshair" }).id, "a");
  assert.equal(pickTarget(candidates, { priority: "distance" }).id, "b");
  assert.equal(pickTarget(candidates, { priority: "health" }).id, "b");
  assert.equal(pickTarget(candidates, { priority: "distance", stickyId: "a" }).id, "a");
  assert.equal(pickTarget(candidates, { priority: "distance", stickyId: "missing" }).id, "b");
});

test("trigger reaction delay waits, then repeats, and rearms when the target is lost", () => {
  let memory = { armedAt: null, lastShot: -1e9 };
  let step = stepTrigger(memory, { active: true, onTarget: true, now: 0, delay: 100 });
  assert.equal(step.fired, false);
  memory = step.state;
  step = stepTrigger(memory, { active: true, onTarget: true, now: 99, delay: 100 });
  assert.equal(step.fired, false);
  memory = step.state;
  step = stepTrigger(memory, { active: true, onTarget: true, now: 100, delay: 100 });
  assert.equal(step.fired, true);
  memory = step.state;
  step = stepTrigger(memory, { active: true, onTarget: true, now: 150, delay: 100 });
  assert.equal(step.fired, false);
  memory = step.state;
  step = stepTrigger(memory, { active: true, onTarget: true, now: 200, delay: 100 });
  assert.equal(step.fired, true);
  memory = stepTrigger(step.state, { active: true, onTarget: false, now: 250, delay: 100 }).state;
  assert.equal(memory.armedAt, null);
  step = stepTrigger(memory, { active: false, onTarget: true, now: 400, delay: 100 });
  assert.equal(step.fired, false);
});

test("default range has both visible and occluded enemies", () => {
  const world = createWorld(10);
  refreshVisibility(world.players, createCamera());
  const enemies = world.players.filter((player) => player.team === "enemy");
  assert.ok(enemies.some((player) => player.visible));
  assert.ok(enemies.some((player) => !player.visible));
});

test("aimbot hold turns the simulation camera toward a dummy and leaves the menu alone", () => {
  const state = createState();
  state.menuOpen = false;
  state.esp.enabled = true;
  state.assist.enabled = false;
  state.aimbot.enabled = true;
  state.aimbot.fov = 50;
  state.aimbot.smoothness = 0;
  state.aimbot.bone = "chest";
  const camera = { x: 0, y: 1.5, z: -8, yaw: 0.35, pitch: 0 };
  const players = [{
    id: 1,
    name: "Kite",
    team: "enemy",
    x: 0,
    y: 0,
    z: 4,
    yaw: 0,
    health: 80,
    alive: true,
    visible: true,
    moving: false,
    phase: 0,
  }];
  const before = camera.yaw;
  updateCombat({
    players,
    camera,
    state,
    width: 1280,
    height: 720,
    held: new Set(["KeyQ"]),
    now: 1000,
    dt: 0.05,
    memory: createCombatMemory(),
    manualFire: false,
  });
  assert.ok(camera.yaw < before);
  assert.equal(state.menuOpen, false);
  assert.equal(state.esp.enabled, true);
});
