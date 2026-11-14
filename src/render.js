import { BONES, SKELETON_EDGES, posedLocal } from "./bones.js";
import { RECOIL_PATTERN, boneWorld, fovRadiusPx, hexAlpha, project } from "./math.js";
import { OBSTACLES } from "./sim.js";

const BOX_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const FACES = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
];

function obstacleCorners(box) {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  return [
    { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y0, z: z1 }, { x: x0, y: y0, z: z1 },
    { x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 },
  ];
}

function playerCorners(player) {
  const hx = 0.32;
  const hy = 1.82;
  const hz = 0.22;
  const locals = [
    [-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz],
    [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  return locals.map((local) => boneWorld(player, local));
}

function projectAll(points, camera, width, height) {
  return points.map((point) => project(point, camera, width, height));
}

function boundsOf(projected) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let depth = 0;
  let count = 0;
  for (const point of projected) {
    if (!point) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    depth += point.depth;
    count += 1;
  }
  if (!count) return null;
  return { minX, minY, maxX, maxY, depth: depth / count, count };
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function strokeEdges(ctx, projected, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  for (const [a, b] of BOX_EDGES) {
    const p0 = projected[a];
    const p1 = projected[b];
    if (!p0 || !p1) continue;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
}

export function drawWorld(ctx, { width, height, camera, players, time }) {
  ctx.clearRect(0, 0, width, height);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#070614");
  sky.addColorStop(0.42, "#16122e");
  sky.addColorStop(0.68, "#241433");
  sky.addColorStop(1, "#07080f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.62, 20, width * 0.5, height * 0.7, height * 0.55);
  glow.addColorStop(0, "rgba(120, 90, 255, 0.18)");
  glow.addColorStop(0.45, "rgba(40, 90, 180, 0.08)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.lineWidth = 1;
  for (let i = -20; i <= 20; i += 1) {
    const major = i % 5 === 0;
    ctx.strokeStyle = major ? "rgba(110, 150, 255, 0.22)" : "rgba(90, 120, 200, 0.09)";
    strokeWorldLine(ctx, camera, width, height, { x: i, y: 0, z: -18 }, { x: i, y: 0, z: 22 });
    strokeWorldLine(ctx, camera, width, height, { x: -20, y: 0, z: i }, { x: 20, y: 0, z: i });
  }

  drawRing(ctx, camera, width, height, 18, "rgba(140, 110, 255, 0.35)");

  const faces = [];
  const obstacleOutlines = [];
  for (const obstacle of OBSTACLES) {
    const corners = obstacleCorners(obstacle);
    const projected = projectAll(corners, camera, width, height);
    obstacleOutlines.push(projected);
    FACES.forEach((face, index) => {
      const pts = face.map((corner) => projected[corner]);
      if (pts.some((point) => !point)) return;
      const depth = pts.reduce((sum, point) => sum + point.depth, 0) / pts.length;
      faces.push({ pts, depth, top: index === 1 });
    });
  }
  faces.sort((a, b) => b.depth - a.depth);
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.pts[0].x, face.pts[0].y);
    for (let i = 1; i < face.pts.length; i += 1) ctx.lineTo(face.pts[i].x, face.pts[i].y);
    ctx.closePath();
    ctx.fillStyle = face.top ? "rgba(96, 112, 184, 0.42)" : "rgba(18, 22, 42, 0.78)";
    ctx.fill();
  }
  for (const projected of obstacleOutlines) {
    strokeEdges(ctx, projected, "rgba(176, 198, 255, 0.32)", 1);
  }

  const ordered = players.filter((player) => player.alive).slice().sort((a, b) => {
    const da = (a.x - camera.x) ** 2 + (a.z - camera.z) ** 2;
    const db = (b.x - camera.x) ** 2 + (b.z - camera.z) ** 2;
    return db - da;
  });
  for (const player of ordered) {
    if (!player.visible) continue;
    drawBody(ctx, player, camera, width, height, time);
  }

  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.78);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function toCamera(point, cam) {
  const dx = point.x - cam.x;
  const dy = point.y - cam.y;
  const dz = point.z - cam.z;
  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const x1 = cosY * dx - sinY * dz;
  const z1 = sinY * dx + cosY * dz;
  return {
    x: x1,
    y: cosP * dy - sinP * z1,
    z: sinP * dy + cosP * z1,
  };
}

function projectSpace(space, cam, width, height) {
  const focal = (height * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
  return {
    x: width * 0.5 + (space.x * focal) / space.z,
    y: height * 0.5 - (space.y * focal) / space.z,
  };
}

function strokeWorldLine(ctx, camera, width, height, from, to) {
  const near = 0.15;
  let a = toCamera(from, camera);
  let b = toCamera(to, camera);
  const aIn = a.z >= near;
  const bIn = b.z >= near;
  if (!aIn && !bIn) return;
  if (aIn !== bIn) {
    const t = (near - a.z) / (b.z - a.z);
    const hit = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: near,
    };
    if (!aIn) a = hit;
    else b = hit;
  }
  const p0 = projectSpace(a, camera, width, height);
  const p1 = projectSpace(b, camera, width, height);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

function drawRing(ctx, camera, width, height, radius, color) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 64; i += 1) {
    const angle = (i / 64) * Math.PI * 2;
    const point = project(
      { x: Math.cos(angle) * radius, y: 0.02, z: Math.sin(angle) * radius },
      camera,
      width,
      height,
    );
    if (!point) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(point.x, point.y);
      started = true;
    } else ctx.lineTo(point.x, point.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawBody(ctx, player, camera, width, height, time) {
  const joints = {};
  for (const name of Object.keys(BONES)) {
    joints[name] = project(boneWorld(player, posedLocal(player, name, time)), camera, width, height);
  }
  const foot = project({ x: player.x, y: 0.02, z: player.z }, camera, width, height);
  if (foot) {
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, Math.max(6, foot.scale * 0.28), Math.max(3, foot.scale * 0.1), 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fill();
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = player.team === "friendly" ? "rgba(90, 230, 200, 0.45)" : "rgba(214, 222, 255, 0.38)";
  ctx.lineWidth = 2;
  for (const [a, b] of SKELETON_EDGES) {
    const p0 = joints[a];
    const p1 = joints[b];
    if (!p0 || !p1) continue;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  const head = joints.head;
  if (head) {
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(3, head.scale * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = player.team === "friendly" ? "rgba(90, 230, 200, 0.7)" : "rgba(236, 240, 255, 0.75)";
    ctx.fill();
  }
}

function espColor(player, esp) {
  if (player.team === "friendly") return esp.colors.friendly;
  if (esp.colorByVisibility) return player.visible ? esp.colors.visible : esp.colors.occluded;
  return esp.colors.box;
}

export function drawOverlay(ctx, frame) {
  const { width, height, camera, players, esp, assist, aimbot, crosshair, recoil, combat, floaters, patternIndex } = frame;
  ctx.clearRect(0, 0, width, height);

  if (assist.enabled && assist.drawFov) {
    strokeFov(ctx, width, height, fovRadiusPx(assist.fov, camera.fov, height), "rgba(62, 197, 255, 0.85)");
  }
  if (aimbot.enabled) {
    strokeFov(ctx, width, height, fovRadiusPx(aimbot.fov, camera.fov, height), "rgba(176, 120, 255, 0.9)");
  }

  if (esp.enabled) {
    const drawn = [];
    for (const player of players) {
      if (!player.alive) continue;
      if (player.team === "friendly" && !esp.teammates) continue;
      const dist = Math.hypot(player.x - camera.x, player.z - camera.z);
      if (dist > esp.maxDistance) continue;
      const projected = projectAll(playerCorners(player), camera, width, height);
      const box = boundsOf(projected);
      if (!box) continue;
      if (box.maxX < -40 || box.maxY < -40 || box.minX > width + 40 || box.minY > height + 40) continue;
      drawn.push({ player, projected, box, dist });
    }
    drawn.sort((a, b) => b.box.depth - a.box.depth);
    const labels = [];
    const claim = (x, y, w, h) => {
      let nextY = y;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const hit = labels.some((label) => (
          Math.abs(label.x - x) < (label.w + w) * 0.5
          && Math.abs(label.y - nextY) < (label.h + h) * 0.5
        ));
        if (!hit) break;
        nextY -= h + 3;
      }
      labels.push({ x, y: nextY, w, h });
      return nextY;
    };
    for (const item of drawn) drawEsp(ctx, item, esp, camera, width, height, frame.time, claim);
  }

  if (combat.aimTarget && aimbot.drawLine && aimbot.enabled) {
    const point = project(combat.aimTarget.world, camera, width, height);
    if (point) {
      ctx.beginPath();
      ctx.moveTo(width / 2, height / 2);
      ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = combat.aimHeld ? "rgba(210, 170, 255, 0.9)" : "rgba(210, 170, 255, 0.28)";
      ctx.lineWidth = 1.25;
      ctx.stroke();
      diamond(ctx, point.x, point.y, 5, combat.aimHeld ? "#d2a6ff" : "rgba(210,166,255,0.5)");
    }
  } else if (combat.assistTarget && assist.enabled) {
    const point = project(combat.assistTarget.world, camera, width, height);
    if (point) diamond(ctx, point.x, point.y, 4, "rgba(62, 197, 255, 0.9)");
  }

  if (combat.triggerTarget && frame.trigger.enabled) {
    const head = project(boneWorld(combat.triggerTarget, BONES.head), camera, width, height);
    if (head) {
      ctx.strokeStyle = combat.triggerHeld ? "#ffe08a" : "rgba(255, 224, 138, 0.45)";
      ctx.lineWidth = 1.5;
      bracket(ctx, head.x - 10, head.y - 14, 20, 28, 5);
    }
  }

  if (crosshair.enabled) drawCrosshair(ctx, width, height, crosshair);

  for (const floater of floaters) {
    const point = project(floater, camera, width, height);
    if (!point) continue;
    const alpha = Math.max(0, 1 - floater.age / floater.life);
    ctx.globalAlpha = alpha;
    ctx.font = "700 13px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd2dc";
    ctx.fillText(floater.text, point.x, point.y - 18 - floater.age * 26);
    ctx.globalAlpha = 1;
  }

  if (frame.hitFlash > 0) {
    ctx.strokeStyle = `rgba(255,255,255,${frame.hitFlash})`;
    ctx.lineWidth = 2;
    const cx = width / 2;
    const cy = height / 2;
    const marks = [
      [cx - 10, cy - 10, cx - 4, cy - 4],
      [cx + 10, cy - 10, cx + 4, cy - 4],
      [cx - 10, cy + 10, cx - 4, cy + 4],
      [cx + 10, cy + 10, cx + 4, cy + 4],
    ];
    for (const [x0, y0, x1, y1] of marks) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  if (recoil.enabled && recoil.showPattern) {
    drawRecoilWidget(ctx, width, height, recoil, patternIndex);
  }
}

function drawEsp(ctx, item, esp, camera, width, height, time, claim) {
  const { player, projected, box } = item;
  const color = espColor(player, esp);
  const alpha = (esp.opacity / 100) * (player.visible ? 1 : 0.78);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = esp.thickness;

  if (esp.box3d) strokeEdges(ctx, projected, hexAlpha(esp.colors.skeleton, 0.92), Math.max(1, esp.thickness - 0.3));

  const x = box.minX;
  const y = box.minY;
  const w = Math.max(2, box.maxX - box.minX);
  const h = Math.max(2, box.maxY - box.minY);
  if (esp.box2d) {
    ctx.strokeStyle = hexAlpha(color, 0.95);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = hexAlpha(color, 0.08);
    ctx.fillRect(x, y, w, h);
  }

  if (esp.skeleton) {
    ctx.strokeStyle = hexAlpha(esp.colors.skeleton, player.visible ? 0.95 : 0.55);
    ctx.lineWidth = Math.max(1, esp.thickness - 0.2);
    ctx.setLineDash(player.visible ? [] : [4, 4]);
    for (const [a, b] of SKELETON_EDGES) {
      const p0 = project(boneWorld(player, posedLocal(player, a, time)), camera, width, height);
      const p1 = project(boneWorld(player, posedLocal(player, b, time)), camera, width, height);
      if (!p0 || !p1) continue;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const head = project(boneWorld(player, posedLocal(player, "head", time)), camera, width, height);
    if (head) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, Math.max(3, head.scale * 0.13), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (esp.health) {
    const ratio = Math.max(0, Math.min(1, player.health / 100));
    const barX = x - 7;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(barX, y, 4, h);
    const fill = ratio > 0.55 ? "#3ee0a2" : ratio > 0.28 ? "#ffb020" : "#ff4d6d";
    ctx.fillStyle = fill;
    ctx.fillRect(barX, y + h * (1 - ratio), 4, h * ratio);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (esp.names) {
    ctx.font = "600 12px Inter, sans-serif";
    const nameWidth = Math.max(36, ctx.measureText(player.name).width + 8);
    const nameY = claim(x + w / 2, y - 8, nameWidth, 14);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.strokeText(player.name, x + w / 2, nameY);
    ctx.fillStyle = esp.colors.name;
    ctx.fillText(player.name, x + w / 2, nameY);
  }
  if (esp.distance || esp.visibility) {
    const meters = Math.hypot(player.x - camera.x, (player.y + 1) - camera.y, player.z - camera.z);
    const sight = !esp.visibility ? "" : player.visible ? " VIS" : " OCC";
    const caption = `${esp.distance ? `${meters.toFixed(0)}m` : ""}${sight}`;
    ctx.font = "600 11px 'JetBrains Mono', ui-monospace, monospace";
    const captionY = claim(x + w / 2, y + h + 14, ctx.measureText(caption).width + 8, 13);
    ctx.fillStyle = player.visible || !esp.visibility ? hexAlpha(esp.colors.name, 0.92) : esp.colors.occluded;
    ctx.fillText(caption.trim(), x + w / 2, captionY);
  }
  ctx.globalAlpha = 1;
}

function strokeFov(ctx, width, height, radius, color) {
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function diamond(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function bracket(ctx, x, y, w, h, arm) {
  ctx.beginPath();
  ctx.moveTo(x, y + arm);
  ctx.lineTo(x, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x + w - arm, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + arm);
  ctx.moveTo(x, y + h - arm);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + arm, y + h);
  ctx.moveTo(x + w - arm, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - arm);
  ctx.stroke();
}

function drawCrosshair(ctx, width, height, crosshair) {
  const cx = width / 2;
  const cy = height / 2;
  const size = crosshair.size;
  const gap = crosshair.gap;
  const paint = (stroke, widthPx) => {
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;
    ctx.lineWidth = widthPx;
    ctx.lineCap = "round";
    if (crosshair.style === "dot") {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1.5, size * 0.28), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (crosshair.style === "circle") {
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (crosshair.style === "chevron") {
      ctx.beginPath();
      ctx.moveTo(cx - size, cy + size * 0.65);
      ctx.lineTo(cx, cy - size * 0.15);
      ctx.lineTo(cx + size, cy + size * 0.65);
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(cx - gap - size, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + gap + size, cy);
    ctx.moveTo(cx, cy - gap - size);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + gap + size);
    ctx.stroke();
  };
  if (crosshair.outline) paint("rgba(0,0,0,0.78)", crosshair.thickness + 2.2);
  paint(crosshair.color, crosshair.thickness);
}

function drawRecoilWidget(ctx, width, height, recoil, patternIndex) {
  const w = 132;
  const h = 150;
  const x = width - w - 22;
  const y = height - h - 22;
  ctx.fillStyle = "rgba(8, 10, 18, 0.62)";
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(150, 170, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(196, 206, 240, 0.8)";
  ctx.font = "600 10px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("RECOIL", x + 12, y + 18);
  ctx.font = "500 10px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillStyle = "#8ea2d6";
  ctx.textAlign = "right";
  ctx.fillText(String(recoil.strength).padStart(2, "0"), x + w - 12, y + 18);
  const originX = x + w / 2;
  const originY = y + h - 18;
  const scale = 7.4 * (0.45 + recoil.strength / 160);
  ctx.beginPath();
  ctx.arc(originX, originY, 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fill();
  RECOIL_PATTERN.forEach(([rx, ry], index) => {
    const px = originX + rx * scale * 2.4;
    const py = originY - ry * scale;
    ctx.beginPath();
    ctx.arc(px, py, index === patternIndex ? 3.4 : 2.1, 0, Math.PI * 2);
    ctx.fillStyle = index === patternIndex ? "#7ee0ff" : "rgba(192, 132, 252, 0.9)";
    ctx.fill();
  });
}
