// Pitch geometry. Every position in the app is in meters on a 105 x 68 pitch.
// x runs goal line to goal line (home attacks toward x = 105), y runs touchline to touchline
// (y = 0 is the home team's left when attacking).

export const PITCH = {
  L: 105, W: 68,
  boxD: 16.5, boxW: 40.32,
  sixD: 5.5, sixW: 18.32,
  spot: 11, circleR: 9.15,
  goalW: 7.32, goalD: 2.2,
  cornerR: 1,
};

// Thirds along the length and the five positional-play channels across the width.
// Channel edges follow the penalty box and six-yard box lines.
export const THIRDS = [0, 35, 70, 105];
export const CHANNELS = [0, 13.84, 24.84, 43.16, 54.16, 68];
export const THIRD_NAMES = ['defensive third', 'middle third', 'final third'];
export const CHANNEL_NAMES = ['left wing', 'left half-space', 'center', 'right half-space', 'right wing'];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clampToPitch = (p) => ({ x: clamp(p.x, 0, PITCH.L), y: clamp(p.y, 0, PITCH.W) });
export const round1 = (v) => Math.round(v * 10) / 10;

export const ease = {
  linear: (t) => t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
};

export function zoneOf(x, y) {
  const third = x < THIRDS[1] ? 0 : x < THIRDS[2] ? 1 : 2;
  let channel = 4;
  for (let i = 1; i < CHANNELS.length; i++) {
    if (y < CHANNELS[i]) { channel = i - 1; break; }
  }
  return { third, channel, index: third * 5 + channel };
}

export function zoneRect(index) {
  const third = Math.floor(index / 5), channel = index % 5;
  return {
    x: THIRDS[third], y: CHANNELS[channel],
    w: THIRDS[third + 1] - THIRDS[third], h: CHANNELS[channel + 1] - CHANNELS[channel],
  };
}

export function zoneName(index) {
  return `${CHANNEL_NAMES[index % 5]}, ${THIRD_NAMES[Math.floor(index / 5)]}`;
}

// ---- Curved paths -------------------------------------------------------
// A path is a quadratic curve between p0 and p2. `curve` is how far (meters) the
// midpoint handle sits off the straight chord, signed toward the chord's left normal.

function normalOf(p0, p2) {
  const dx = p2.x - p0.x, dy = p2.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

export function handlePoint(p0, p2, curve) {
  const n = normalOf(p0, p2);
  return { x: (p0.x + p2.x) / 2 + n.x * curve, y: (p0.y + p2.y) / 2 + n.y * curve };
}

export function curveFromHandle(p0, p2, h) {
  const n = normalOf(p0, p2);
  return (h.x - (p0.x + p2.x) / 2) * n.x + (h.y - (p0.y + p2.y) / 2) * n.y;
}

export function makePath(p0, p2, curve = 0) {
  const n = normalOf(p0, p2);
  const c = { x: (p0.x + p2.x) / 2 + n.x * 2 * curve, y: (p0.y + p2.y) / 2 + n.y * 2 * curve };
  const N = 48;
  const lut = [0];
  let prev = p0, total = 0;
  for (let i = 1; i <= N; i++) {
    const q = quad(p0, c, p2, i / N);
    total += dist(prev, q);
    lut.push(total);
    prev = q;
  }
  const tAt = (s) => {
    const target = clamp(s, 0, 1) * total;
    if (total === 0) return 0;
    let lo = 0, hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lut[mid] < target) lo = mid; else hi = mid;
    }
    const seg = lut[hi] - lut[lo] || 1;
    return (lo + (target - lut[lo]) / seg) / N;
  };
  return {
    p0, p2, c, len: total,
    at: (s) => quad(p0, c, p2, tAt(s)),
    tangentAt: (s) => {
      const t = tAt(s);
      const d = { x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p2.x - c.x), y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p2.y - c.y) };
      const l = Math.hypot(d.x, d.y) || 1;
      return { x: d.x / l, y: d.y / l };
    },
  };
}

function quad(p0, c, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
}

const f2 = (v) => Math.round(v * 100) / 100;

// SVG path data for the section of a path between arc fractions s0 and s1.
export function pathD(path, s0 = 0, s1 = 1, wavy = null) {
  if (path.len < 0.01) return '';
  const pts = [];
  const span = (s1 - s0) * path.len;
  if (wavy) {
    // Dribble line: sine offset along the curve, straightening out before the arrowhead.
    const step = 0.22;
    const n = Math.max(2, Math.ceil(span / step));
    for (let i = 0; i <= n; i++) {
      const s = s0 + (s1 - s0) * (i / n);
      const along = (s - s0) * path.len;
      const p = path.at(s);
      const t = path.tangentAt(s);
      const fade = clamp((span - along) / wavy.straight, 0, 1) * clamp(along / 0.8, 0, 1);
      const off = Math.sin((along / wavy.wavelength) * Math.PI * 2) * wavy.amp * fade;
      pts.push({ x: p.x - t.y * off, y: p.y + t.x * off });
    }
  } else {
    const n = Math.abs(path.c.x - (path.p0.x + path.p2.x) / 2) + Math.abs(path.c.y - (path.p0.y + path.p2.y) / 2) < 0.01 ? 1 : 28;
    for (let i = 0; i <= n; i++) pts.push(path.at(s0 + (s1 - s0) * (i / n)));
  }
  return 'M' + pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L');
}

// Arrowhead polygon at `tip`, pointing along unit vector `dir`.
export function arrowHead(tip, dir, size = 1.8, width = 1) {
  const n = { x: -dir.y, y: dir.x };
  const back = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const notch = { x: tip.x - dir.x * size * 0.72, y: tip.y - dir.y * size * 0.72 };
  const a = { x: back.x + n.x * size * 0.55 * width, y: back.y + n.y * size * 0.55 * width };
  const b = { x: back.x - n.x * size * 0.55 * width, y: back.y - n.y * size * 0.55 * width };
  return [tip, a, notch, b].map((p) => `${f2(p.x)},${f2(p.y)}`).join(' ');
}

// ---- View mapping -------------------------------------------------------
// The board can be shown horizontally or vertically and flipped. A view matrix maps
// pitch meters to view units: vx = a*x + c*y + e, vy = b*x + d*y + f.

export function viewMatrix(orient, flip) {
  if (orient === 'v') return flip ? [0, 1, -1, 0, PITCH.W, 0] : [0, -1, 1, 0, 0, PITCH.L];
  return flip ? [-1, 0, 0, -1, PITCH.L, PITCH.W] : [1, 0, 0, 1, 0, 0];
}

export const applyM = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export function invertM(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

// Bounding box, in view units, of a pitch-space rectangle.
export function viewBox(m, rect, pad) {
  const corners = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h },
  ].map((p) => applyM(m, p));
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
}

// Nudge points so none sits on top of an obstacle (an opposing player), keeping each
// point inside its original zone so zone counts don't change.
const DIRS = [0, 180, 90, 270, 45, 135, 225, 315, 22, 158, 202, 338, 68, 112, 248, 292].map((a) => ({ x: Math.cos((a * Math.PI) / 180), y: Math.sin((a * Math.PI) / 180) }));
export function separate(points, obstacles, minD = 4.2) {
  const placed = [];
  return points.map((p) => {
    const others = obstacles.concat(placed);
    const clash = (q) => others.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < minD);
    let out = p;
    if (clash(p)) {
      const z = zoneOf(p.x, p.y).index;
      search: for (let r = 0.5; r <= 11; r += 0.5) {
        for (const d of DIRS) {
          const c = clampToPitch({ x: p.x + d.x * r, y: p.y + d.y * r });
          const q = { x: round1(c.x), y: round1(c.y) };
          if (!clash(q) && zoneOf(q.x, q.y).index === z) { out = { ...p, ...q }; break search; }
        }
      }
    }
    placed.push(out);
    return out;
  });
}
