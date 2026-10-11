// Set-piece templates. Each template places the ball and lists spots for both teams;
// players are matched to spots by role (best fit first) using the assignment solver.
// Coordinates are meters with your team attacking toward x = 105.

import { assign } from './analysis.js';
import { roleBase } from './data.js';
import { separate } from './geometry.js';
import { uid, newStep } from './sample.js';

const S = (x, y, prefer = [], extra = {}) => ({ x, y, prefer, ...extra });
const GKS = (x, y) => S(x, y, ['gk'], { gk: true });
const AIR = ['cb', 'tf', 'st'];
const MID = ['b2b', 'dm', 'dlp', 'am'];
const WIDE = ['wing', 'if', 'wb', 'fb'];
const BACK = ['cb', 'fb', 'dm'];

const CORNER_ATT = {
  ball: { x: 104.6, y: 0.6 },
  home: [GKS(6, 34), S(104.3, 1.3, ['wing', 'am', 'if', 'wb'], { taker: true }),
    S(99.5, 29, AIR), S(100.5, 34, AIR), S(99, 40.5, AIR), S(93.5, 33, AIR), S(88, 37, MID), S(99, 7.5, WIDE), S(87, 26, MID),
    S(62, 26, BACK), S(62, 44, BACK)],
  away: [GKS(104, 34), S(103.6, 30.6, WIDE),
    S(100, 30, AIR), S(100, 34, AIR), S(100, 38, AIR), S(95.5, 29.5, BACK), S(95, 35.5, BACK), S(95.5, 41, MID), S(88.5, 31, MID),
    S(97.5, 10, WIDE), S(68, 34, ['st', 'tf', 'pf'])],
};

const mirrorY = (t) => ({
  ball: { x: t.ball.x, y: 68 - t.ball.y },
  home: t.home.map((p) => ({ ...p, y: 68 - p.y })),
  away: t.away.map((p) => ({ ...p, y: 68 - p.y })),
});
// Swap roles: the opponent takes the set piece toward your goal.
const defending = (t) => ({
  ball: { x: 105 - t.ball.x, y: t.ball.y },
  home: t.away.map((p) => ({ ...p, x: 105 - p.x })),
  away: t.home.map((p) => ({ ...p, x: 105 - p.x })),
  takerSide: 'away',
});

export const SET_PIECE_TYPES = [
  {
    id: 'corner-left', name: 'Corner (left)', group: 'Attacking', ...CORNER_ATT,
  },
  { id: 'corner-right', name: 'Corner (right)', group: 'Attacking', ...mirrorY(CORNER_ATT) },
  {
    id: 'fk-wide', name: 'Free kick (wide)', group: 'Attacking',
    ball: { x: 86, y: 10 },
    home: [GKS(6, 34), S(86.6, 9.3, ['wing', 'am', 'if', 'dlp'], { taker: true }),
      S(89, 24, AIR), S(90, 30, AIR), S(89, 36, AIR), S(90, 42, AIR), S(84, 37, MID), S(80, 28, MID), S(80, 6, WIDE),
      S(60, 26, BACK), S(60, 44, BACK)],
    away: [GKS(102, 34), S(91.7, 17.1, MID), S(90.8, 17.8, MID),
      S(92.5, 26, AIR), S(93, 31, AIR), S(92.5, 36, AIR), S(93, 41, AIR), S(86, 34, MID), S(82, 21, WIDE), S(88, 46, WIDE),
      S(66, 30, ['st', 'tf', 'pf'])],
  },
  {
    id: 'fk-central', name: 'Free kick (shooting)', group: 'Attacking',
    ball: { x: 82, y: 34 },
    home: [GKS(6, 34), S(81.3, 33.2, ['am', 'if', 'wing', 'st'], { taker: true }), S(81.4, 35.4, ['st', 'if', 'wing', 'am']),
      S(91, 27, AIR), S(91, 41, AIR), S(89, 23, AIR), S(90.5, 31, MID), S(86, 46, MID),
      S(60, 28, BACK), S(60, 40, BACK), S(74, 18, WIDE)],
    away: [GKS(104.4, 33), S(91.2, 31.9, AIR), S(91.2, 32.8, AIR), S(91.2, 33.7, MID), S(91.2, 34.6, MID),
      S(96, 26, BACK), S(96, 42, BACK), S(94, 28.5, BACK), S(94, 39.5, BACK), S(85, 42, MID), S(65, 34, ['st', 'tf', 'pf'])],
  },
  {
    id: 'penalty', name: 'Penalty', group: 'Attacking',
    ball: { x: 94, y: 34 },
    home: [GKS(6, 34), S(93.1, 34, ['st', 'am', 'if', 'tf'], { taker: true }),
      S(87.5, 25.5, AIR), S(87.5, 42.5, AIR), S(84.2, 29.5, MID), S(84.2, 38.5, MID),
      S(60, 30, BACK), S(60, 40, BACK), S(70, 20, WIDE), S(70, 48, WIDE), S(75, 34, MID)],
    away: [GKS(104.8, 34), S(87.5, 28.5, AIR), S(87.5, 39.5, AIR), S(83.5, 33, MID), S(83.5, 25, MID),
      S(70, 30, BACK), S(70, 40, BACK), S(55, 34, ['st', 'tf']), S(60, 20, WIDE), S(60, 48, WIDE), S(80, 52, MID)],
  },
  {
    id: 'throw-in', name: 'Throw-in (final third)', group: 'Attacking',
    ball: { x: 80, y: 0.2 },
    home: [GKS(6, 34), S(80, 0.4, ['fb', 'wb'], { taker: true }),
      S(84, 6, WIDE), S(76, 6.5, MID), S(88, 10, ['st', 'if', 'pf']), S(82, 15, MID),
      S(95, 30, AIR), S(93, 38, AIR), S(60, 25, BACK), S(55, 40, BACK), S(70, 30, MID)],
    away: [GKS(103, 34), S(85.5, 4.5, WIDE), S(77, 9.5, MID), S(89.5, 13, BACK), S(83.5, 18, MID),
      S(95.5, 27, AIR), S(96, 35, AIR), S(92, 22, BACK), S(88, 40, MID), S(70, 20, WIDE), S(60, 34, ['st', 'tf', 'pf'])],
  },
  {
    id: 'kick-off', name: 'Kick-off', group: 'Restart',
    ball: { x: 52.5, y: 34 },
    home: [GKS(5, 34), S(25, 10, ['fb', 'wb']), S(24, 26, ['cb']), S(24, 42, ['cb']), S(25, 58, ['fb', 'wb']),
      S(40, 24, MID), S(40, 44, MID), S(50, 10, WIDE), S(50, 58, WIDE), S(52.1, 34, ['st', 'tf', 'f9'], { taker: true }), S(50.6, 38.5, ['am', 'if', 'st'])],
    away: [GKS(100, 34), S(80, 10, ['fb', 'wb']), S(80, 26, ['cb']), S(80, 42, ['cb']), S(80, 58, ['fb', 'wb']),
      S(66, 18, MID), S(66, 34, MID), S(66, 50, MID), S(63, 25, ['st', 'tf']), S(63, 43, ['st', 'am']), S(58, 60, WIDE)],
  },
  {
    id: 'goal-kick', name: 'Goal kick (build-up)', group: 'Restart',
    ball: { x: 4.8, y: 30 },
    home: [GKS(4.8, 30.5), S(14, 18, ['cb', 'bpd']), S(14, 50, ['cb', 'bpd']), S(20, 34, ['dm', 'dlp']),
      S(30, 4, ['fb', 'wb']), S(30, 64, ['fb', 'wb']), S(38, 26, MID), S(38, 42, MID), S(55, 8, WIDE), S(55, 60, WIDE), S(62, 34, ['st', 'tf'])],
    away: [GKS(100, 34), S(18, 26, ['st', 'pf']), S(18, 42, ['st', 'tf']), S(28, 12, WIDE), S(28, 56, WIDE),
      S(40, 30, MID), S(40, 40, MID), S(45, 10, ['fb', 'wb']), S(45, 58, ['fb', 'wb']), S(58, 28, ['cb']), S(58, 40, ['cb'])],
    homeTaker: 'gk',
  },
  { id: 'defend-corner', name: 'Defend a corner', group: 'Defending', ...defending(CORNER_ATT) },
  { id: 'defend-fk', name: 'Defend a free kick', group: 'Defending' },
];
// Fill in the free-kick defending template from the shooting free kick.
Object.assign(SET_PIECE_TYPES.find((t) => t.id === 'defend-fk'), defending(SET_PIECE_TYPES.find((t) => t.id === 'fk-central')));

// ---- Spot-based templates ----------------------------------------------------
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

// Free kick from any spot in the attacking half. Close and central: shooting set-up with
// a wall sized by distance. Wide or deep: a delivery with runners on the defensive line.
export function freeKickAt(bx, by) {
  bx = clampN(bx, 52.5, 104); by = clampN(by, 0.5, 67.5);
  const dx = 105 - bx, dy = 34 - by, d = Math.hypot(dx, dy);
  const u = { x: dx / d, y: dy / d }, n = { x: -u.y, y: u.x };
  const at = (k, m) => ({ x: bx + u.x * k + n.x * m, y: by + u.y * k + n.y * m });
  const side = by < 34 ? -1 : 1;
  if (d <= 32 && Math.abs(dy) <= 18 && bx >= 75) {
    const walls = d < 22 ? 5 : d < 28 ? 4 : 3;
    const wallPts = Array.from({ length: walls }, (_, i) => at(9.15, (i - (walls - 1) / 2) * 0.85));
    const end = at(9.15, ((walls - 1) / 2 * 0.85 + 1.9) * (dy >= 0 ? 1 : -1));
    const t = at(-0.9, 0.5), dum = at(-0.9, -0.7);
    const home = [GKS(6, 34), S(t.x, t.y, ['am', 'if', 'wing', 'st'], { taker: true }), S(dum.x, dum.y, ['st', 'if', 'wing', 'am']),
      S(Math.max(bx + 4, 90), 26, AIR), S(Math.max(bx + 4, 90), 42, AIR), S(93, by < 34 ? 40 : 28, AIR), S(end.x, end.y, MID),
      S(Math.max(bx - 5, 60), clampN(by - side * 10, 4, 64), MID), S(60, 26, BACK), S(60, 42, BACK), S(bx - 2, clampN(by + side * 12, 3, 65), WIDE)];
    const fill = [S(95, 26, BACK), S(95, 42, BACK), S(93.5, 31, AIR), S(93.5, 37, AIR), S(86, 40, MID), S(86, 28, MID), S(65, 34, ['st', 'tf', 'pf'])];
    const away = [GKS(104.4, clampN(34 - side * 1.2, 31, 37)), ...wallPts.map((p) => S(p.x, p.y, MID.concat(AIR))), ...fill.slice(0, 10 - walls)];
    return { ball: { x: bx, y: by }, home, away, mode: 'shooting', wall: walls };
  }
  const L = clampN(Math.max(bx + 14, 88), 88, 94);
  const home = [GKS(6, 34), S(bx - 0.6, by - side * 0.6, ['wing', 'am', 'dlp', 'if', 'fb'], { taker: true }),
    S(L - 1, 25, AIR), S(L - 1, 30, AIR), S(L - 1, 34.5, AIR), S(L - 1, 39, AIR), S(L - 1, 43.5, MID),
    S(clampN(bx + n.x * 5, 53, 103), clampN(by + n.y * 5, 2, 66), WIDE), S(L - 9, 34, MID), S(Math.min(bx - 12, 58), 26, BACK), S(Math.min(bx - 12, 58), 42, BACK)];
  const wall = d < 40 ? [at(9.15, 0.45), at(9.15, -0.45)] : [];
  const pool = [S(L + 1, 24, AIR), S(L + 1, 29, AIR), S(L + 1, 34, AIR), S(L + 1, 39, AIR), S(L + 1, 44, AIR), S(L - 6, 34, MID), S(Math.max(bx - 18, 52), 34, ['st', 'tf', 'pf']), S(L + 4, 34, AIR), S(L - 4, by < 34 ? 18 : 50, WIDE), S(98, 34, AIR)];
  const away = [GKS(102, 34), ...wall.map((p) => S(p.x, p.y, MID)), ...pool.slice(0, 10 - wall.length)];
  return { ball: { x: bx, y: by }, home, away, mode: 'delivery', wall: wall.length };
}

// Long throw from the touchline in the final third.
export function longThrowAt(bx, top) {
  bx = clampN(bx, 70, 103);
  const t = {
    ball: { x: bx, y: 0.3 },
    home: [GKS(6, 34), S(bx, 0.5, ['cb', 'fb', 'wb', 'tf'], { taker: true }),
      S(100, 28.5, ['tf', 'cb', 'st']), S(101.5, 33, AIR), S(100.5, 37.5, AIR), S(98, 43, AIR), S(94, 34, AIR),
      S(88, 34, MID), S(Math.min(bx + 3, 102), 6, WIDE), S(60, 26, BACK), S(60, 42, BACK)],
    away: [GKS(104, 34), S(103.5, 30.5, WIDE), S(100, 30, AIR), S(100, 34, AIR), S(100, 38, AIR),
      S(95.5, 29.5, BACK), S(95, 35.5, BACK), S(95.5, 41, MID), S(88.5, 31, MID), S(Math.min(bx + 2, 101), 9, WIDE), S(68, 34, ['st', 'tf', 'pf'])],
  };
  return top ? t : mirrorY(t);
}

SET_PIECE_TYPES.push(
  { id: 'fk-spot', name: 'Free kick (pick the spot)', group: 'Attacking', pick: 'fk', defaultSpot: { x: 80, y: 22 } },
  { id: 'long-throw', name: 'Long throw', group: 'Attacking', pick: 'throw', defaultSpot: { x: 90, y: 0 } },
);

export function templateFor(typeId, spot) {
  const t = SET_PIECE_BY_ID[typeId];
  if (t.pick === 'fk') return { ...t, ...freeKickAt((spot || t.defaultSpot).x, (spot || t.defaultSpot).y) };
  if (t.pick === 'throw') { const sp = spot || t.defaultSpot; return { ...t, ...longThrowAt(sp.x, sp.y < 34) }; }
  return t;
}

export const SET_PIECE_BY_ID = Object.fromEntries(SET_PIECE_TYPES.map((t) => [t.id, t]));

function placeTeam(players, spots) {
  const cost = spots.map((sp) => players.map((p) => {
    const isGK = p.gk || roleBase(p.role) === 'gk';
    if (!!sp.gk !== isGK) return 1e4;
    const i = sp.prefer.indexOf(p.role) >= 0 ? sp.prefer.indexOf(p.role) : sp.prefer.indexOf(roleBase(p.role));
    return (i < 0 ? 14 : i * 2) + Math.hypot(p.x - sp.x, p.y - sp.y) * 0.02;
  }));
  const pick = assign(cost);
  const out = {};
  let taker = null;
  pick.forEach((pi, si) => {
    if (pi < 0) return;
    out[players[pi].id] = { x: spots[si].x, y: spots[si].y };
    if (spots[si].taker) taker = players[pi].id;
  });
  return { pos: out, taker };
}

// Build a set-piece play for the current plan's players.
export function buildSetPiece(typeId, plan, name, spot) {
  const t = templateFor(typeId, spot);
  const home = placeTeam(plan.teams.home.players, t.home);
  const away = placeTeam(plan.teams.away.players, t.away);
  // Keep opponents from standing on top of your players (except deliberate walls).
  // Opponents of the taking team must give the ball its legal distance.
  const gap = { corner: 9.15, fk: 9.15, defend: 9.15, throw: 2, kick: 9.15 }[t.id.split('-')[0]] || 0;
  const defenders = t.takerSide === 'away' ? home.pos : away.pos;
  if (gap) {
    for (const id in defenders) {
      const p = defenders[id];
      const d = Math.hypot(p.x - t.ball.x, p.y - t.ball.y);
      if (d < gap && d > 0.01) {
        const k = (gap + 0.3) / d;
        defenders[id] = { x: Math.min(104.5, Math.max(0.5, t.ball.x + (p.x - t.ball.x) * k)), y: Math.min(67.5, Math.max(0.5, t.ball.y + (p.y - t.ball.y) * k)) };
      }
    }
  }
  const awayIds = Object.keys(away.pos);
  const sep = separate(awayIds.map((id) => ({ id, ...away.pos[id] })), Object.values(home.pos), 1.6)
    .map((p) => (gap && t.takerSide !== 'away' && Math.hypot(p.x - t.ball.x, p.y - t.ball.y) < gap ? { ...p, ...away.pos[p.id] } : p));
  sep.forEach((p) => { away.pos[p.id] = { x: p.x, y: p.y }; });
  // Keep everyone on the pitch (a wall near the goal stands on the line).
  for (const pos of [home.pos, away.pos]) for (const id in pos) pos[id] = { x: Math.min(104.8, Math.max(0.2, pos[id].x)), y: Math.min(67.8, Math.max(0.2, pos[id].y)) };
  // The ball starts on its spot; the taker stands next to it and collects it as a loose ball.
  return {
    id: uid('sp_'),
    name: name || t.name,
    kind: 'setpiece',
    spType: t.id,
    spot: spot || null,
    notes: '',
    start: { pos: { ...home.pos, ...away.pos }, ball: { owner: null, ...t.ball } },
    steps: [newStep(2.2)],
  };
}

// Id of the player standing closest to a spot at the start of a set piece.
export function idAt(play, x, y) {
  let best = null, bd = Infinity;
  for (const [id, p] of Object.entries(play.start.pos)) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

// Example routine shown on first open: a near-post flick-on from a left corner.
export function sampleSetPieces(plan) {
  if (!plan) return [];
  const play = buildSetPiece('corner-left', plan, 'Corner: near-post flick-on (example)');
  const taker = idAt(play, 104.3, 1.3), runner = idAt(play, 93.5, 33), far = idAt(play, 99, 40.5), six = idAt(play, 100.5, 34), edge = idAt(play, 88, 37);
  const A = (type, from, extra) => ({ id: uid('ac_'), type, from, to: null, target: null, curve: 0, delay: 0, lofted: false, move: false, color: null, ...extra });
  play.steps = [
    { id: uid('st_'), duration: 2, caption: 'Spot runner attacks the near post as the corner is whipped in', actions: [
      A('run', runner, { target: { x: 99.8, y: 30.5 }, curve: 2.5 }),
      A('pass', taker, { target: { x: 99.8, y: 30.5 }, lofted: true, curve: -3 }),
      A('run', far, { target: { x: 101.5, y: 37.5 } }),
      A('run', six, { target: { x: 102.6, y: 33.4 } }),
    ] },
    { id: uid('st_'), duration: 1.4, caption: 'Flick it on across the six-yard box', actions: [
      A('pass', runner, { to: far, lofted: true }),
      A('run', edge, { target: { x: 95, y: 38 } }),
    ] },
    { id: uid('st_'), duration: 1.4, caption: 'Back-post finish', actions: [
      A('shot', far, { target: { x: 106.1, y: 35.6 } }),
    ] },
  ];
  return [play];
}
