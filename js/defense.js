// Automatic defensive reactions. For the team without the ball, works out where each
// player should end a step: the block shifts with the ball, the back line holds and drops,
// the nearest player presses, runners are tracked goal-side and the keeper sets position.
// Pure functions; positions are meters, home attacks toward x = 105.

import { clamp, dist, PITCH } from './geometry.js';
import { assign } from './analysis.js';

export const BLOCKS = {
  low: { gap: 18, maxLine: 24, compact: 0.5 },
  mid: { gap: 13, maxLine: 38, compact: 0.6 },
  high: { gap: 9, maxLine: 50, compact: 0.68 },
};
export const PRESS = {
  passive: { radius: 9, speed: 6.2 },
  balanced: { radius: 20, speed: 7 },
  aggressive: { radius: 32, speed: 7.8 },
};
export const REACTION_DELAY = 0.12; // defenders react a beat after the attack moves

// How well the defense executes. Imperfections are seeded per player and step, so a play
// always looks the same each time it's shown.
//   reach    share of the way to the ideal spot each player actually gets
//   delay    reaction delay (fraction of the step) plus random spread
//   lose     chance a marker ball-watches and loses his runner
//   stop     how far short of the ball the presser stops (meters)
//   jitter   positional error (meters)
//   shift    how far the block slides across toward the ball
export const QUALITY = {
  sharp: { reach: 0.96, delay: 0.1, spread: 0.06, lose: 0.04, stop: 1.8, jitter: 0.4, shift: 0.42 },
  realistic: { reach: 0.78, delay: 0.18, spread: 0.14, lose: 0.3, stop: 3.2, jitter: 1.4, shift: 0.33 },
  sloppy: { reach: 0.58, delay: 0.26, spread: 0.2, lose: 0.55, stop: 4.6, jitter: 2.6, shift: 0.24 },
};

// Small deterministic random number in [0, 1) from a few values.
export function rand(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// opts:
//   side       'home' | 'away' (the defending team)
//   ids        defending player ids;  gk: the goalkeeper id (or null)
//   attackers  attacking player ids
//   base       shape positions (play start) {id: {x,y}}
//   start      positions at the start of the step
//   end        attackers' positions at the end of the step
//   ball       ball at the end of the step {x, y, owner}
//   fixed      ids already moved by the coach this step (left alone)
//   duration   step length in seconds
//   block, press   keys of BLOCKS / PRESS
//   setPiece   true while the opening set-piece step is being taken (no pressing, hold zones)
//   quality    key of QUALITY (default 'realistic');  seed, step: make imperfections repeatable
// Returns { targets, roles: {id: 'press'|'mark'|'lost'|'zone'|'gk'}, delays: {id: fraction} }.
export function defendStep(o) {
  const blk = BLOCKS[o.block] || BLOCKS.mid;
  const prs = PRESS[o.press] || PRESS.balanced;
  const q = QUALITY[o.quality] || QUALITY.realistic;
  const r = (id, salt) => rand(o.seed || '', o.step || 0, id, salt);
  const away = o.side === 'away';
  const depth = (p) => (away ? PITCH.L - p.x : p.x);
  const fromDepth = (d, y) => ({ x: away ? PITCH.L - d : d, y });
  const goal = fromDepth(0, PITCH.W / 2);
  const B = o.ball;
  const bd = depth(B);
  const outfield = o.ids.filter((id) => id !== o.gk && o.start[id]);
  const free = (id) => !o.fixed.has(id);
  const targets = {}, roles = {};

  // ---- Zonal block: keep the shape, shifted toward the ball and squeezed.
  const baseDepths = outfield.map((id) => depth(o.base[id] || o.start[id])).sort((a, b) => a - b);
  const backBase = baseDepths.slice(0, 4).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(4, baseDepths.length));
  const attackerDepths = o.attackers.map((id) => o.end[id]).filter(Boolean).map(depth);
  let line = clamp(bd - blk.gap, 7, blk.maxLine);
  if (attackerDepths.length) line = Math.max(5.5, Math.min(line, Math.min(...attackerDepths) - 1));
  const lateral = (B.y - PITCH.W / 2) * (o.setPiece ? 0.12 : q.shift);
  for (const id of outfield) {
    if (o.setPiece) {
      const s = o.start[id];
      targets[id] = { x: s.x, y: clamp(s.y + lateral, 1, PITCH.W - 1) };
    } else {
      const b = o.base[id] || o.start[id];
      const d = Math.min(line + (depth(b) - backBase) * blk.compact, Math.max(bd + 8, line + 4));
      const y = clamp(PITCH.W / 2 + (b.y - PITCH.W / 2) * 0.82 + lateral, 2, PITCH.W - 2);
      targets[id] = fromDepth(Math.max(line - 0.5, d), y);
    }
    roles[id] = 'zone';
  }

  // ---- Press the ball (or chase a loose ball).
  let presser = null;
  if (!o.setPiece) {
    let best = Infinity;
    for (const id of outfield) {
      if (!free(id)) continue;
      const d = dist(o.start[id], B);
      if (d < best) { best = d; presser = id; }
    }
    if (presser && best <= prs.radius) {
      const toGoal = unit(B, goal);
      const gapM = B.owner ? q.stop * (0.7 + 0.6 * r(presser, 'stop')) : 0.4 + q.stop * 0.3;
      targets[presser] = { x: B.x + toGoal.x * gapM, y: B.y + toGoal.y * gapM };
      roles[presser] = 'press';
    } else presser = null;
  }

  // ---- Track dangerous runners goal-side.
  const danger = o.attackers
    .filter((id) => o.end[id] && id !== B.owner)
    .map((id) => ({ id, p: o.end[id], d: depth(o.end[id]), moved: dist(o.start[id] || o.end[id], o.end[id]) }))
    .filter((a) => a.d <= Math.max(line + 18, 30) || (a.moved > 4 && a.d < line + 6))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  const markers = outfield.filter((id) => id !== presser && free(id));
  if (danger.length && markers.length) {
    const cost = danger.map((a) => markers.map((id) => {
      const dd = dist(o.start[id], a.p);
      return dd > 26 ? 1e3 : dd;
    }));
    const pick = assign(danger.length <= markers.length ? cost : cost.slice(0, markers.length));
    pick.forEach((mi, ai) => {
      if (mi < 0 || cost[ai][mi] >= 1e3) return;
      const a = danger[ai];
      const toGoal = unit(a.p, goal);
      const tight = a.d < 17 ? 1 : 1.6;
      const mark = { x: a.p.x + toGoal.x * tight, y: a.p.y + toGoal.y * tight };
      const id = markers[mi];
      // Some markers ball-watch: they drift toward the ball side and lose the runner.
      if (r(id, 'lose') < q.lose * (a.moved > 6 ? 1.3 : 0.7)) {
        const toBall = unit(a.p, B);
        const lag = 2.5 + 3 * r(id, 'lag');
        targets[id] = { x: a.p.x + toBall.x * lag - toGoal.x * 0.8, y: a.p.y + toBall.y * lag - toGoal.y * 0.8 };
        roles[id] = 'lost';
        return;
      }
      // Inside the box, mark tightly; further out, stay between the runner and the zone.
      const w = a.d < 22 ? 1 : 0.7;
      targets[id] = { x: mark.x * w + targets[id].x * (1 - w), y: mark.y * w + targets[id].y * (1 - w) };
      roles[id] = 'mark';
    });
  }

  // ---- Goalkeeper: on the line between the ball and the middle of the goal.
  if (o.gk && o.start[o.gk] && free(o.gk)) {
    const gd = clamp(1 + bd * 0.06, 0.8, 6);
    const gy = clamp(PITCH.W / 2 + (B.y - PITCH.W / 2) * Math.min(0.35, 6 / (bd + 1)), 30.6, 37.4);
    targets[o.gk] = fromDepth(gd, gy);
    roles[o.gk] = 'gk';
  }

  // ---- Human error: players only get part of the way there, and not exactly to the spot.
  for (const id in targets) {
    if (roles[id] === 'gk') continue;
    const s = o.start[id];
    const reach = clamp(q.reach + (r(id, 'reach') - 0.5) * 0.2, 0.3, 1);
    const jx = (r(id, 'jx') - 0.5) * 2 * q.jitter, jy = (r(id, 'jy') - 0.5) * 2 * q.jitter;
    const t = targets[id];
    targets[id] = { x: s.x + (t.x - s.x) * reach + jx, y: s.y + (t.y - s.y) * reach + jy };
  }

  // ---- Human limits: nobody covers more ground than they could in the time.
  const maxRun = prs.speed * (o.duration || 2);
  for (const id in targets) {
    const s = o.start[id];
    const t = targets[id];
    const d = dist(s, t);
    if (d > maxRun) targets[id] = { x: s.x + ((t.x - s.x) * maxRun) / d, y: s.y + ((t.y - s.y) * maxRun) / d };
    targets[id] = { x: clamp(targets[id].x, 0.3, PITCH.L - 0.3), y: clamp(targets[id].y, 0.3, PITCH.W - 0.3) };
  }

  // ---- Keep teammates from stacking on top of each other.
  const ids = Object.keys(targets).filter((id) => roles[id] === 'zone');
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = targets[ids[i]], b = targets[ids[j]];
      const d = dist(a, b);
      if (d < 3 && d > 0.001) {
        const push = (3 - d) / 2, ux = (a.x - b.x) / d, uy = (a.y - b.y) / d;
        targets[ids[i]] = { x: a.x + ux * push, y: a.y + uy * push };
        targets[ids[j]] = { x: b.x - ux * push, y: b.y - uy * push };
      }
    }
  }

  // Drop tiny adjustments so a settled defense stays still.
  const delays = {};
  for (const id of Object.keys(targets)) {
    if (!free(id) || dist(o.start[id], targets[id]) < 0.35) { delete targets[id]; delete roles[id]; continue; }
    delays[id] = clamp(q.delay + (r(id, 'delay') - 0.3) * q.spread * 2, 0.04, 0.5);
  }
  return { targets, roles, delays };
}

function unit(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

// Space map: which team would reach each patch of the pitch first (nearest player wins).
// Returns horizontal runs of cells: [{ x0, x1, y0, y1, side, margin }] in meters.
export function spaceControl(home, away, cell = 2.5) {
  const runs = [];
  const nearest = (pts, x, y) => {
    let b = Infinity;
    for (const p of pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < b) b = d; }
    return Math.sqrt(b);
  };
  const cols = Math.ceil(PITCH.L / cell), rows = Math.ceil(PITCH.W / cell);
  for (let j = 0; j < rows; j++) {
    const y0 = j * cell, y1 = Math.min(PITCH.W, y0 + cell), cy = (y0 + y1) / 2;
    let run = null;
    for (let i = 0; i < cols; i++) {
      const x0 = i * cell, x1 = Math.min(PITCH.L, x0 + cell), cx = (x0 + x1) / 2;
      const dh = nearest(home, cx, cy), da = nearest(away, cx, cy);
      const side = dh <= da ? 'home' : 'away';
      // Margin buckets: contested (< 2 m), clear (< 6 m), open (6 m+).
      const m = Math.abs(dh - da), margin = m < 2 ? 0 : m < 6 ? 1 : 2;
      if (run && run.side === side && run.margin === margin) run.x1 = x1;
      else { run = { x0, x1, y0, y1, side, margin }; runs.push(run); }
    }
  }
  return runs;
}
