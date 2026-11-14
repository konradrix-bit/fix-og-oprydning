import { BONES } from "./bones.js";
import {
  RECOIL_PATTERN,
  applyAim,
  boneWorld,
  distanceMeters,
  fovRadiusPx,
  pickTarget,
  project,
  smoothAlpha,
  stepTrigger,
} from "./math.js";

function eligible(player, { teammates, visibleOnly }) {
  if (!player.alive) return false;
  if (player.team === "friendly" && !teammates) return false;
  if (visibleOnly && !player.visible) return false;
  return true;
}

export function collectCandidates(players, camera, width, height, options) {
  const radius = fovRadiusPx(options.fov, camera.fov, height);
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const bone = BONES[options.bone] || BONES.head;
  const list = [];
  for (const player of players) {
    if (!eligible(player, options)) continue;
    const world = boneWorld(player, bone);
    const projected = project(world, camera, width, height);
    if (!projected) continue;
    const distPx = Math.hypot(projected.x - centerX, projected.y - centerY);
    if (distPx > radius) continue;
    list.push({
      id: player.id,
      distPx,
      distanceM: distanceMeters(camera, { x: player.x, y: player.y + 1.2, z: player.z }),
      health: player.health,
      team: player.team,
      name: player.name,
      visible: player.visible,
      proj: projected,
      world,
    });
  }
  return list;
}

export function bodyContainsCrosshair(player, camera, width, height, scale = 1) {
  if (!player.alive) return false;
  const hx = 0.34 * scale;
  const hz = 0.26 * scale;
  const hy = 1.86;
  const samples = [
    [-hx, 0.2, -hz], [hx, 0.2, hz], [-hx, hy, hz], [hx, hy, -hz],
    [0, 1.7, 0], [0, 1.0, 0],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = 0;
  for (const sample of samples) {
    const projected = project(boneWorld(player, sample), camera, width, height);
    if (!projected) continue;
    seen += 1;
    minX = Math.min(minX, projected.x);
    minY = Math.min(minY, projected.y);
    maxX = Math.max(maxX, projected.x);
    maxY = Math.max(maxY, projected.y);
  }
  if (!seen) return false;
  const pad = 6 * scale;
  const x = width * 0.5;
  const y = height * 0.5;
  return x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad;
}

export function createCombatMemory() {
  return {
    stickyId: null,
    trigger: { armedAt: null, lastShot: -1e9 },
    recoilIndex: 0,
    kickPitch: 0,
    kickYaw: 0,
    lastManual: -1e9,
  };
}

/**
 * Aim and trigger decisions stay inside the simulation camera.
 * Nothing here moves the operating-system cursor.
 */
export function updateCombat({
  players,
  camera,
  state,
  width,
  height,
  held,
  now,
  dt,
  memory,
  manualFire,
}) {
  const view = {
    x: camera.x,
    y: camera.y,
    z: camera.z,
    yaw: camera.yaw + memory.kickYaw,
    pitch: camera.pitch + memory.kickPitch,
    fov: state.camera.fov,
  };

  const assistCandidates = state.assist.enabled
    ? collectCandidates(players, view, width, height, {
      fov: state.assist.fov,
      bone: state.assist.bone,
      visibleOnly: state.assist.visibleOnly,
      teammates: state.assist.teammates,
    })
    : [];
  const assistTarget = pickTarget(assistCandidates, { priority: state.assist.priority });

  const aimCandidates = state.aimbot.enabled
    ? collectCandidates(players, view, width, height, {
      fov: state.aimbot.fov,
      bone: state.aimbot.bone,
      visibleOnly: state.aimbot.visibleOnly,
      teammates: state.aimbot.teammates,
    })
    : [];
  const aimHeld = state.aimbot.enabled && held.has(state.aimbot.hotkey);
  const aimTarget = pickTarget(aimCandidates, {
    priority: state.aimbot.priority,
    stickyId: state.aimbot.sticky && aimHeld ? memory.stickyId : null,
  });
  if (aimTarget && aimHeld) memory.stickyId = aimTarget.id;
  if (!aimHeld) memory.stickyId = null;

  if (aimTarget && aimHeld) {
    applyAim(camera, aimTarget.world, smoothAlpha(state.aimbot.smoothness, dt, 1));
  } else if (assistTarget && state.assist.enabled) {
    applyAim(
      camera,
      assistTarget.world,
      smoothAlpha(state.assist.smoothness, dt, state.assist.strength / 100),
    );
  }

  memory.kickPitch *= Math.exp(-dt * 7.5);
  memory.kickYaw *= Math.exp(-dt * 7.5);

  const aimedView = {
    x: camera.x,
    y: camera.y,
    z: camera.z,
    yaw: camera.yaw + memory.kickYaw,
    pitch: camera.pitch + memory.kickPitch,
    fov: state.camera.fov,
  };

  let triggerTarget = null;
  if (state.trigger.enabled) {
    let closest = Infinity;
    for (const player of players) {
      if (!eligible(player, {
        teammates: state.trigger.teammates,
        visibleOnly: state.trigger.visibleOnly,
      })) continue;
      if (!bodyContainsCrosshair(player, aimedView, width, height, state.trigger.scale)) continue;
      const dist = distanceMeters(camera, { x: player.x, y: player.y + 1, z: player.z });
      if (dist < closest) {
        closest = dist;
        triggerTarget = player;
      }
    }
  }

  const triggerHeld = state.trigger.enabled && held.has(state.trigger.hotkey);
  const stepped = stepTrigger(memory.trigger, {
    active: triggerHeld,
    onTarget: Boolean(triggerTarget),
    now,
    delay: state.trigger.delay,
  });
  memory.trigger = stepped.state;

  let fired = false;
  let victimId = null;
  if (stepped.fired && triggerTarget) {
    fired = true;
    victimId = triggerTarget.id;
    applyRecoil(memory, state);
  } else if (manualFire) {
    applyRecoil(memory, state);
    const victim = players.find((player) => (
      player.alive && bodyContainsCrosshair(player, aimedView, width, height, 1)
    ));
    if (victim) {
      fired = true;
      victimId = victim.id;
    }
  }

  return {
    view: aimedView,
    assistTarget,
    aimTarget,
    aimHeld,
    triggerTarget,
    triggerHeld,
    fired,
    victimId,
  };
}

function applyRecoil(memory, state) {
  if (!state.recoil.enabled) return;
  const sample = RECOIL_PATTERN[memory.recoilIndex % RECOIL_PATTERN.length];
  const scale = (state.recoil.strength / 100) * 0.012;
  memory.kickPitch += sample[1] * scale;
  memory.kickYaw += sample[0] * scale;
  memory.recoilIndex = (memory.recoilIndex + 1) % RECOIL_PATTERN.length;
}

export function decayRecoilIndex(memory, now, lastShotAt) {
  if (now - lastShotAt > 360) memory.recoilIndex = 0;
}
