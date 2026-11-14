/** Local-space skeleton, meters, y-up. Facing +Z when yaw is 0. */
export const BONES = {
  head: [0, 1.68, 0],
  neck: [0, 1.5, 0],
  chest: [0, 1.26, 0],
  pelvis: [0, 0.92, 0],
  lShoulder: [-0.2, 1.42, 0],
  rShoulder: [0.2, 1.42, 0],
  lElbow: [-0.34, 1.16, 0],
  rElbow: [0.34, 1.16, 0],
  lHand: [-0.4, 0.92, 0.04],
  rHand: [0.4, 0.92, 0.04],
  lHip: [-0.12, 0.9, 0],
  rHip: [0.12, 0.9, 0],
  lKnee: [-0.13, 0.48, 0],
  rKnee: [0.13, 0.48, 0],
  lFoot: [-0.12, 0.04, 0.06],
  rFoot: [0.12, 0.04, 0.06],
};

export const SKELETON_EDGES = [
  ["head", "neck"],
  ["neck", "chest"],
  ["chest", "pelvis"],
  ["neck", "lShoulder"],
  ["lShoulder", "lElbow"],
  ["lElbow", "lHand"],
  ["neck", "rShoulder"],
  ["rShoulder", "rElbow"],
  ["rElbow", "rHand"],
  ["pelvis", "lHip"],
  ["lHip", "lKnee"],
  ["lKnee", "lFoot"],
  ["pelvis", "rHip"],
  ["rHip", "rKnee"],
  ["rKnee", "rFoot"],
];

export const AIM_BONES = ["head", "neck", "chest", "pelvis"];

/** Walk and idle offsets used only for drawing, not for targeting. */
export function posedLocal(player, name, time) {
  const base = BONES[name];
  const x = base[0];
  let y = base[1];
  let z = base[2];
  const idle = Math.sin(time * 2.2 + player.phase) * 0.015;
  if (name === "head" || name === "chest" || name === "neck") y += idle;
  if (player.moving) {
    const swing = Math.sin(time * 8 + player.phase) * 0.16;
    if (name === "lKnee" || name === "lFoot" || name === "lHand" || name === "lElbow") z += swing;
    if (name === "rKnee" || name === "rFoot" || name === "rHand" || name === "rElbow") z -= swing;
  }
  return [x, y, z];
}
