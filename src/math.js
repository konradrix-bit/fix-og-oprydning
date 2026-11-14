export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpAngle(a, b, t) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export function boneWorld(player, local) {
  const cos = Math.cos(player.yaw);
  const sin = Math.sin(player.yaw);
  const x = local[0];
  const z = local[2];
  return {
    x: player.x + cos * x + sin * z,
    y: player.y + local[1],
    z: player.z - sin * x + cos * z,
  };
}

/**
 * Perspective project a world point. Yaw 0 looks down +Z.
 * Returns null when the point is behind the near plane.
 */
export function project(point, cam, width, height) {
  const dx = point.x - cam.x;
  const dy = point.y - cam.y;
  const dz = point.z - cam.z;
  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const x1 = cosY * dx - sinY * dz;
  const z1 = sinY * dx + cosY * dz;
  const y1 = cosP * dy - sinP * z1;
  const z2 = sinP * dy + cosP * z1;
  if (z2 < 0.08) return null;
  const focal = (height * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
  return {
    x: width * 0.5 + (x1 * focal) / z2,
    y: height * 0.5 - (y1 * focal) / z2,
    depth: z2,
    scale: focal / z2,
  };
}

export function fovRadiusPx(moduleFovDeg, cameraFovDeg, height) {
  const camera = clamp(cameraFovDeg, 20, 140);
  const moduleFov = clamp(moduleFovDeg, 1, 180);
  return (
    (Math.tan((moduleFov * Math.PI) / 360) / Math.tan((camera * Math.PI) / 360)) *
    (height * 0.5)
  );
}

export function lookAtDelta(cam, point) {
  const dx = point.x - cam.x;
  const dy = point.y - cam.y;
  const dz = point.z - cam.z;
  const flat = Math.hypot(dx, dz) || 1e-6;
  return {
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(dy, flat),
  };
}

export function applyAim(camera, worldPoint, alpha) {
  if (!worldPoint || alpha <= 0) return;
  const desired = lookAtDelta(camera, worldPoint);
  camera.yaw = lerpAngle(camera.yaw, desired.yaw, alpha);
  camera.pitch = clamp(lerpAngle(camera.pitch, desired.pitch, alpha), -1.2, 1.2);
}

/** smoothness: 0 snaps, 100 is slow. strength scales aim-assist pull, 0..1. */
export function smoothAlpha(smoothness, dt, strength = 1) {
  const tau = 0.02 + (clamp(smoothness, 0, 100) / 100) * 0.6;
  const base = 1 - Math.exp(-Math.max(0, dt) / tau);
  return clamp(base * clamp(strength, 0, 1), 0, 1);
}

export function segmentHitsAabb(a, b, box) {
  const delta = [b.x - a.x, b.y - a.y, b.z - a.z];
  const origin = [a.x, a.y, a.z];
  let tmin = 0;
  let tmax = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const direction = delta[axis];
    const start = origin[axis];
    if (Math.abs(direction) < 1e-8) {
      if (start < box.min[axis] || start > box.max[axis]) return false;
      continue;
    }
    let t1 = (box.min[axis] - start) / direction;
    let t2 = (box.max[axis] - start) / direction;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax >= 0 && tmin <= 1;
}

export function scoreTarget(candidate, priority) {
  if (priority === "distance") return candidate.distanceM * 1000 + candidate.distPx * 0.001;
  if (priority === "health") return candidate.health * 1000 + candidate.distPx * 0.001;
  return candidate.distPx;
}

export function pickTarget(candidates, { stickyId = null, priority = "crosshair" } = {}) {
  if (!candidates.length) return null;
  if (stickyId != null) {
    const sticky = candidates.find((candidate) => candidate.id === stickyId);
    if (sticky) return sticky;
  }
  let best = candidates[0];
  let bestScore = scoreTarget(best, priority);
  for (let i = 1; i < candidates.length; i += 1) {
    const score = scoreTarget(candidates[i], priority);
    if (score < bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }
  return best;
}

const MIN_CYCLE_MS = 50;

/**
 * Reaction delay gates the first shot after a target is acquired.
 * Later shots repeat on the same delay, with a short floor so a 0ms
 * setting stays readable instead of firing every frame.
 */
export function stepTrigger(prev, { active, onTarget, now, delay }) {
  const next = { armedAt: prev.armedAt, lastShot: prev.lastShot };
  if (!active || !onTarget) {
    next.armedAt = null;
    return { state: next, fired: false };
  }
  if (next.armedAt == null) next.armedAt = now;
  const reaction = Math.max(0, delay);
  const cycle = Math.max(MIN_CYCLE_MS, delay);
  if (now - next.armedAt >= reaction && now - next.lastShot >= cycle) {
    next.lastShot = now;
    return { state: next, fired: true };
  }
  return { state: next, fired: false };
}

export const RECOIL_PATTERN = [
  [0, 0],
  [0.08, 1.15],
  [-0.42, 2.35],
  [0.62, 3.55],
  [-0.78, 4.7],
  [0.36, 5.65],
  [-0.18, 6.4],
  [0.9, 7.05],
  [-0.95, 7.6],
  [0.28, 8.05],
  [-0.5, 8.4],
  [0.66, 8.7],
];

export function hexAlpha(hex, alpha) {
  const raw = String(hex || "#ffffff").replace("#", "");
  const value = raw.length === 3
    ? raw.split("").map((channel) => channel + channel).join("")
    : raw.padEnd(6, "0").slice(0, 6);
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function distanceMeters(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
