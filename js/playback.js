// Play timeline: turns a play (start positions + steps of actions) into per-step states
// and computes interpolated frames for animation. Pure functions, no DOM.

import { makePath, dist, ease, clamp, clampToPitch, lerpPt } from './geometry.js';
import { defendStep, REACTION_DELAY } from './defense.js';

export const BALL_ACTIONS = new Set(['pass', 'dribble', 'shot']);
export const RECEIVE_RADIUS = 3.5; // meters: a loose ball this close to a player counts as theirs
const PRESS_GAP = 2.4;             // closing-down stops this far short of the opponent

export const attackSign = (side) => (side === 'away' ? -1 : 1);
export const carryPoint = (p, side, carry) => ({ x: p.x + attackSign(side) * carry, y: p.y });

function hasBall(state, pid) {
  if (state.ball.owner) return state.ball.owner === pid;
  const p = state.pos[pid];
  return !!p && dist(p, state.ball) <= RECEIVE_RADIUS;
}

const smooth = (u) => u * u * (3 - 2 * u);
const local = (t, delay) => clamp((t - delay) / Math.max(0.05, 1 - delay), 0, 1);

// Build the full timeline for a play.
//   play:   { start: { pos: {id: {x,y}}, ball: {owner, x, y} }, steps: [{ actions: [...] }] }
//   sideOf: { id: 'home' | 'away' }
//   opts:   { carry } meters the ball sits in front of the carrier
export function buildTimeline(play, sideOf, opts = {}) {
  const carry = opts.carry ?? 2.4;
  const states = [{ pos: { ...play.start.pos }, ball: normBall(play.start.ball, play.start.pos) }];
  const steps = [];
  const invalid = new Map(); // actionId -> reason
  let lastPoss = play.start.ball?.owner ? sideOf[play.start.ball.owner] : 'home';

  play.steps.forEach((step, k) => {
    const s = states[k];
    const endPos = { ...s.pos };
    const movers = {};
    const presses = [];
    let ballAct = null;

    for (const a of step.actions) {
      if (!s.pos[a.from]) { invalid.set(a.id, 'Player not found'); continue; }
      if (BALL_ACTIONS.has(a.type)) {
        if (ballAct) { invalid.set(a.id, 'Only one pass, dribble or shot per step'); if (a.type === 'dribble') movers[a.from] = a; continue; }
        if (!hasBall(s, a.from)) { invalid.set(a.id, 'This player does not have the ball at this step'); if (a.type === 'dribble') movers[a.from] = a; continue; }
        if (a.type === 'pass' && a.to && !s.pos[a.to]) { invalid.set(a.id, 'Receiver not found'); continue; }
        ballAct = a;
      }
      if (a.type === 'run' || a.type === 'dribble') movers[a.from] = a;
      if (a.type === 'press') {
        if (!s.pos[a.to]) { invalid.set(a.id, 'Target not found'); continue; }
        presses.push(a);
      }
    }

    // Player movement.
    const paths = {};
    for (const pid in movers) {
      const a = movers[pid];
      const p2 = clampToPitch(a.target);
      endPos[pid] = p2;
      paths[pid] = { path: makePath(s.pos[pid], p2, a.curve || 0), delay: clamp(a.delay || 0, 0, 0.8), action: a };
    }
    for (const a of presses) {
      if (!a.move || movers[a.from]) continue;
      const from = s.pos[a.from], target = endPos[a.to];
      const d = dist(from, target);
      if (d <= PRESS_GAP) continue;
      const p2 = lerpPt(from, target, (d - PRESS_GAP) / d);
      endPos[a.from] = p2;
      paths[a.from] = { path: makePath(from, p2, 0), delay: clamp(a.delay || 0, 0, 0.8), action: a };
    }

    const posAt = (pid, t) => {
      const m = paths[pid];
      if (!m) return s.pos[pid];
      return m.path.at(ease.inOutSine(local(t, m.delay)));
    };

    // Ball.
    let endBall = { ...s.ball };
    let ballGeo = null;
    if (!ballAct) {
      if (s.ball.owner) endBall = { owner: s.ball.owner, ...endPos[s.ball.owner] };
    } else if (ballAct.type === 'dribble') {
      endBall = { owner: ballAct.from, ...endPos[ballAct.from] };
      ballGeo = { kind: 'dribble', owner: ballAct.from, path: paths[ballAct.from].path, delay: paths[ballAct.from].delay };
    } else {
      const a = ballAct;
      const fromSide = sideOf[a.from];
      let receiver = a.type === 'pass' && a.to ? a.to : null;
      let dest;
      if (a.type === 'pass' && !receiver) {
        // Pass into space: a player finishing their run near the spot collects it.
        let best = null, bestD = RECEIVE_RADIUS;
        for (const pid in movers) {
          if (pid === a.from) continue;
          const d = dist(endPos[pid], a.target);
          if (d <= bestD) { best = pid; bestD = d; }
        }
        receiver = best;
      }
      if (receiver) dest = carryPoint(endPos[receiver], sideOf[receiver], carry);
      else dest = a.type === 'shot' ? a.target : clampToPitch(a.target);

      const receiverMoves = receiver ? !!paths[receiver] : a.type === 'pass';
      // A loose ball (set pieces, rebounds) is struck from where it lies.
      const loose = !s.ball.owner;
      const start0 = loose ? { x: s.ball.x, y: s.ball.y } : carryPoint(s.pos[a.from], fromSide, carry);
      const approx = dist(start0, dest);
      const delay = clamp(a.delay || 0, 0, 0.8);
      // Height: along the ground, lofted (or a chipped shot) or driven (low and fast).
      const height = a.height || (a.lofted ? 'lofted' : 'ground');
      const hf = height === 'lofted' ? (a.type === 'shot' ? 1.45 : 1.3) : height === 'driven' ? 0.72 : 1;
      let f = a.type === 'shot'
        ? clamp((approx / 80) * hf, 0.14, 0.45)
        : clamp((approx / 55) * hf, 0.18, 0.9);
      let td, ta;
      if (a.type === 'pass' && receiverMoves) { td = Math.max(delay, 1 - f); ta = 1; }
      else { td = delay; ta = Math.min(1, delay + f); }
      if (ta - td < 0.12) td = Math.max(0, ta - 0.12);

      const p0 = loose ? start0 : carryPoint(posAt(a.from, td), fromSide, carry);
      const path = makePath(p0, dest, a.curve || 0);
      const lift = height === 'lofted' ? (a.type === 'shot' ? clamp(path.len / 4, 2, 6) : clamp(path.len / 5, 2, 9)) : height === 'driven' ? clamp(path.len / 14, 0.4, 1.4) : 0;
      ballGeo = { kind: a.type, from: a.from, receiver, path, td, ta, loose, lofted: lift > 0, heightKind: height, height: lift };
      endBall = receiver ? { owner: receiver, ...endPos[receiver] } : { owner: null, ...dest };
    }

    // Automatic defending: the team without the ball reacts to what the attack just did.
    const def = opts.defense;
    if (def && def.mode && def.mode !== 'off') {
      const possSide = (s.ball.owner && sideOf[s.ball.owner]) || (ballAct && sideOf[ballAct.from]) || (endBall.owner && sideOf[endBall.owner]) || lastPoss;
      lastPoss = possSide;
      const defSide = possSide === 'away' ? 'home' : 'away';
      if (def.mode === 'both' || defSide === 'away') {
        const ids = Object.keys(s.pos).filter((id) => sideOf[id] === defSide);
        const attackers = Object.keys(s.pos).filter((id) => sideOf[id] && sideOf[id] !== defSide);
        const fixed = new Set([...Object.keys(paths), ...step.actions.map((a) => a.from)]);
        const { targets, roles, delays } = defendStep({
          side: defSide, ids, gk: def.gk?.[defSide] || null, attackers,
          base: states[0].pos, start: s.pos, end: endPos, ball: endBall, fixed,
          duration: step.duration || 2, block: def.block, press: def.press,
          setPiece: !!def.setPiece && k === 0, quality: def.quality, seed: def.seed, step: k,
        });
        for (const id in targets) {
          endPos[id] = targets[id];
          paths[id] = { path: makePath(s.pos[id], targets[id], 0), delay: delays[id] ?? REACTION_DELAY, auto: true, role: roles[id] };
        }
      }
    }

    steps.push({ paths, ballAct, ballGeo, presses, duration: step.duration || 2 });
    states.push({ pos: endPos, ball: endBall });
  });

  // Mark runs that continue from one step into the next, so flowing playback
  // keeps those players moving through the step boundary instead of stopping.
  steps.forEach((st, k) => {
    for (const pid in st.paths) {
      const m = st.paths[pid];
      const prev = steps[k - 1]?.paths[pid];
      const next = steps[k + 1]?.paths[pid];
      m.cin = !!prev && m.delay === 0;
      m.cout = !!next && next.delay === 0;
    }
  });

  return { states, steps, invalid, carry, sideOf };
}

// Easing for a run. Continuous runs keep their speed across step boundaries.
function moveEase(u, m, flow) {
  if (!flow || (!m.cin && !m.cout)) return ease.inOutSine(u);
  if (m.cin && m.cout) return u;
  if (m.cin) return Math.sin((u * Math.PI) / 2);
  return 1 - Math.cos((u * Math.PI) / 2);
}

function normBall(ball, pos) {
  if (!ball) return { owner: null, x: 52.5, y: 34 };
  if (ball.owner && pos[ball.owner]) return { owner: ball.owner, ...pos[ball.owner] };
  return { owner: null, x: ball.x ?? 52.5, y: ball.y ?? 34 };
}

// Interpolated frame at time t (0..1) within step k.
// Returns { pos: {id: {x,y}}, ball: {x, y, z, owner, moving} }.
export function frameAt(tl, k, t, opts = {}) {
  const s = tl.states[k];
  const st = tl.steps[k];
  if (!st) return { pos: s.pos, ball: ballRest(tl, s, s.pos) };
  const pos = {};
  for (const pid in s.pos) {
    const m = st.paths[pid];
    pos[pid] = m ? m.path.at(moveEase(local(t, m.delay), m, opts.flow)) : s.pos[pid];
  }

  const g = st.ballGeo;
  let ball;
  if (!g) {
    ball = ballRest(tl, s, pos);
  } else if (g.kind === 'dribble') {
    const u = local(t, g.delay);
    const e = moveEase(u, tl.steps[k].paths[g.owner], opts.flow);
    const p = pos[g.owner];
    const dir = g.path.tangentAt(e);
    const sign = attackSign(tl.sideOf[g.owner]);
    // Blend from "ball in front of the player" to "ball ahead along the run" and back,
    // with a light touch rhythm so it reads as a dribble.
    const w = smooth(clamp(u / 0.14, 0, 1)) * smooth(clamp((1 - u) / 0.14, 0, 1));
    const touches = Math.max(2, Math.round(g.path.len / 4.5));
    const reach = tl.carry * (1 + 0.32 * Math.abs(Math.sin(u * Math.PI * touches)) * w);
    const ox = sign * tl.carry * (1 - w) + dir.x * reach * w;
    const oy = dir.y * reach * w;
    ball = { x: p.x + ox, y: p.y + oy, z: 0, owner: g.owner, moving: u > 0 && u < 1 };
  } else {
    if (t <= g.td) {
      ball = g.loose
        ? { ...g.path.p0, z: 0, owner: null, moving: false }
        : { ...carryPoint(pos[g.from], tl.sideOf[g.from], tl.carry), z: 0, owner: g.from, moving: false };
    } else if (t >= g.ta) {
      if (g.receiver) ball = { ...carryPoint(pos[g.receiver], tl.sideOf[g.receiver], tl.carry), z: 0, owner: g.receiver, moving: false };
      else ball = { ...g.path.p2, z: 0, owner: null, moving: false };
    } else {
      const u = (t - g.td) / (g.ta - g.td);
      // Struck balls leave fast and slow down; shots barely slow at all.
      const e = g.kind === 'shot' ? ease.outQuad(u) : 1 - Math.pow(1 - u, 1.7);
      const p = g.path.at(e);
      const z = g.lofted ? g.height * 4 * e * (1 - e) : 0;
      ball = { x: p.x, y: p.y, z, owner: null, moving: true, progress: u };
    }
  }
  return { pos, ball };
}

function ballRest(tl, s, pos) {
  if (s.ball.owner && pos[s.ball.owner]) {
    return { ...carryPoint(pos[s.ball.owner], tl.sideOf[s.ball.owner], tl.carry), z: 0, owner: s.ball.owner, moving: false };
  }
  return { x: s.ball.x, y: s.ball.y, z: 0, owner: null, moving: false };
}

// Duration of a step in seconds at 1x speed.
export const stepSeconds = (tl, k) => tl.steps[k]?.duration ?? 2;

// Sound events that happen in step k between times t0 (exclusive) and t1 (inclusive):
// kicks, first touches, dribble taps, goals and loose-ball bounces.
export function eventsBetween(tl, k, t0, t1) {
  const st = tl.steps[k];
  if (!st || t1 <= t0) return [];
  const out = [];
  const hit = (t) => t > t0 && t <= t1;
  const g = st.ballGeo;
  if (g && (g.kind === 'pass' || g.kind === 'shot')) {
    if (hit(g.td)) out.push({ type: g.kind === 'shot' ? 'shot' : 'kick', height: g.heightKind || 'ground', at: g.td });
    if (hit(g.ta)) {
      const inGoal = g.kind === 'shot' && (g.path.p2.x >= 105 || g.path.p2.x <= 0);
      out.push({ type: inGoal ? 'goal' : g.receiver ? 'touch' : 'bounce', at: g.ta });
    }
  } else if (g && g.kind === 'dribble') {
    const n = Math.max(2, Math.round(g.path.len / 4.5));
    for (let i = 0; i < n; i++) {
      const t = g.delay + ((i + 0.35) / n) * (1 - g.delay);
      if (hit(t)) out.push({ type: 'dribble', at: t });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
