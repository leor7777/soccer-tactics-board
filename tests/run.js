// Unit tests for the pure modules. Run with macOS JavaScriptCore:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/run.js
// or open tests/index.html in a browser.

import { separate, dist, zoneOf, makePath, viewMatrix, applyM, invertM, handlePoint, curveFromHandle, CHANNELS } from '../js/geometry.js';
import { FORMATIONS, ROLE_BY_ID, PROFILES } from '../js/data.js';
import { SYSTEMS } from '../js/systems.js';
import { optimizeFormation, assign, shapeSimilarity, shadesOf, squadSystemFit, slotsToPoints, zoneCounts, matchupReport, roleFit, topRoles, rankFormations, suggestLineup, formationFeatures } from '../js/analysis.js';
import { buildTimeline, frameAt, RECEIVE_RADIUS, eventsBetween } from '../js/playback.js';
import { SET_PIECE_TYPES, buildSetPiece } from '../js/setpieces.js';
import { defendStep, PRESS, spaceControl } from '../js/defense.js';
import { makeSampleWorkspace } from '../js/sample.js';

const log = typeof print === 'function' ? print : console.log;
let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push({ name, ok: true }); log(`  ok  ${name}`); }
  catch (e) { failed++; results.push({ name, ok: false, err: e.message }); log(`FAIL  ${name}\n      ${e.message}`); }
}
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.05, msg = '') => { if (Math.abs(a - b) > tol) throw new Error(`${msg} expected ~${b}, got ${a}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
const F = Object.fromEntries(FORMATIONS.map((f) => [f.id, f]));

// ---- geometry
test('zoneOf: corners and channel edges', () => {
  eq(zoneOf(0, 0).index, 0);
  eq(zoneOf(104.9, 67.9).index, 14);
  eq(zoneOf(52.5, 34).index, 7, 'center spot');
  eq(zoneOf(10, CHANNELS[1] - 0.01).channel, 0);
  eq(zoneOf(10, CHANNELS[1]).channel, 1);
  eq(zoneOf(35, 34).third, 1, 'x = 35 starts the middle third');
  eq(zoneOf(70, 34).third, 2);
});

test('path arc length and endpoints', () => {
  const p = makePath({ x: 0, y: 0 }, { x: 30, y: 40 }, 0);
  near(p.len, 50, 0.01);
  near(p.at(0.5).x, 15, 0.01);
  const c = makePath({ x: 0, y: 0 }, { x: 20, y: 0 }, 5);
  ok(c.len > 20, 'curved path is longer than chord');
  near(c.at(1).x, 20, 0.01);
});

test('curve handle round-trips', () => {
  const a = { x: 10, y: 10 }, b = { x: 40, y: 22 };
  const h = handlePoint(a, b, 6.5);
  near(curveFromHandle(a, b, h), 6.5, 1e-9);
  const p = makePath(a, b, 6.5);
  const mid = p.at(0.5);
  near(Math.hypot(mid.x - h.x, mid.y - h.y), 0, 0.6, 'path passes near its handle');
});

test('view matrices invert for every orientation', () => {
  for (const o of ['h', 'v']) for (const f of [false, true]) {
    const m = viewMatrix(o, f), inv = invertM(m);
    const p = { x: 17.2, y: 51.3 };
    const back = applyM(inv, applyM(m, p));
    near(back.x, p.x, 1e-9); near(back.y, p.y, 1e-9);
  }
  const v = viewMatrix('v', false);
  ok(applyM(v, { x: 105, y: 34 }).y < applyM(v, { x: 0, y: 34 }).y, 'vertical: home attacks up the screen');
});

// ---- zones & matchup
test('every formation has 11 slots, a goalkeeper first, valid roles and a profile', () => {
  for (const f of FORMATIONS) {
    eq(f.slots.length, 11, f.id); eq(f.slots[0].role, 'gk', f.id);
    for (const sl of f.slots) ok(ROLE_BY_ID[sl.role], `${f.id} ${sl.label} role ${sl.role}`);
    ok(PROFILES[f.id], `${f.id} profile`);
    eq(new Set(f.slots.map((x) => x.label)).size, 11, `${f.id} unique labels`);
  }
  ok(FORMATIONS.length >= 30, `formations: ${FORMATIONS.length}`);
  ok(FORMATIONS.some((f) => f.id === '4-3-2-1'));
});

test('zoneCounts excludes goalkeepers by default', () => {
  const home = slotsToPoints(F['4-4-2'].slots, 'home');
  const away = slotsToPoints(F['4-4-2'].slots, 'away');
  const z = zoneCounts(home, away);
  eq(z.reduce((n, q) => n + q.home, 0), 10);
  eq(z.reduce((n, q) => n + q.away, 0), 10);
  const z2 = zoneCounts(home, away, { includeGK: true });
  eq(z2.reduce((n, q) => n + q.home + q.away, 0), 22);
});

test('mirror match: 4-4-2 v 4-4-2 is even overall', () => {
  const r = matchupReport(slotsToPoints(F['4-4-2'].slots, 'home'), slotsToPoints(F['4-4-2'].slots, 'away'));
  eq(r.summary.width.home, r.summary.width.away);
  eq(r.summary.midfield.home, r.summary.midfield.away);
});

test('4-3-3 v 3-5-2: wing overload and midfield shortfall', () => {
  const r = matchupReport(slotsToPoints(F['4-3-3'].slots, 'home'), slotsToPoints(F['3-5-2'].slots, 'away'));
  const s = r.summary;
  eq(s.width.home, 4, 'home wide players'); eq(s.width.away, 2, 'away wide players');
  eq(s.midfield.home, 3, 'home midfield'); eq(s.midfield.away, 5, 'away midfield');
  eq(s.front.home, 3, 'home front line'); eq(s.front.away, 3, 'their back three');
  // Final-third wings: home winger 1 v 0 on both sides.
  eq(r.zones[10].diff, 1, 'final third left wing'); eq(r.zones[14].diff, 1, 'final third right wing');
  ok(r.findings.some((f) => f.tone === 'good' && /Width 4 v 2/.test(f.title)), 'width finding');
  ok(r.findings.some((f) => f.tone === 'risk' && /Midfield 3 v 5/.test(f.title)), 'midfield finding');
  ok(r.findings.some((f) => /3 center backs/.test(f.text)), 'names their center backs');
});

test('matchup report: every finding has one plain line and zones', () => {
  for (const a of FORMATIONS) for (const b of FORMATIONS) {
    const r = matchupReport(slotsToPoints(a.slots, 'home'), slotsToPoints(b.slots, 'away'));
    for (const f of r.findings) { ok(f.text && !f.text.includes('undefined'), `${a.id} v ${b.id}: ${f.text}`); ok(Array.isArray(f.zones)); }
  }
});

// ---- roles
const winger = { id: 'w', attrs: { pace: 5, shooting: 3, passing: 3, dribbling: 5, vision: 3, defending: 1, physical: 2, stamina: 3, goalkeeping: 1 }, positions: ['LW'] };
const anchor = { id: 'a', attrs: { pace: 2, shooting: 2, passing: 4, dribbling: 2, vision: 3, defending: 5, physical: 4, stamina: 4, goalkeeping: 1 }, positions: ['CDM'] };
const keeper = { id: 'k', attrs: { pace: 2, shooting: 1, passing: 3, dribbling: 1, vision: 3, defending: 2, physical: 4, stamina: 3, goalkeeping: 5 }, positions: ['GK'] };

test('role fit: wingers fit winger, anchors fit DM', () => {
  ok(roleFit(winger, 'wing') > roleFit(winger, 'cb'), 'winger');
  ok(roleFit(anchor, 'dm') > roleFit(anchor, 'wing'), 'anchor');
  ok(['wing', 'if'].includes(topRoles(winger)[0].role), 'winger top role');
  ok(roleFit(winger, 'gk') < 30, 'outfield player is a poor goalkeeper');
  ok(['gk', 'sk'].includes(topRoles(keeper)[0].role), 'keeper top role');
});

test('fit scores stay within 0..100', () => {
  const lo = { attrs: Object.fromEntries(['pace','shooting','passing','dribbling','vision','defending','physical','stamina','goalkeeping'].map((k) => [k, 1])) };
  const hi = { attrs: Object.fromEntries(['pace','shooting','passing','dribbling','vision','defending','physical','stamina','goalkeeping'].map((k) => [k, 5])), positions: ['ST'] };
  for (const r of ['gk', 'sk', 'cb', 'bpd', 'ifb', 'dlp', 'st', 'f9', 'wing', 'if']) { ok(roleFit(lo, r) >= 0); ok(roleFit(hi, r) <= 100); }
});

// ---- suggestions
test('ranking: presses high + slow center backs gives ranked list with reasons', () => {
  const ranked = rankFormations(FORMATIONS, { slots: F['4-4-2'].slots, tags: ['presses-high', 'slow-cbs'] });
  eq(ranked.length, FORMATIONS.length);
  for (let i = 1; i < ranked.length; i++) ok(ranked[i - 1].score >= ranked[i].score, 'sorted');
  ok(ranked[0].reasons.some((r) => r.tag === 'presses-high'), 'press reason');
  ok(ranked[0].reasons.some((r) => r.tag === 'slow-cbs'), 'slow CB reason');
  const f352 = formationFeatures(F['3-5-2'].slots), f4141 = formationFeatures(F['4-1-4-1'].slots);
  ok(f352.strikers === 2 && f4141.strikers === 1);
});

test('lineup: goalkeeper in goal, no player used twice', () => {
  const roster = [keeper, winger, anchor, ...Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, attrs: { pace: 1 + (i % 5), passing: 3, dribbling: 1 + ((i + 2) % 5), defending: 1 + ((i + 3) % 5), stamina: 3 }, positions: [] }))];
  const { lineup } = suggestLineup(F['4-3-3'].slots, roster, ['slow-cbs']);
  eq(lineup[0].player.id, 'k');
  const ids = lineup.map((l) => l.player.id);
  eq(new Set(ids).size, 11);
  eq(lineup.find((l) => l.label === 'LW').player.id, 'w');
});

test('assignment finds the optimal pairing', () => {
  const pick = assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]]);
  eq(pick.reduce((a, j, i) => a + [[4, 1, 3], [2, 0, 5], [3, 2, 2]][i][j], 0), 5);
  eq(new Set(pick).size, 3);
  const rect = assign([[9, 1, 9, 9], [1, 9, 9, 9]]);
  eq(rect[0], 1); eq(rect[1], 0);
});

test('systems: 11 slots, keeper first, valid roles', () => {
  const ids = new Set();
  for (const sys of SYSTEMS) {
    eq(sys.slots.length, 11, sys.id); ok(['gk', 'sk'].includes(sys.slots[0].role), sys.id);
    for (const sl of sys.slots) ok(ROLE_BY_ID[sl.role] && sl.d >= 0 && sl.d <= 1 && sl.w >= 0 && sl.w <= 1, `${sys.id} ${sl.label}`);
    ok(!ids.has(sys.id), 'duplicate ' + sys.id); ids.add(sys.id);
    ok(FORMATIONS.some((f) => f.id === sys.family), `${sys.id} family ${sys.family}`);
  }
  ok(SYSTEMS.length >= 55, `systems: ${SYSTEMS.length}`);
});

test('shades of: a system matches itself, and a 4-3-3 resembles 4-3-3 systems', () => {
  for (const sys of SYSTEMS) eq(shapeSimilarity(slotsToPoints(sys.slots, 'home'), sys.slots), 100, sys.id);
  const top = shadesOf(slotsToPoints(F['4-3-3'].slots, 'home'), SYSTEMS);
  eq(top[0].system.family, '4-3-3');
  ok(top[0].similarity >= 70, `similarity ${top[0].similarity}`);
  const away = shadesOf(slotsToPoints(F['3-5-2'].slots, 'away'), SYSTEMS, 'away');
  eq(away[0].system.family, '3-5-2');
});

test('squad fit ranks systems and reports gaps', () => {
  const roster = [keeper, winger, anchor, ...Array.from({ length: 12 }, (_, i) => ({ id: 'q' + i, attrs: { pace: 1 + (i % 5), shooting: 3, passing: 3, dribbling: 1 + ((i + 2) % 5), defending: 1 + ((i + 3) % 5), stamina: 3 }, positions: [] }))];
  const res = squadSystemFit(roster, SYSTEMS);
  eq(res.length, SYSTEMS.length);
  for (let i = 1; i < res.length; i++) ok(res[i - 1].average >= res[i].average);
  ok(res.every((r) => r.lineup.filter((l) => l.player).length === 11));
});

test('separation: no opposing players overlap and zone counts are unchanged', () => {
  for (const a of FORMATIONS) for (const b of FORMATIONS) {
    const h = slotsToPoints(a.slots, 'home'), w0 = slotsToPoints(b.slots, 'away');
    const w = separate(w0, h);
    for (const p of w) for (const q of h) ok(dist(p, q) >= 4.2 - 1e-6, `${a.id} v ${b.id}`);
    eq(zoneCounts(h, w).map((z) => z.diff).join(), zoneCounts(h, w0).map((z) => z.diff).join(), `${a.id} v ${b.id} zones`);
  }
});

test('optimizer: ranks shapes using squad, opponent shape, tags and ratings', () => {
  const roster = Array.from({ length: 16 }, (_, i) => ({ id: 'o' + i, attrs: { pace: i % 2 ? 5 : 2, shooting: 3, passing: 3, dribbling: 3, vision: 3, defending: 3, physical: 3, stamina: 3, goalkeeping: i === 0 ? 5 : 1 }, positions: i === 0 ? ['GK'] : [] }));
  const opp = { slots: F['4-4-2'].slots, tags: ['presses-high', 'slow-cbs'], ratings: { blPace: 1, press: 5 } };
  const res = optimizeFormation(FORMATIONS, { roster, opponent: opp });
  eq(res.length, FORMATIONS.length);
  for (let i = 1; i < res.length; i++) ok(res[i - 1].total >= res[i].total, 'sorted');
  const top = res[0];
  ok(top.parts.squad != null && top.parts.matchup != null && top.parts.exploit != null, 'all parts scored');
  ok(top.reasons.some((r) => /slow/.test(r.text)), 'mentions slow back line');
  eq(top.lineup.filter((l) => l.player).length, 11);
  const noSquad = optimizeFormation(FORMATIONS, { roster: [], opponent: opp });
  eq(noSquad[0].parts.squad, null);
});

test('set pieces: every template places 22 players and the taker can play the ball', () => {
  const plan = makeSampleWorkspace().plans[0];
  const sideOf = {};
  for (const sd of ['home', 'away']) for (const p of plan.teams[sd].players) sideOf[p.id] = sd;
  const spots = { 'fk-spot': [[60, 10], [70, 34], [80, 22], [84, 46], [90, 60], [96, 30], [100, 8]], 'long-throw': [[72, 0], [88, 68], [102, 0]] };
  for (const t of SET_PIECE_TYPES) {
    for (const sp of spots[t.id] || [null]) {
      const play = buildSetPiece(t.id, plan, null, sp ? { x: sp[0], y: sp[1] } : null);
      const ids = Object.keys(play.start.pos);
      eq(ids.length, 22, t.id);
      for (const id of ids) { const p = play.start.pos[id]; ok(p.x >= -0.01 && p.x <= 105 && p.y >= -0.01 && p.y <= 68, `${t.id} ${id} on pitch`); }
      const ball = play.start.ball;
      const near = ids.filter((id) => dist(play.start.pos[id], ball) <= RECEIVE_RADIUS);
      ok(near.length >= 1, `${t.id} ${sp} taker next to ball`);
      const taker = near.sort((a, b) => dist(play.start.pos[a], ball) - dist(play.start.pos[b], ball))[0];
      const mate = ids.find((id) => id !== taker && sideOf[id] === sideOf[taker] && !id.endsWith('1'));
      play.steps[0].actions = [{ id: 'k', type: 'pass', from: taker, to: mate }];
      const tl = buildTimeline(play, sideOf, { carry: 2 });
      ok(!tl.invalid.size, `${t.id} kick is valid`);
    }
  }
});

test('set pieces: free-kick wall stands 9.15 m from the ball', () => {
  const plan = makeSampleWorkspace().plans[0];
  const play = buildSetPiece('fk-spot', plan, null, { x: 82, y: 30 });
  const ball = play.start.ball;
  const close = Object.entries(play.start.pos).filter(([id]) => id.startsWith('a')).map(([, p]) => dist(p, ball)).filter((d) => d < 9);
  eq(close.length, 0, 'no defender inside 9.15 m');
});

// ---- auto defense
function defenseCase() {
  const plan = makeSampleWorkspace().plans[0];
  const sideOf = {}, base = {};
  for (const sd of ['home', 'away']) for (const p of plan.teams[sd].players) { sideOf[p.id] = sd; base[p.id] = { x: p.x, y: p.y }; }
  const gk = { home: 'h1', away: 'a1' };
  return { plan, sideOf, base, gk, defense: { mode: 'both', block: 'mid', press: 'balanced', gk } };
}

test('auto defense: block shifts toward the ball side', () => {
  const { sideOf, base, gk } = defenseCase();
  const awayIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'away');
  const homeIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'home');
  const res = defendStep({ side: 'away', ids: awayIds, gk: gk.away, attackers: homeIds, base, start: base, end: base,
    ball: { x: 70, y: 6, owner: 'h9' }, fixed: new Set(), duration: 2.5, block: 'mid', press: 'balanced' });
  const avg = (pos) => awayIds.filter((id) => id !== 'a1').reduce((a, id) => a + (pos[id] || base[id]).y, 0) / 10;
  ok(avg(res.targets) < avg(base) - 3, `block moved toward the left touchline: ${avg(base).toFixed(1)} -> ${avg(res.targets).toFixed(1)}`);
  ok(Object.values(res.roles).includes('press'), 'someone presses the ball');
});

test('auto defense: runner into the box is tracked goal-side', () => {
  const { sideOf, base, gk } = defenseCase();
  const awayIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'away');
  const homeIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'home');
  const end = { ...base, h10: { x: 96, y: 32 } };
  const start = { ...base, a3: { x: 92, y: 37 } }; // a center back already near the box
  const res = defendStep({ side: 'away', ids: awayIds, gk: gk.away, attackers: homeIds, base, start, end,
    ball: { x: 75, y: 20, owner: 'h7' }, fixed: new Set(), duration: 2.5, block: 'mid', press: 'balanced', quality: 'sharp' });
  const marker = Object.keys(res.roles).find((id) => res.roles[id] === 'mark' && dist(res.targets[id], end.h10) < 3);
  ok(marker, 'a defender picks up the striker');
  ok(res.targets[marker].x > end.h10.x, 'marker stays goal-side');
  const g = res.targets.a1 || base.a1;
  ok(105 - g.x <= 6.1 && g.y > 30 && g.y < 38, 'keeper stays near goal');
  // A run that starts far from every defender can beat them: speed limits keep it fair.
  const late = defendStep({ side: 'away', ids: awayIds, gk: gk.away, attackers: homeIds, base, start: base, end,
    ball: { x: 75, y: 20, owner: 'h7' }, fixed: new Set(), duration: 2.5, block: 'mid', press: 'balanced' });
  ok(Object.keys(late.targets).every((id) => dist(base[id], late.targets[id]) <= PRESS.balanced.speed * 2.5 + 1e-6), 'nobody outruns the speed limit');
});

test('auto defense: speed limits, coach overrides and off switch', () => {
  const { sideOf, base, gk } = defenseCase();
  const awayIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'away');
  const homeIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'home');
  const res = defendStep({ side: 'away', ids: awayIds, gk: gk.away, attackers: homeIds, base, start: base, end: base,
    ball: { x: 100, y: 60, owner: 'h11' }, fixed: new Set(['a5']), duration: 1, block: 'high', press: 'aggressive' });
  for (const id in res.targets) ok(dist(base[id], res.targets[id]) <= PRESS.aggressive.speed * 1 + 1e-6, `${id} speed`);
  ok(!res.targets.a5, 'player moved by the coach is left alone');
});

test('auto defense: sample play stays consistent with reactions on', () => {
  const { plan, sideOf, defense } = defenseCase();
  const play = plan.plays[0];
  const tl = buildTimeline(play, sideOf, { carry: 2, defense });
  eq(tl.invalid.size, 0, 'no invalid actions');
  ok(tl.steps.some((st) => Object.values(st.paths).some((m) => m.auto)), 'defenders react');
  for (let k = 0; k < play.steps.length; k++) {
    const f1 = frameAt(tl, k, 1, { flow: true });
    for (const id in tl.states[k + 1].pos) near(f1.pos[id].x, tl.states[k + 1].pos[id].x, 1e-6, `step ${k} ${id}`);
  }
  const off = buildTimeline(play, sideOf, { carry: 2, defense: { ...defense, mode: 'off' } });
  ok(!off.steps.some((st) => Object.values(st.paths).some((m) => m.auto)), 'off means off');
  const opp = buildTimeline(play, sideOf, { carry: 2, defense: { ...defense, mode: 'opponent' } });
  ok(opp.steps.every((st) => Object.entries(st.paths).every(([id, m]) => !m.auto || sideOf[id] === 'away')), 'opponent-only mode moves only the opponent');
});

test('defense quality: realistic leaves more space than sharp, and is repeatable', () => {
  const { sideOf, base, gk } = defenseCase();
  const awayIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'away');
  const homeIds = Object.keys(sideOf).filter((id) => sideOf[id] === 'home');
  const end = { ...base, h10: { x: 95, y: 32 }, h9: { x: 92, y: 12 }, h11: { x: 90, y: 55 } };
  const run = (quality, seed = 'play-1') => defendStep({ side: 'away', ids: awayIds, gk: gk.away, attackers: homeIds, base, start: base, end,
    ball: { x: 78, y: 22, owner: 'h7' }, fixed: new Set(), duration: 2.4, block: 'mid', press: 'balanced', quality, seed, step: 1 });
  const space = (res) => {
    const pos = { ...base, ...res.targets };
    const att = ['h9', 'h10', 'h11', 'h7'];
    return att.reduce((a, id) => a + Math.min(...awayIds.filter((d) => d !== 'a1').map((d) => dist(pos[d], end[id] || base[id]))), 0) / att.length;
  };
  // Average over several seeds so the comparison isn't luck.
  const avg = (q) => ['a', 'b', 'c', 'd', 'e', 'f'].reduce((a, sd) => a + space(run(q, sd)), 0) / 6;
  ok(avg('realistic') > avg('sharp'), `realistic ${avg('realistic').toFixed(2)} m > sharp ${avg('sharp').toFixed(2)} m of space`);
  ok(avg('sloppy') > avg('realistic'), 'sloppy leaves the most space');
  eq(JSON.stringify(run('realistic')), JSON.stringify(run('realistic')), 'same seed, same result');
  const d = run('realistic').delays;
  ok(Object.values(d).some((v) => v > 0.15) && new Set(Object.values(d).map((v) => v.toFixed(2))).size > 2, 'players react at different times');
});

test('space map covers the pitch and favors the team that is closer', () => {
  const runs = spaceControl([{ x: 20, y: 34 }], [{ x: 90, y: 34 }]);
  const area = runs.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  near(area, 105 * 68, 1e-6);
  const at = (x, y) => runs.find((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1).side;
  eq(at(10, 10), 'home'); eq(at(100, 60), 'away');
});

// ---- playback
const sideOf = { a: 'home', b: 'home', c: 'home', x: 'away' };
const play = {
  start: { pos: { a: { x: 30, y: 30 }, b: { x: 50, y: 20 }, c: { x: 60, y: 50 }, x: { x: 70, y: 30 } }, ball: { owner: 'a' } },
  steps: [
    { duration: 2, actions: [{ id: 's1p', type: 'pass', from: 'a', to: 'b' }, { id: 's1r', type: 'run', from: 'c', target: { x: 80, y: 50 } }] },
    { duration: 2, actions: [{ id: 's2d', type: 'dribble', from: 'b', target: { x: 70, y: 15 }, curve: 4 }] },
    { duration: 2, actions: [{ id: 's3p', type: 'pass', from: 'b', target: { x: 85, y: 48 }, lofted: true }, { id: 's3r', type: 'run', from: 'c', target: { x: 85, y: 49 } }] },
    { duration: 2, actions: [{ id: 's4bad', type: 'pass', from: 'a', to: 'b' }, { id: 's4s', type: 'shot', from: 'c', target: { x: 106, y: 34 } }] },
  ],
};

test('timeline: possession follows passes, dribbles and runs onto through balls', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  eq(tl.states.length, 5);
  eq(tl.states[1].ball.owner, 'b', 'after pass');
  eq(tl.states[2].ball.owner, 'b', 'after dribble');
  near(tl.states[2].pos.b.x, 70, 1e-9);
  eq(tl.states[3].ball.owner, 'c', 'runner collects pass into space');
  eq(tl.states[4].ball.owner, null, 'after shot');
});

test('timeline: pass from a player without the ball is flagged', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  ok(tl.invalid.has('s4bad'));
  ok(!tl.invalid.has('s4s'));
});

test('frames: start and end of every step match the states', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  for (let k = 0; k < play.steps.length; k++) {
    const f0 = frameAt(tl, k, 0), f1 = frameAt(tl, k, 1);
    for (const id in tl.states[k].pos) {
      near(f0.pos[id].x, tl.states[k].pos[id].x, 1e-6, `step ${k} start ${id}`);
      near(f1.pos[id].x, tl.states[k + 1].pos[id].x, 1e-6, `step ${k} end ${id}`);
    }
  }
});

test('frames: ball is continuous across step boundaries', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  for (let k = 0; k < play.steps.length - 1; k++) {
    const end = frameAt(tl, k, 1).ball, next = frameAt(tl, k + 1, 0).ball;
    near(Math.hypot(end.x - next.x, end.y - next.y), 0, 0.01, `between step ${k} and ${k + 1}`);
  }
});

test('frames: lofted ball rises mid-flight, ground pass stays down', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  const g = tl.steps[2].ballGeo;
  const mid = frameAt(tl, 2, (g.td + g.ta) / 2).ball;
  ok(mid.z > 1, `lofted ball height ${mid.z}`);
  const g0 = tl.steps[0].ballGeo;
  eq(frameAt(tl, 0, (g0.td + g0.ta) / 2).ball.z, 0);
});

test('flow playback: continuous runs do not stop at step boundaries', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  // Player c runs in step 1 and again in step 3 (not 2); player b dribbles in step 2 only.
  const sp = (k, t, id, flow) => { const a = frameAt(tl, k, t, { flow }).pos[id], b = frameAt(tl, k, t + 0.01, { flow }).pos[id]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const cont = { start: { pos: { a: { x: 10, y: 10 } }, ball: { owner: null, x: 50, y: 50 } }, steps: [
    { actions: [{ id: 'r1', type: 'run', from: 'a', target: { x: 30, y: 10 } }] },
    { actions: [{ id: 'r2', type: 'run', from: 'a', target: { x: 50, y: 20 } }] }] };
  const t2 = buildTimeline(cont, { a: 'home' }, { carry: 2 });
  const v = (k, t, flow) => { const p = frameAt(t2, k, t, { flow }).pos.a, q = frameAt(t2, k, t + 0.005, { flow }).pos.a; return Math.hypot(p.x - q.x, p.y - q.y); };
  ok(v(0, 0.99, true) > 0.05 && v(1, 0.0, true) > 0.05, 'keeps moving through the boundary in flow mode');
  ok(v(0, 0.994, false) < 0.02, 'eases to a stop in coach mode');
  // A single run (no follow-up) still slows near the end in flow mode, but never stops dead.
  const one = { start: { pos: { a: { x: 10, y: 10 } }, ball: { owner: null, x: 50, y: 50 } }, steps: [{ actions: [{ id: 'r', type: 'run', from: 'a', target: { x: 40, y: 10 } }] }] };
  const t3 = buildTimeline(one, { a: 'home' }, { carry: 2 });
  const sp1 = (t, flow) => { const p = frameAt(t3, 0, t, { flow }).pos.a, q = frameAt(t3, 0, t + 0.005, { flow }).pos.a; return Math.hypot(p.x - q.x, p.y - q.y); };
  ok(sp1(0.99, true) > sp1(0.99, false) && sp1(0.5, true) > sp1(0.99, true), 'flow: shorter dip at the end of a step');
  near(frameAt(t2, 0, 1, { flow: true }).pos.a.x, 30, 1e-9);
});

test('set piece: loose ball is kicked from its spot', () => {
  const sp = { start: { pos: { a: { x: 104, y: 1 }, b: { x: 99, y: 30 } }, ball: { owner: null, x: 104.6, y: 0.6 } },
    steps: [{ actions: [{ id: 'c', type: 'pass', from: 'a', to: 'b', lofted: true }] }] };
  const tl = buildTimeline(sp, { a: 'home', b: 'home' }, { carry: 2 });
  ok(!tl.invalid.size, 'taker next to a loose ball can play it');
  const f = frameAt(tl, 0, 0).ball;
  near(f.x, 104.6, 1e-9); near(f.y, 0.6, 1e-9);
  eq(tl.states[1].ball.owner, 'b');
});

test('passes: driven is faster and low, lofted is slower and high, curve bends the path', () => {
  const mk = (extra) => ({ start: { pos: { a: { x: 30, y: 30 }, b: { x: 70, y: 30 } }, ball: { owner: 'a' } },
    steps: [{ actions: [{ id: 'p', type: 'pass', from: 'a', to: 'b', ...extra }] }] });
  const geo = (extra) => buildTimeline(mk(extra), { a: 'home', b: 'home' }, { carry: 2 }).steps[0].ballGeo;
  const g = geo({}), d = geo({ height: 'driven' }), l = geo({ height: 'lofted' }), c = geo({ curve: 6 });
  ok(d.ta - d.td < g.ta - g.td && g.ta - g.td < l.ta - l.td, 'flight times: driven < ground < lofted');
  eq(g.height, 0); ok(d.height > 0 && d.height < 1.5, 'driven stays low'); ok(l.height > 4, 'lofted goes high');
  ok(geo({ lofted: true }).height === l.height, 'old lofted flag still works');
  const mid = c.path.at(0.5);
  ok(Math.abs(mid.y - 30) > 2, 'curved pass bends away from the straight line');
});

test('frames: through ball arrives with the runner', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  const g = tl.steps[2].ballGeo;
  eq(g.ta, 1, 'arrives at end of step');
  ok(g.td > 0, 'leaves after the run starts');
});

test('frames: ball speed decreases along a pass (decelerates)', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  const g = tl.steps[0].ballGeo;
  const at = (u) => frameAt(tl, 0, g.td + (g.ta - g.td) * u).ball;
  const early = Math.hypot(at(0.1).x - at(0.05).x, at(0.1).y - at(0.05).y);
  const late = Math.hypot(at(0.95).x - at(0.9).x, at(0.95).y - at(0.9).y);
  ok(early > late, `early ${early} > late ${late}`);
});

test('sound events: kick and touch on passes, taps on dribbles, goal on shots', () => {
  const tl = buildTimeline(play, sideOf, { carry: 2 });
  const all = (k) => eventsBetween(tl, k, -1e-6, 1).map((e) => e.type);
  eq(all(0).join(), 'kick,touch', 'pass');
  ok(all(1).length >= 2 && all(1).every((x) => x === 'dribble'), 'dribble taps');
  eq(all(2).join(), 'kick,touch', 'through ball collected by the runner');
  eq(all(3).join(), 'shot,goal', 'shot into the net');
  // Splitting the step into frames gives each event exactly once.
  let n = 0; for (let t = 0; t < 1; t += 0.05) n += eventsBetween(tl, 0, t === 0 ? -1e-6 : t, t + 0.05).length;
  eq(n, 2, 'no duplicates across frames');
});

log(`\n${passed} passed, ${failed} failed`);
if (typeof globalThis !== 'undefined') globalThis.__testResults = { passed, failed, results };
if (failed && typeof process !== 'undefined') process.exit(1);
