import { BONES } from "./bones.js";
import { boneWorld, lerpAngle, segmentHitsAabb } from "./math.js";

export const NAMES = [
  "Vesper", "Kite", "Nox", "Bramble", "Io", "Sable", "Quill", "Harbor",
  "Moth", "Juno", "Pike", "Aster", "Cinder", "Wisp", "Orla", "Fenn",
  "Nova", "Rook", "Indigo", "Pebble", "Marlow", "Tess", "Quinn", "Heath",
];

/** Axis-aligned cover. Coordinates are meters. */
export const OBSTACLES = [
  { min: [-6.2, 0, 1.2], max: [-3.4, 1.7, 3.8] },
  { min: [3.2, 0, 0.8], max: [6.1, 2.15, 3.6] },
  { min: [-1.5, 0, 6.4], max: [1.5, 1.25, 8.5] },
  { min: [-1.15, 0, 11.2], max: [1.15, 3.3, 12.15] },
  { min: [-10.2, 0, 9.4], max: [-7.4, 2.4, 12.2] },
  { min: [7.2, 0, 10.2], max: [10.4, 1.6, 13.4] },
  { min: [-13.4, 0, -1.2], max: [-10.6, 1.45, 1.8] },
];

const SPAWNS = [
  [-8.4, 0, 2.2, 0.25],
  [8.2, 0, 1.8, -0.25],
  [-4.6, 0, 6.6, 0.4],
  [4.4, 0, 6.9, -0.35],
  [0, 0, 15.8, 0.02],
  [4.9, 0, 15.1, -0.12],
  [-11.6, 0, 7.6, 0.55],
  [12.2, 0, 7.4, -0.55],
  [-3.1, 0, 10.4, 0.2],
  [2.6, 0, 9.6, 3.0],
];

export const WAYPOINTS = [
  [-14, -8], [0, -8], [14, -6], [-14, 5], [-8, 17], [0, 18],
  [9, 17], [15, 6], [-5, 5], [6, 4.6], [11, -2], [-11, -1],
  [-13, 14], [13, 14], [0, 2.2],
];

export function createCamera() {
  return { x: 0, y: 3.35, z: -16, yaw: 0, pitch: -0.2 };
}

function footprintBlocks(x, z, padding = 0.45) {
  return OBSTACLES.some((box) => (
    x > box.min[0] - padding &&
    x < box.max[0] + padding &&
    z > box.min[2] - padding &&
    z < box.max[2] + padding
  ));
}

function makePlayer(index, count) {
  let x;
  let z;
  let yaw;
  if (index < SPAWNS.length) {
    [x, , z, yaw] = SPAWNS[index];
  } else {
    const angle = (index / count) * Math.PI * 2;
    x = Math.cos(angle) * 16;
    z = Math.sin(angle) * 16;
    yaw = angle + Math.PI;
    if (footprintBlocks(x, z)) {
      x = Math.cos(angle) * 18;
      z = Math.sin(angle) * 18;
    }
  }
  return {
    id: index,
    name: NAMES[index % NAMES.length],
    team: index === 6 || index === 7 ? "friendly" : "enemy",
    x,
    y: 0,
    z,
    yaw,
    health: 70 + ((index * 17) % 31),
    alive: true,
    respawn: 0,
    goalX: x,
    goalZ: z,
    wait: 1.4 + index * 0.18,
    phase: index * 0.7,
    moving: false,
    visible: true,
    sprint: index % 4 === 0,
  };
}

export function createWorld(count) {
  const size = Math.max(4, Math.min(24, count | 0));
  return {
    players: Array.from({ length: size }, (_, index) => makePlayer(index, size)),
    time: 0,
  };
}

function chooseGoal(player) {
  let best = WAYPOINTS[0];
  let bestDist = -1;
  const start = (player.id * 3) % WAYPOINTS.length;
  for (let step = 0; step < WAYPOINTS.length; step += 1) {
    const point = WAYPOINTS[(start + step) % WAYPOINTS.length];
    const dist = Math.hypot(point[0] - player.x, point[1] - player.z);
    if (dist > 4 && dist > bestDist && !footprintBlocks(point[0], point[1], 0.2)) {
      best = point;
      bestDist = dist;
      if (dist > 6 && step > 2) break;
    }
  }
  player.goalX = best[0];
  player.goalZ = best[1];
  player.sprint = (player.id + Math.floor(player.phase * 10)) % 3 === 0;
}

export function stepWorld(world, dt) {
  world.time += dt;
  for (const player of world.players) {
    if (!player.alive) {
      player.moving = false;
      player.respawn -= dt;
      if (player.respawn <= 0) {
        const spot = SPAWNS[player.id % SPAWNS.length];
        player.x = spot[0];
        player.z = spot[2];
        player.yaw = spot[3];
        player.health = 100;
        player.alive = true;
        player.wait = 0.8;
        chooseGoal(player);
      }
      continue;
    }
    if (player.wait > 0) {
      player.wait -= dt;
      player.moving = false;
      continue;
    }
    const dx = player.goalX - player.x;
    const dz = player.goalZ - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) {
      player.moving = false;
      player.wait = 0.7 + ((player.id % 5) * 0.25);
      chooseGoal(player);
      continue;
    }
    const speed = (player.sprint ? 4.3 : 2.15) * dt;
    const step = Math.min(dist, speed);
    let nx = player.x + (dx / dist) * step;
    let nz = player.z + (dz / dist) * step;
    if (footprintBlocks(nx, nz)) {
      if (!footprintBlocks(nx, player.z)) nz = player.z;
      else if (!footprintBlocks(player.x, nz)) nx = player.x;
      else {
        player.moving = false;
        chooseGoal(player);
        continue;
      }
    }
    player.x = Math.max(-20, Math.min(20, nx));
    player.z = Math.max(-18, Math.min(22, nz));
    player.yaw = lerpAngle(player.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 6));
    player.moving = true;
  }
}

export function refreshVisibility(players, eye) {
  for (const player of players) {
    if (!player.alive) {
      player.visible = false;
      continue;
    }
    const head = boneWorld(player, BONES.head);
    player.visible = !OBSTACLES.some((box) => segmentHitsAabb(eye, head, box));
  }
}

export function damagePlayer(player, amount) {
  if (!player.alive) return false;
  player.health = Math.max(0, player.health - amount);
  if (player.health <= 0) {
    player.alive = false;
    player.respawn = 2.6;
    player.moving = false;
  }
  return true;
}
