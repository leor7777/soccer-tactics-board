// Tactical analysis. Pure functions: zones, matchup report, role fit, formation ranking.
// Positions are meters; the home team attacks toward x = 105.

import { zoneOf, clamp, PITCH, CHANNEL_NAMES, THIRD_NAMES } from './geometry.js';
import { ROLE_BY_ID, POSITION_ROLE, TAG_BY_ID, roleBase } from './data.js';

export const FIT_LOW = 55;

// ---- Positions ----------------------------------------------------------

export function slotToPoint(s, side) {
  return side === 'away'
    ? { x: PITCH.L * (1 - s.d), y: PITCH.W * (1 - s.w) }
    : { x: PITCH.L * s.d, y: PITCH.W * s.w };
}

export function pointToSlot(p, side) {
  return side === 'away'
    ? { d: 1 - p.x / PITCH.L, w: 1 - p.y / PITCH.W }
    : { d: p.x / PITCH.L, w: p.y / PITCH.W };
}

export function slotsToPoints(slots, side) {
  return slots.map((s, i) => ({ ...slotToPoint(s, side), label: s.label, role: s.role, gk: roleBase(s.role) === 'gk' || i === 0 }));
}

// ---- Zones --------------------------------------------------------------

export function zoneCounts(home, away, opts = {}) {
  const includeGK = !!opts.includeGK;
  const zones = Array.from({ length: 15 }, (_, index) => ({
    index, third: Math.floor(index / 5), channel: index % 5, home: 0, away: 0, diff: 0, homeLabels: [], awayLabels: [], homeIds: [], awayIds: [],
  }));
  const add = (pts, key) => {
    for (const p of pts) {
      if (p.gk && !includeGK) continue;
      const z = zones[zoneOf(p.x, p.y).index];
      z[key]++;
      z[key + 'Labels'].push(p.label);
      z[key + 'Roles'] = (z[key + 'Roles'] || []).concat(roleBase(p.role));
      if (p.id) z[key + 'Ids'].push(p.id);
    }
  };
  add(home, 'home');
  add(away, 'away');
  for (const z of zones) z.diff = z.home - z.away;
  return zones;
}

const sum = (zones, pred, key) => zones.filter(pred).reduce((n, z) => n + z[key], 0);
const pair = (zones, pred) => ({ home: sum(zones, pred, 'home'), away: sum(zones, pred, 'away'), zones: zones.filter(pred).map((z) => z.index) });

export function zoneSummary(zones) {
  return {
    width: pair(zones, (z) => z.channel === 0 || z.channel === 4),
    midfield: pair(zones, (z) => z.third === 1),
    central: pair(zones, (z) => z.third === 1 && z.channel >= 1 && z.channel <= 3),
    front: pair(zones, (z) => z.third === 2),
    back: pair(zones, (z) => z.third === 0),
  };
}

// ---- Matchup report -----------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

function groupName(roles, n, fallback) {
  if (!roles || !roles.length) return plural(n, fallback[0], fallback[1]);
  if (roles.every((r) => r === 'cb')) return plural(n, 'center back', 'center backs');
  if (roles.every((r) => r === 'st' || r === 'tf')) return plural(n, 'striker', 'strikers');
  if (roles.every((r) => r === 'wing')) return plural(n, 'winger', 'wingers');
  if (roles.every((r) => r === 'fb' || r === 'wb')) return plural(n, 'fullback', 'fullbacks');
  return plural(n, fallback[0], fallback[1]);
}

const rolesIn = (zones, idx, key) => idx.flatMap((i) => zones[i][key + 'Roles'] || []);
const labelsIn = (zones, idx, key) => idx.flatMap((i) => zones[i][key + 'Labels']);

export function matchupReport(home, away, opts = {}) {
  const zones = zoneCounts(home, away, opts);
  const summary = zoneSummary(zones);
  const findings = [];
  const push = (tone, title, text, zoneIdx) => findings.push({ tone, title, text, zones: zoneIdx });

  // Midfield battle.
  const m = summary.midfield;
  if (m.home > m.away) push('good', `Midfield ${m.home} v ${m.away}`, `You have the spare player in midfield (${m.home} v ${m.away}). Build through the middle and let the free player turn.`, m.zones);
  else if (m.home < m.away) push('risk', `Midfield ${m.home} v ${m.away}`, `You are short in midfield (${m.home} v ${m.away}). Drop a forward in to help, or go direct and skip their midfield.`, m.zones);
  else push('info', `Midfield ${m.home} v ${m.away}`, `Midfield is even at ${m.home} v ${m.away}. Duels and second balls decide it.`, m.zones);

  const c = summary.central;
  if (c.home !== m.home || c.away !== m.away) {
    if (c.home < c.away) push('risk', `Central midfield ${c.home} v ${c.away}`, `In the central lanes it is ${c.home} v ${c.away}. Tuck a wide player inside when they have the ball.`, c.zones);
    else if (c.home > c.away) push('good', `Central midfield ${c.home} v ${c.away}`, `In the central lanes you are ${c.home} v ${c.away}. Play through the middle before they shift across.`, c.zones);
  }

  // Width.
  const w = summary.width;
  if (w.home > w.away) push('good', `Width ${w.home} v ${w.away}`, `You have more players in the wide channels (${w.home} v ${w.away}). Stretch them and switch play quickly.`, w.zones);
  else if (w.home < w.away) push('risk', `Width ${w.home} v ${w.away}`, `They have more players out wide (${w.away} v ${w.home}). Your wide players must track back or your fullbacks get doubled up.`, w.zones);

  // Front line vs their back line.
  const f = summary.front;
  if (f.home || f.away) {
    const yours = groupName(rolesIn(zones, f.zones, 'home'), f.home, ['attacker', 'attackers']);
    const theirs = groupName(rolesIn(zones, f.zones, 'away'), f.away, ['defender', 'defenders']);
    const head = `Your ${yours} vs their ${theirs}`;
    if (f.home > f.away) push('good', `Front line ${f.home} v ${f.away}`, `${head}. You outnumber their back line, so go direct early.`, f.zones);
    else if (f.home < f.away) push('info', `Front line ${f.home} v ${f.away}`, `${head}. Bring runners from midfield to add numbers in the box.`, f.zones);
    else push('info', `Front line ${f.home} v ${f.away}`, `${head}. Every forward has a marker, so rotate to drag them out of position.`, f.zones);
  }

  // Their forwards vs your back line.
  const b = summary.back;
  if (b.home || b.away) {
    const theirs = groupName(rolesIn(zones, b.zones, 'away'), b.away, ['attacker', 'attackers']);
    const yours = groupName(rolesIn(zones, b.zones, 'home'), b.home, ['defender', 'defenders']);
    const head = `Their ${theirs} vs your ${yours}`;
    const spare = b.home - b.away;
    if (spare >= 2) push('info', `Back line ${b.home} v ${b.away}`, `${head}. You have cover to spare, so one defender can step into midfield.`, b.zones);
    else if (spare === 1) push('good', `Back line ${b.home} v ${b.away}`, `${head}. One spare defender covers runs in behind.`, b.zones);
    else push('risk', `Back line ${b.home} v ${b.away}`, `${head}. No spare defender, so keep a midfielder screening in front of the back line.`, b.zones);
  }

  // Flank by flank, third by third.
  for (let third = 0; third < 3; third++) {
    const L = zones[third * 5], R = zones[third * 5 + 4];
    const sameStory = L.diff !== 0 && Math.sign(L.diff) === Math.sign(R.diff) && L.home === R.home && L.away === R.away;
    const flanks = sameStory ? [[L, R]] : [[L], [R]].filter(([z]) => z.diff !== 0);
    for (const zs of flanks) {
      const z = zs[0];
      const where = zs.length === 2 ? 'both wings' : `the ${CHANNEL_NAMES[z.channel]}`;
      const ids = zs.map((q) => q.index);
      const ours = list([...new Set(labelsIn(zones, ids, 'home'))]);
      const theirs = list([...new Set(labelsIn(zones, ids, 'away'))]);
      const score = `${z.home} v ${z.away}`;
      if (third === 2) {
        if (z.diff > 0) push('good', `Overload: ${where}, final third`, `${score} on ${where} in the final third. Get the ball wide early and isolate ${ours ? 'your ' + ours : 'your wide player'}.`, ids);
        else push('info', `Outnumbered: ${where}, final third`, `${score} on ${where} up front. Push a midfielder or fullback forward to support ${ours ? 'your ' + ours : 'the attack'}.`, ids);
      } else if (third === 1) {
        if (z.diff > 0) push('good', `Overload: ${where}, midfield`, `${score} on ${where} in midfield. Switch play to that side to find the spare player.`, ids);
        else push('risk', `Outnumbered: ${where}, midfield`, `${score} on ${where} in midfield. Their ${theirs || 'wide players'} will be free unless ${ours ? 'your ' + ours : zs.length === 2 ? 'your fullbacks' : 'your fullback'} ${!ours && zs.length === 2 || ours.includes(' and ') ? 'step' : 'steps'} up.`, ids);
      } else {
        if (z.diff < 0) push('risk', `Outnumbered: ${where}, your third`, `${ours ? 'Your ' + ours : 'Your defense'} ${zs.length === 2 || ours.includes(' and ') ? 'are' : 'is'} ${score} on ${where}. Ask your wingers to track back.`, ids);
        else push('info', `Spare defender: ${where}`, `${score} on ${where} at the back. ${zs.length === 2 ? 'Your fullbacks' : 'Your fullback'} can push on with the ball.`, ids);
      }
    }
  }

  return { zones, summary, findings };
}

// ---- Formation features & ranking ---------------------------------------

export function formationFeatures(slots) {
  const pts = slotsToPoints(slots, 'home').filter((p) => !p.gk).map((p) => ({ ...p, role: roleBase(p.role) }));
  const z = pts.map((p) => ({ ...p, ...zoneOf(p.x, p.y) }));
  const wide = (q) => q.channel === 0 || q.channel === 4;
  return {
    back: z.filter((q) => q.third === 0).length,
    mid: z.filter((q) => q.third === 1).length,
    att: z.filter((q) => q.third === 2).length,
    centralMid: z.filter((q) => q.role === 'dm' || q.role === 'b2b' || q.role === 'am').length,
    wideAtt: z.filter((q) => wide(q) && q.x >= PITCH.L * 0.45).length,
    wideDef: z.filter((q) => wide(q) && q.x < PITCH.L * 0.55).length,
    leftAtt: z.some((q) => q.channel === 0 && q.x >= PITCH.L * 0.45),
    rightAtt: z.some((q) => q.channel === 4 && q.x >= PITCH.L * 0.45),
    strikers: z.filter((q) => q.role === 'st' || q.role === 'tf').length,
    dm: z.filter((q) => q.role === 'dm').length,
    cb: z.filter((q) => q.role === 'cb').length,
  };
}

const TAG_RULES = {
  'presses-high': (f) => {
    const d = f.centralMid > 2 ? (f.centralMid - 2) * 5 + (f.dm ? 3 : 0) : -3;
    return [d, d > 0
      ? `They press high: ${f.centralMid} central midfielders give you an extra passing lane through it`
      : `They press high and you only have ${f.centralMid} central midfielders to play through`];
  },
  'sits-deep': (f) => {
    const d = (f.wideAtt - 2) * 3 + (f.att - 2) * 3;
    return [d, `They sit deep: ${f.wideAtt} wide attackers and ${f.att} players in the final third to stretch the block`];
  },
  'long-balls': (f) => {
    const d = (f.cb >= 3 ? 6 : 0) + (f.dm ? 3 : 0) - 2;
    return [d, f.cb >= 3 ? `They go long: three center backs win the first ball, ${f.dm ? 'and a holding midfielder picks up seconds' : 'but no holding midfielder for seconds'}`
      : `They go long: ${f.dm ? 'your holding midfielder helps win second balls' : 'two center backs and no holding midfielder for second balls'}`];
  },
  'plays-out': (f) => {
    const d = (f.att - 2) * 4;
    return [d, `They play out from the back: ${f.att} players up top to press their build-up`];
  },
  'wide-overloads': (f) => {
    const d = (f.wideDef - 2) * 4;
    return [d, `They overload the flanks: ${f.wideDef} wide players in your half to cover them`];
  },
  'weak-left': (f) => [f.rightAtt ? 5 : -2, f.rightAtt ? 'Their left side is weak: you have a wide attacker on your right to target it' : 'Their left side is weak, but you have no wide attacker on your right'],
  'weak-right': (f) => [f.leftAtt ? 5 : -2, f.leftAtt ? 'Their right side is weak: you have a wide attacker on your left to target it' : 'Their right side is weak, but you have no wide attacker on your left'],
  'set-pieces': (f) => {
    const d = (f.cb - 2) * 3;
    return [d, `Set-piece threat: ${plural(f.cb, 'center back', 'center backs')} to defend the box`];
  },
  'slow-cbs': (f) => {
    const d = (f.strikers >= 2 ? 7 : f.strikers === 1 ? 3 : 0) + (f.wideAtt >= 2 ? 2 : 0);
    return [d, `Their center backs are slow: ${plural(f.strikers, 'striker', 'strikers')} can run in behind`];
  },
};

// candidates: [{id, name, slots}]; opponent: {slots, tags}
export function rankFormations(candidates, opponent, opts = {}) {
  const awayPts = slotsToPoints(opponent.slots, 'away');
  const tags = opponent.tags || [];
  const results = candidates.map((cand) => {
    const rep = matchupReport(slotsToPoints(cand.slots, 'home'), awayPts, opts);
    let S = 0;
    for (const z of rep.zones) {
      const weight = z.third === 0 ? (z.diff < 0 ? 1.4 : 0.5) : z.third === 1 ? 1.1 : (z.diff > 0 ? 1.2 : 0.6);
      S += z.diff * weight;
    }
    const reasons = [];
    const base = 50 + S * 3;
    const s = rep.summary;
    const vs = (p) => `${p.home} v ${p.away}`;
    reasons.push({ delta: (s.midfield.home - s.midfield.away) * 3, text: `Midfield ${vs(s.midfield)}` });
    reasons.push({ delta: (s.width.home - s.width.away) * 2, text: `Width ${vs(s.width)}` });
    reasons.push({ delta: (s.front.home - s.front.away) * 2, text: `Front line ${vs(s.front)} against their back line` });

    let tagTotal = 0;
    const f = formationFeatures(cand.slots);
    for (const t of tags) {
      const rule = TAG_RULES[t];
      if (!rule) continue;
      const [raw, text] = rule(f);
      const d = clamp(raw, -10, 10);
      tagTotal += d;
      reasons.push({ delta: d, text, tag: t });
    }
    const score = Math.round(clamp(base + tagTotal, 0, 100));
    reasons.sort((a, b) => (!!b.tag - !!a.tag) || Math.abs(b.delta) - Math.abs(a.delta));
    return { id: cand.id, name: cand.name, score, reasons, report: rep };
  });
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// ---- Role fit -----------------------------------------------------------

const TAG_MODS = {
  'slow-cbs': { st: { pace: 0.2 }, if: { pace: 0.15 }, pf: { pace: 0.15 }, wing: { pace: 0.1 }, tf: { pace: 0.15 } },
  'presses-high': { cb: { passing: 0.15 }, bpd: { passing: 0.1 }, dm: { passing: 0.15 }, dlp: { vision: 0.1 }, gk: { passing: 0.15 }, sk: { passing: 0.1 } },
  'long-balls': { cb: { physical: 0.15 }, bpd: { physical: 0.15 }, dm: { physical: 0.1 } },
  'sits-deep': { am: { vision: 0.1, dribbling: 0.1 }, wing: { dribbling: 0.1 }, if: { shooting: 0.1 }, f9: { vision: 0.1 } },
  'wide-overloads': { fb: { defending: 0.15 }, ifb: { defending: 0.15 }, wb: { defending: 0.15, stamina: 0.05 } },
  'set-pieces': { cb: { physical: 0.15 }, bpd: { physical: 0.15 }, tf: { physical: 0.1 } },
  'plays-out': { st: { stamina: 0.15 }, pf: { stamina: 0.1 }, wing: { stamina: 0.1 }, if: { stamina: 0.1 } },
};

export function modsForTags(tags = []) {
  const out = {};
  for (const t of tags) {
    for (const [role, m] of Object.entries(TAG_MODS[t] || {})) {
      out[role] = out[role] || {};
      for (const [k, v] of Object.entries(m)) out[role][k] = (out[role][k] || 0) + v;
    }
  }
  return out;
}

export function roleFit(player, roleId, mods = {}) {
  const role = ROLE_BY_ID[roleId];
  if (!role || !player) return 0;
  const w = { ...role.w };
  for (const [k, v] of Object.entries(mods[roleId] || {})) w[k] = (w[k] || 0) + v;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  let s = 0;
  for (const [k, v] of Object.entries(w)) s += (v / total) * clamp(player.attrs?.[k] ?? 3, 1, 5);
  const prefBases = (player.positions || []).map((p) => POSITION_ROLE[p]).filter(Boolean);
  const base = role.base;
  if (prefBases.includes(base)) s += 0.35;
  if (base === 'gk' && !prefBases.includes('gk')) s -= 1.6;
  if (base !== 'gk' && prefBases.length && prefBases.every((r) => r === 'gk')) s -= 1.2;
  // 3/5 across the role's key attributes is an average fit; 5/5 is a perfect one.
  return Math.round(clamp((s - 1.8) / 3.2, 0, 1) * 100);
}

export function slotFit(player, slotLike, mods = {}) {
  let fit = roleFit(player, slotLike.role, mods);
  const label = slotLike.label || '';
  if (player?.foot && /^L/.test(label) && (player.foot === 'L' || player.foot === 'B')) fit += 3;
  if (player?.foot && /^R/.test(label) && (player.foot === 'R' || player.foot === 'B')) fit += 3;
  return Math.min(100, fit);
}

export function topRoles(player, n = 3, mods = {}) {
  return Object.keys(ROLE_BY_ID)
    .map((id) => ({ role: id, score: roleFit(player, id, mods) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// Minimum-cost assignment (Hungarian algorithm) for a rectangular cost matrix with
// rows <= cols. Returns result[row] = col.
export function assign(cost) {
  const n = cost.length, m = cost[0]?.length || 0;
  if (!n) return [];
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}

// Best-fit assignment of roster players to formation slots.
export function suggestLineup(slots, roster, tags = []) {
  const mods = modsForTags(tags);
  const pool = roster.filter((p) => p.available !== false);
  const out = slots.map((s, i) => ({ slotIndex: i, label: s.label, role: s.role, player: null, fit: 0 }));
  if (!pool.length) return { lineup: out, average: 0 };
  const fits = slots.map((s) => pool.map((p) => slotFit(p, s, mods)));
  // Pad with empty "players" so there are at least as many columns as slots.
  const cols = Math.max(pool.length, slots.length);
  const cost = fits.map((row) => Array.from({ length: cols }, (_, j) => (j < row.length ? 100 - row[j] : 100)));
  const pick = assign(cost);
  pick.forEach((j, i) => { if (j >= 0 && j < pool.length) out[i] = { ...out[i], player: pool[j], fit: fits[i][j] }; });
  const filled = out.filter((o) => o.player);
  return { lineup: out, average: filled.length ? Math.round(filled.reduce((a, o) => a + o.fit, 0) / filled.length) : 0 };
}

// How closely a set of outfield positions matches a shape (0-100), using the best
// one-to-one pairing of players to slots.
export function shapeSimilarity(points, slots, side = 'home') {
  const pts = points.filter((p) => !p.gk);
  const target = slotsToPoints(slots, side).filter((p) => !p.gk);
  if (!pts.length || pts.length !== target.length) return 0;
  const cost = pts.map((a) => target.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
  const pick = assign(cost);
  const mean = pick.reduce((acc, j, i) => acc + cost[i][j], 0) / pts.length;
  // Players' roles count too: a plain 4-3-3 isn't a 100% match for a side that uses
  // inverted fullbacks or a false nine in the same spots.
  const roleMiss = pick.reduce((n, j, i) => n + (pts[i].role && target[j].role && pts[i].role !== target[j].role ? 1 : 0), 0);
  return Math.round(clamp(Math.min(100, 100 - (mean - 1.5) * 6) - roleMiss * 2.5, 0, 100));
}

export function shadesOf(points, systems, side = 'home', n = 3) {
  return systems
    .map((sys) => ({ system: sys, similarity: shapeSimilarity(points, sys.slots, side) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, n);
}

// Rank systems by how well a squad fits them.
export function squadSystemFit(roster, candidates, tags = []) {
  return candidates
    .map((c) => {
      const { lineup, average } = suggestLineup(c.slots, roster, tags);
      const weakest = lineup.filter((l) => l.player).sort((a, b) => a.fit - b.fit)[0] || null;
      const gaps = lineup.filter((l) => !l.player || l.fit < FIT_LOW);
      return { id: c.id, candidate: c, average, lineup, weakest, gaps };
    })
    .sort((a, b) => b.average - a.average);
}

// ---- Formation optimizer --------------------------------------------------
// Scores every candidate shape on three things:
//   matchup  - zone overloads against the opponent's shape plus tendency tags
//   squad    - how well your best XI fits the shape's roles (attributes)
//   exploit  - how your players' attributes line up against the opponent's ratings
const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);

export function optimizeFormation(candidates, { roster = [], opponent = {} } = {}) {
  const tags = opponent.tags || [];
  const R = { blPace: 3, blAir: 3, midControl: 3, press: 3, attPace: 3, wide: 3, ...(opponent.ratings || {}) };
  const ranked = rankFormations(candidates, { slots: opponent.slots, tags });
  const byId = Object.fromEntries(ranked.map((r) => [r.id, r]));
  const pool = roster.filter((p) => p.available !== false);
  const hasSquad = pool.length >= 11;

  return candidates.map((c) => {
    const base = byId[c.id];
    const lu = hasSquad ? suggestLineup(c.slots, roster, tags) : null;
    const xi = lu ? lu.lineup.filter((l) => l.player) : [];
    const avg = (roles, attr) => {
      const xs = xi.filter((l) => roles.includes(l.role) || roles.includes(roleBase(l.role))).map((l) => l.player.attrs?.[attr] ?? 3);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 3;
    };
    const f = formationFeatures(c.slots);
    const hasTF = c.slots.some((sl) => sl.role === 'tf');
    const ex = [];
    const add = (delta, text) => { if (Math.round(delta) !== 0) ex.push({ delta: Math.round(delta), text, kind: 'exploit' }); };

    if (R.blPace <= 2) {
      const pace = avg(['st', 'wing', 'if', 'pf', 'f9', 'tf'], 'pace');
      add((pace - R.blPace) * 3 + (f.strikers >= 2 ? 2 : 0), `Their back line is slow (${R.blPace}/5); your forwards average ${fmt(pace)} pace`);
    } else if (R.blPace >= 4) {
      const pace = avg(['st', 'wing', 'if', 'pf', 'f9', 'tf'], 'pace');
      add((pace - R.blPace) * 2, `Their defenders are quick (${R.blPace}/5); runs in behind are harder`);
    }
    if (R.blAir !== 3) {
      const crossers = f.wideAtt >= 2;
      if (R.blAir <= 2) add((3 - R.blAir) * ((hasTF || f.strikers >= 2) && crossers ? 3 : 1.2), `They are weak in the air (${R.blAir}/5); ${hasTF ? 'a target forward and ' : ''}${f.wideAtt} wide players to cross`);
      else add(-(R.blAir - 3) * (hasTF ? 2.5 : 1), `They dominate in the air (${R.blAir}/5); keep the ball on the ground`);
    }
    if (R.midControl >= 4) {
      const pass = avg(['dm', 'dlp', 'b2b', 'am'], 'passing');
      add((f.centralMid - 3) * 4 + (pass - 3) * 2, `They control midfield (${R.midControl}/5); ${f.centralMid} central midfielders averaging ${fmt(pass)} passing`);
    } else if (R.midControl <= 2) {
      add((f.att - 2) * 2, `Their midfield is weak (${R.midControl}/5); commit ${f.att} players to the final third`);
    }
    if (R.press >= 4) {
      const pass = avg(['cb', 'bpd', 'dm', 'dlp', 'gk', 'sk'], 'passing');
      add((pass - 3) * 3 + (f.centralMid >= 3 ? 2 : -2) + (f.strikers >= 2 ? 1 : 0), `They press hard (${R.press}/5); your build-up players average ${fmt(pass)} passing`);
    } else if (R.press <= 2) {
      add(f.centralMid >= 3 ? 2 : 1, `They barely press (${R.press}/5); you can build slowly from the back`);
    }
    if (R.attPace >= 4) {
      const pace = avg(['cb', 'bpd'], 'pace');
      add((pace - R.attPace) * 3 + (f.back >= 5 ? 3 : 0), `Their forwards are fast (${R.attPace}/5); your center backs average ${fmt(pace)} pace`);
    } else if (R.attPace <= 2) {
      add(1, `Their forwards are slow (${R.attPace}/5); you can hold a higher line`);
    }
    if (R.wide >= 4) {
      const def = avg(['fb', 'wb', 'ifb'], 'defending');
      add((f.wideDef - 2) * 2 + (def - 3) * 2, `They are dangerous out wide (${R.wide}/5); ${f.wideDef} wide defenders averaging ${fmt(def)} defending`);
    } else if (R.wide <= 2) {
      add(f.centralMid - 2, `They have little width (${R.wide}/5); you can stay narrow`);
    }

    const exploit = Math.round(clamp(50 + ex.reduce((a, r) => a + r.delta, 0) * 4, 0, 100));
    const matchup = base ? base.score : 50;
    const squad = lu ? lu.average : null;
    const total = Math.round(squad == null ? 0.6 * matchup + 0.4 * exploit : 0.4 * matchup + 0.35 * squad + 0.25 * exploit);
    const reasons = [...ex, ...(base ? base.reasons : [])].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    if (lu) {
      const weak = lu.lineup.filter((l) => l.player && l.fit < FIT_LOW);
      reasons.unshift({ delta: Math.round((lu.average - 65) / 3), text: weak.length ? `Squad fit ${lu.average}; weak spots at ${weak.map((w) => w.label).join(', ')}` : `Squad fit ${lu.average}; every role filled well`, kind: 'squad' });
    }
    return { id: c.id, name: c.name, total, parts: { matchup, squad, exploit }, reasons, lineup: lu ? lu.lineup : null, average: lu ? lu.average : null };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export const tagName = (id) => TAG_BY_ID[id]?.name || id;
export { THIRD_NAMES, CHANNEL_NAMES };
