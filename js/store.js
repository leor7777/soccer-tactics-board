// App state: the persisted workspace (doc), view preferences, transient UI state,
// undo/redo history and autosave. A tiny subscribe/selector store, Zustand-style.

import { useReducer, useEffect, useRef } from './lib.js';
import * as idb from './idb.js';
import { makeSampleWorkspace, newPlan, newStep, makeTeam, uid, formationById } from './sample.js';
import { slotToPoint, pointToSlot, assign } from './analysis.js';
import { buildTimeline, BALL_ACTIONS } from './playback.js';
import { dist, separate } from './geometry.js';
import { SYSTEM_BY_ID } from './systems.js';
import { POSITION_ROLE, roleBase } from './data.js';
import { buildSetPiece, sampleSetPieces } from './setpieces.js';

const DOC_KEY = 'workspace-v1'; // single-team data from earlier versions
const CLUB_KEY = 'club-v1';     // every team the coach manages
const PREFS_KEY = 'prefs-v1';

export const DEFAULT_PREFS = {
  pitchTheme: 'night', orient: 'auto', area: 'full', flip: false, tokenSize: 'm', labels: 'name',
  showAway: true, zones: false, includeGK: false, ghost: true, trail: true, lineColor: 'action',
  appTheme: 'system', drawOn: true, stickyTool: true, shades: true,
  playStyle: 'flow', camera: 'follow', slowmo: true, fx: true, shapeLines: false,
  autoDefense: 'both', defBlock: 'mid', defPress: 'balanced', defQuality: 'realistic', showAuto: true, spaceMap: false,
  passHeight: 'ground', passBend: 0, sound: true, volume: 0.7,
};

let S = {
  ready: false,
  // club: { teams: [{ id, name, primary, secondary, createdAt, doc }], activeTeamId }
  // doc:  the active team's workspace (plans, squad, opponents, set pieces, saved shapes)
  club: null,
  doc: null,
  prefs: { ...DEFAULT_PREFS },
  ui: {
    tool: 'select', sel: null, playId: null, step: 0, panel: 'team', teamSide: 'home', drawer: false,
    speed: 1, playing: false, highlight: null, toast: null, viewMenu: false, present: false, flood: null,
    formationAnim: null, scoutId: null, rosterId: null, lastCreated: null, resetMenu: false, plansOpen: false,
    guide: false, optimizeAt: 0, spPick: null, teamsOpen: false,
  },
  past: [], future: [], saveState: 'saved',
};

const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export const getState = () => S;

export function useStore(selector) {
  const [, force] = useReducer((x) => x + 1, 0);
  const sel = useRef(selector);
  sel.current = selector;
  const value = selector(S);
  const last = useRef(value);
  last.current = value;
  useEffect(() => {
    const l = () => {
      const next = sel.current(S);
      if (!Object.is(next, last.current)) force();
    };
    listeners.add(l);
    l(); // catch updates that landed between render and subscribe
    return () => listeners.delete(l);
  }, []);
  return value;
}

// ---- Persistence --------------------------------------------------------

let saveTimer = null;
// The active team's doc lives in S.doc; fold it back into the club when saving.
const clubWithDoc = () => ({ ...S.club, teams: S.club.teams.map((t) => (t.id === S.club.activeTeamId ? { ...t, doc: S.doc } : t)) });

function scheduleSave() {
  S = { ...S, saveState: 'saving' };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await idb.set(CLUB_KEY, clubWithDoc());
    S = { ...S, saveState: ok ? 'saved' : 'error' };
    emit();
  }, 450);
}

function teamFromDoc(doc, name) {
  const plan = doc.plans.find((p) => p.id === doc.activePlanId) || doc.plans[0];
  const home = plan?.teams.home;
  return { id: uid('team_'), name: name || home?.name || 'My team', primary: home?.primary || '#1c2f5f', secondary: home?.secondary || '#f3f5f7', createdAt: Date.now(), doc };
}

export async function init() {
  let club = await idb.get(CLUB_KEY);
  if (!club || !Array.isArray(club.teams) || !club.teams.length) {
    // First run on this version: wrap the existing single workspace as the first team.
    let doc = await idb.get(DOC_KEY);
    if (!doc || !Array.isArray(doc.plans) || !doc.plans.length) doc = makeSampleWorkspace();
    const team = teamFromDoc(migrate(doc));
    club = { version: 2, teams: [team], activeTeamId: team.id };
  }
  const active = club.teams.find((t) => t.id === club.activeTeamId) || club.teams[0];
  const prefs = { ...DEFAULT_PREFS, ...((await idb.get(PREFS_KEY)) || {}) };
  S = { ...S, ready: true, club: { ...club, activeTeamId: active.id }, doc: migrate(active.doc), prefs };
  const plan = activePlan(S);
  if (plan?.plays?.length) S.ui = { ...S.ui, playId: plan.plays[0].id };
  emit();
}

// ---- Teams (for coaches with more than one side) -------------------------

export const activeTeam = (s) => s.club?.teams.find((t) => t.id === s.club.activeTeamId) || null;

export function switchTeam(id) {
  if (!S.club || id === S.club.activeTeamId) return;
  const club = clubWithDoc();
  const t = club.teams.find((x) => x.id === id);
  if (!t) return;
  S = { ...S, club: { ...club, activeTeamId: id }, doc: migrate(t.doc), past: [], future: [] };
  const plan = activePlan(S);
  S.ui = { ...S.ui, playId: plan?.plays[0]?.id ?? null, step: 0, sel: null, playing: false, scoutId: null, rosterId: null, teamsOpen: false, flood: { color: t.primary, at: Date.now() } };
  scheduleSave();
  emit();
  toast(`Switched to ${t.name}.`, 'good');
}

// New team: a blank workspace with one game plan, optionally copying reusable
// material (set pieces, saved shapes, opponents) from the current team.
export function createTeam({ name, primary, secondary, copy = {} }) {
  const clean = (name || '').trim() || 'New team';
  const plan = newPlan(`${clean} game plan`);
  Object.assign(plan.teams.home, { name: clean, primary, secondary });
  const reId = (list, prefix) => structuredClone(list || []).map((x) => ({ ...x, id: uid(prefix) }));
  const doc = {
    version: 1, plans: [plan], activePlanId: plan.id, roster: [],
    opponents: copy.opponents ? reId(S.doc.opponents, 'opp_') : [],
    customFormations: copy.shapes ? structuredClone(S.doc.customFormations) : [],
    setPieces: copy.setPieces ? reId(S.doc.setPieces, 'sp_') : [],
  };
  const team = { id: uid('team_'), name: clean, primary, secondary, createdAt: Date.now(), doc };
  S = { ...S, club: { ...clubWithDoc(), teams: [...S.club.teams, team] } };
  switchTeam(team.id);
  return team.id;
}

// Rename or recolor a team; every game plan for that team follows.
export function updateTeamProfile(id, patch) {
  const club = clubWithDoc();
  const teams = club.teams.map((t) => {
    if (t.id !== id) return t;
    const doc = structuredClone(t.doc);
    for (const plan of doc.plans) {
      const home = plan.teams.home;
      if ('name' in patch) { renameInPlanName(plan, home.name, patch.name); home.name = patch.name; }
      if ('primary' in patch) home.primary = patch.primary;
      if ('secondary' in patch) home.secondary = patch.secondary;
    }
    return { ...t, ...patch, doc };
  });
  const active = teams.find((t) => t.id === club.activeTeamId);
  S = { ...S, club: { ...club, teams }, doc: id === club.activeTeamId ? active.doc : S.doc };
  scheduleSave();
  emit();
}

export function duplicateTeam(id) {
  const club = clubWithDoc();
  const src = club.teams.find((t) => t.id === id);
  if (!src) return;
  const copy = { ...structuredClone(src), id: uid('team_'), name: `${src.name} (copy)`, createdAt: Date.now() };
  S = { ...S, club: { ...club, teams: [...club.teams, copy] } };
  scheduleSave();
  emit();
}

export function deleteTeam(id) {
  const club = clubWithDoc();
  if (club.teams.length <= 1) { toast('You need at least one team.', 'risk'); return; }
  const teams = club.teams.filter((t) => t.id !== id);
  if (id === club.activeTeamId) {
    S = { ...S, club: { ...club, teams, activeTeamId: teams[0].id }, doc: migrate(teams[0].doc), past: [], future: [] };
    const plan = activePlan(S);
    S.ui = { ...S.ui, playId: plan?.plays[0]?.id ?? null, step: 0, sel: null };
  } else {
    S = { ...S, club: { ...club, teams } };
  }
  scheduleSave();
  emit();
}

// Full backup of one team (or import one) as a file.
export function exportTeamData(id = S.club.activeTeamId) {
  const t = clubWithDoc().teams.find((x) => x.id === id);
  return { app: 'soccer-tactics-board', kind: 'team', version: 2, exportedAt: new Date().toISOString(), team: t };
}

export function importTeamData(data) {
  if (data?.app !== 'soccer-tactics-board' || data.kind !== 'team' || !data.team?.doc?.plans) throw new Error('This file is not a Soccer Tactics Board team backup.');
  const t = structuredClone(data.team);
  if (S.club.teams.some((x) => x.id === t.id)) { t.id = uid('team_'); t.name += ' (imported)'; }
  t.doc = migrate(t.doc);
  S = { ...S, club: { ...clubWithDoc(), teams: [...S.club.teams, t] } };
  switchTeam(t.id);
  return t;
}

export function teamStats(t, s = S) {
  const doc = t.id === s.club?.activeTeamId ? s.doc : t.doc;
  return { players: doc.roster.length, plans: doc.plans.length, plays: doc.plans.reduce((n, p) => n + p.plays.length, 0), setPieces: (doc.setPieces || []).length };
}

// When a team is renamed, also rename it inside plan names like "vs Riverside".
function renameInPlanName(plan, oldName, newName) {
  if (!oldName || !newName || oldName === newName || !plan.name) return;
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  plan.name = plan.name.replace(new RegExp(`\\b${esc}\\b`, 'g'), newName);
}

// Plans and their linked opponent profile each hold a name and kit colors. Older versions
// didn't keep them in step, so on load take whichever side was actually edited:
// a value still equal to the example/default loses to one the coach changed.
const DEFAULT_NAMES = new Set(['riverside', 'opponent', 'away', 'new opponent', '']);
const DEFAULT_KITS = new Set(['#b3122e|#f6f1ea']);
function reconcileOpponents(doc) {
  for (const plan of doc.plans) {
    if (plan.name) plan.name = plan.name.replace(/^Example:\s*/i, '');
    const o = plan.opponentId && doc.opponents.find((q) => q.id === plan.opponentId);
    if (!o) continue;
    const t = plan.teams.away;
    const before = t.name;
    const profileName = (o.name || '').replace(/\s*\(example\)$/i, '');
    const boardDefault = DEFAULT_NAMES.has((t.name || '').toLowerCase());
    const profileDefault = DEFAULT_NAMES.has(profileName.toLowerCase()) || /\(example\)$/i.test(o.name || '');
    if (profileName !== t.name) {
      if (boardDefault && !profileDefault) t.name = profileName;
      else if (profileDefault && !boardDefault) o.name = t.name;
      else t.name = profileName;
    }
    renameInPlanName(plan, before, t.name);
    if (t.name !== 'Riverside') renameInPlanName(plan, 'Riverside', t.name);
    const pk = `${o.primary}|${o.secondary}`.toLowerCase(), bk = `${t.primary}|${t.secondary}`.toLowerCase();
    if (pk !== bk) {
      if (DEFAULT_KITS.has(pk) && !DEFAULT_KITS.has(bk)) { o.primary = t.primary; o.secondary = t.secondary; }
      else { t.primary = o.primary; t.secondary = o.secondary; }
    }
  }
}

function migrate(doc) {
  doc.roster = doc.roster || [];
  doc.opponents = doc.opponents || [];
  doc.customFormations = doc.customFormations || [];
  for (const o of doc.opponents) o.ratings = o.ratings || {};
  reconcileOpponents(doc);
  // Set pieces live outside game plans so routines can be reused in every game.
  if (!Array.isArray(doc.setPieces)) {
    const plan = doc.plans.find((p) => p.id === doc.activePlanId) || doc.plans[0];
    doc.setPieces = sampleSetPieces(plan);
  }
  return doc;
}

// ---- Core updates -------------------------------------------------------

export function setUI(patch) {
  const p = typeof patch === 'function' ? patch(S.ui) : patch;
  S = { ...S, ui: { ...S.ui, ...p } };
  emit();
}

export function setPrefs(patch) {
  S = { ...S, prefs: { ...S.prefs, ...patch } };
  emit();
  idb.set(PREFS_KEY, S.prefs);
}

// Apply a mutation to a deep copy of the doc and record it for undo.
// Return false from fn to cancel.
export function commit(fn, opts = {}) {
  const next = structuredClone(S.doc);
  const res = fn(next);
  if (res === false) return false;
  const plan = next.plans.find((p) => p.id === next.activePlanId);
  if (plan) plan.updatedAt = Date.now();
  S = { ...S, doc: next, past: opts.history === false ? S.past : [...S.past.slice(-120), S.doc], future: opts.history === false ? S.future : [] };
  scheduleSave();
  emit();
  return res ?? true;
}

export function undo() {
  if (!S.past.length) return;
  const prev = S.past[S.past.length - 1];
  S = { ...S, doc: prev, past: S.past.slice(0, -1), future: [S.doc, ...S.future], ui: { ...S.ui, sel: null } };
  fixSelection();
  scheduleSave();
  emit();
}

export function redo() {
  if (!S.future.length) return;
  const next = S.future[0];
  S = { ...S, doc: next, future: S.future.slice(1), past: [...S.past, S.doc], ui: { ...S.ui, sel: null } };
  fixSelection();
  scheduleSave();
  emit();
}

function fixSelection() {
  const plan = activePlan(S);
  const play = findPlay(S.doc, S.ui.playId);
  if (!play) S.ui = { ...S.ui, playId: plan?.plays[0]?.id ?? null, step: 0 };
  else if (S.ui.step >= play.steps.length) S.ui = { ...S.ui, step: Math.max(0, play.steps.length - 1) };
}

let toastTimer = null;
export function toast(text, tone = 'info') {
  clearTimeout(toastTimer);
  setUI({ toast: { text, tone, id: Date.now() } });
  toastTimer = setTimeout(() => setUI({ toast: null }), 3200);
}

// ---- Selectors ----------------------------------------------------------

export const activePlan = (s) => s.doc?.plans.find((p) => p.id === s.doc.activePlanId) || s.doc?.plans[0] || null;
export const activePlay = (s) => (s.doc ? findPlay(s.doc, s.ui.playId) : null);

// Plays live in the active plan; set pieces live in the shared library.
export function findPlay(doc, id) {
  if (!id || !doc) return null;
  const plan = doc.plans.find((p) => p.id === doc.activePlanId) || doc.plans[0];
  return plan?.plays.find((p) => p.id === id) || doc.setPieces?.find((p) => p.id === id) || null;
}
function listOf(doc, id) {
  const plan = doc.plans.find((p) => p.id === doc.activePlanId);
  if (plan.plays.some((p) => p.id === id)) return plan.plays;
  if (doc.setPieces.some((p) => p.id === id)) return doc.setPieces;
  return null;
}
export const isSetPiece = (play) => play?.kind === 'setpiece';

export function sideMap(plan) {
  const out = {};
  for (const side of ['home', 'away']) for (const p of plan.teams[side].players) out[p.id] = side;
  return out;
}

export function playerIndex(plan) {
  const out = {};
  for (const side of ['home', 'away']) for (const p of plan.teams[side].players) out[p.id] = { ...p, side };
  return out;
}

export function boardPositions(plan) {
  const out = {};
  for (const side of ['home', 'away']) for (const p of plan.teams[side].players) out[p.id] = { x: p.x, y: p.y };
  return out;
}

// Defense settings that feed the timeline (automatic reactions for the team without the ball).
export function defenseOpts(plan, play, prefs = S.prefs) {
  const gk = {};
  for (const side of ['home', 'away']) gk[side] = plan.teams[side].players.find((p) => p.gk)?.id || null;
  return { mode: prefs.autoDefense, block: prefs.defBlock, press: prefs.defPress, quality: prefs.defQuality, seed: play?.id || '', gk, setPiece: play?.kind === 'setpiece' };
}

const tlCache = new WeakMap();
export function timelineFor(plan, play, carry) {
  if (!play) return null;
  const defense = defenseOpts(plan, play);
  const key = `${carry}|${defense.mode}|${defense.block}|${defense.press}|${defense.quality}`;
  const hit = tlCache.get(play);
  if (hit && hit.key === key && hit.teams === plan.teams) return hit.tl;
  const tl = buildTimeline(play, sideMap(plan), { carry, defense });
  tlCache.set(play, { key, teams: plan.teams, tl });
  return tl;
}

export const allFormations = (doc) => doc.customFormations || [];

// ---- Plan-level helpers used inside commit() ----------------------------

const planOf = (doc) => doc.plans.find((p) => p.id === doc.activePlanId);
const playOf = (doc) => findPlay(doc, S.ui.playId);
const teamOfId = (plan, id) => (plan.teams.home.players.some((p) => p.id === id) ? 'home' : 'away');

// ---- Board & players ----------------------------------------------------

export function shapeFor(id, doc = S.doc) {
  if (SYSTEM_BY_ID[id]) return SYSTEM_BY_ID[id];
  return formationById(id, doc.customFormations);
}

export function applyFormation(side, id) {
  const f = shapeFor(id);
  if (!f) return;
  commit((doc) => {
    const plan = planOf(doc);
    const team = plan.teams[side];
    // Keep each player on the slot that best matches their current role, so
    // a fullback stays a fullback when the shape changes.
    const order = matchPlayersToSlots(team.players, f.slots, side);
    const other = plan.teams[side === 'home' ? 'away' : 'home'].players;
    const placed = order.map((pi, si) => {
      const p = team.players[pi];
      const sl = f.slots[si];
      return { ...p, ...slotToPoint(sl, side), label: sl.label, role: sl.role, gk: si === 0 };
    });
    team.players = separate(placed, other, 4.2);
    team.formation = f.id;
    const play = findPlay(doc, S.ui.playId);
    if (play) for (const p of team.players) play.start.pos[p.id] = { x: p.x, y: p.y };
  });
  setUI({ formationAnim: { at: Date.now(), side, label: f.title || f.name, color: activePlan(S).teams[side].primary } });
}

// Pair current players with the new slots: closest position, same kind of role,
// goalkeeper stays in goal. Returns order[slotIndex] = playerIndex.
function matchPlayersToSlots(players, slots, side) {
  const targets = slots.map((sl) => slotToPoint(sl, side));
  const cost = slots.map((sl, si) => players.map((p, pi) => {
    if ((si === 0) !== (pi === 0)) return 1e4;
    return dist(p, targets[si]) + (roleBase(p.role) === roleBase(sl.role) ? 0 : 9);
  }));
  return assign(cost);
}

export function updateTeam(side, patch) {
  commit((doc) => {
    const plan = planOf(doc);
    if ('name' in patch) renameInPlanName(plan, plan.teams[side].name, patch.name);
    Object.assign(plan.teams[side], patch);
    // Renaming or recoloring the opponent on the board updates their scouting profile too.
    const o = side === 'away' && plan.opponentId ? doc.opponents.find((q) => q.id === plan.opponentId) : null;
    if (o) {
      if ('name' in patch) { o.name = patch.name; delete o.sample; }
      if ('primary' in patch) o.primary = patch.primary;
      if ('secondary' in patch) o.secondary = patch.secondary;
    }
  });
}

export function updatePlayer(id, patch) {
  commit((doc) => {
    const plan = planOf(doc);
    const p = plan.teams[teamOfId(plan, id)].players.find((q) => q.id === id);
    if (!p) return false;
    if (patch.label && !patch.role && POSITION_ROLE[patch.label] && roleBase(p.role) !== POSITION_ROLE[patch.label]) patch = { ...patch, role: POSITION_ROLE[patch.label] };
    Object.assign(p, patch);
  });
}

// Move players on the board, or in a play's starting positions when a play is open on step 1.
export function movePlayers(moves) {
  const r = (v) => Math.round(v * 10) / 10;
  moves = Object.fromEntries(Object.entries(moves).map(([id, p]) => [id, { x: r(p.x), y: r(p.y) }]));
  commit((doc) => {
    const plan = planOf(doc);
    const play = findPlay(doc, S.ui.playId);
    if (play) {
      for (const id in moves) play.start.pos[id] = moves[id];
    } else {
      for (const id in moves) {
        const p = plan.teams[teamOfId(plan, id)].players.find((q) => q.id === id);
        if (p) { p.x = moves[id].x; p.y = moves[id].y; }
      }
    }
  });
}

export function resetToFormation(side) {
  const plan = activePlan(S);
  applyFormation(side, plan.teams[side].formation);
}

export function saveCustomFormation(name, side = 'home') {
  const plan = activePlan(S);
  const team = plan.teams[side];
  const play = activePlay(S);
  const slots = team.players.map((p) => {
    const pos = play ? play.start.pos[p.id] || p : p;
    const sl = pointToSlot(pos, side);
    return { label: p.label, role: p.role, d: Math.round(sl.d * 1000) / 1000, w: Math.round(sl.w * 1000) / 1000 };
  });
  const id = uid('cf_');
  commit((doc) => {
    doc.customFormations.push({ id, name: name || 'Custom shape', slots });
    planOf(doc).teams[side].formation = id;
  });
  toast(`Saved "${name || 'Custom shape'}"`, 'good');
}

export function deleteCustomFormation(id) {
  commit((doc) => { doc.customFormations = doc.customFormations.filter((f) => f.id !== id); });
}

// ---- Plays & steps -------------------------------------------------------

function defaultBallOwner(plan) {
  const cand = plan.teams.home.players.filter((p) => !p.gk);
  let best = cand[0], bd = Infinity;
  for (const p of cand) {
    const d = dist(p, { x: 30, y: 30 });
    if (d < bd) { bd = d; best = p; }
  }
  return best?.id || null;
}

export function newPlay(name, opts = {}) {
  const plan = activePlan(S);
  const id = uid('play_');
  const pos = boardPositions(plan);
  commit((doc) => {
    const p = planOf(doc);
    p.plays.push({ id, name: name || `Play ${p.plays.length + 1}`, start: { pos, ball: { owner: opts.owner || defaultBallOwner(plan) } }, steps: [newStep()] });
  });
  setUI({ playId: id, step: 0, sel: null });
  return id;
}

export function selectPlay(id) {
  setUI({ playId: id, step: 0, sel: null, playing: false });
}

export function renamePlay(id, name) {
  commit((doc) => { const p = findPlay(doc, id); if (p) p.name = name; });
}

export function updatePlay(id, patch) {
  commit((doc) => { const p = findPlay(doc, id); if (p) Object.assign(p, patch); });
}

export function duplicatePlay(id) {
  const nid = uid('play_');
  commit((doc) => {
    const list = listOf(doc, id);
    if (!list) return false;
    const i = list.findIndex((q) => q.id === id);
    const copy = structuredClone(list[i]);
    copy.id = nid; copy.name = list[i].name.replace(/ \(example\)$/, '') + ' (copy)';
    copy.steps.forEach((st) => { st.id = uid('st_'); st.actions.forEach((a) => { a.id = uid('ac_'); }); });
    list.splice(i + 1, 0, copy);
  });
  setUI({ playId: nid, step: 0, sel: null });
}

export function deletePlay(id) {
  commit((doc) => {
    const plan = planOf(doc);
    plan.plays = plan.plays.filter((q) => q.id !== id);
    doc.setPieces = doc.setPieces.filter((q) => q.id !== id);
  });
  if (S.ui.playId === id) setUI({ playId: null, step: 0, sel: null });
}

// ---- Set pieces -----------------------------------------------------------

export function createSetPiece(typeId, spot, name) {
  const plan = activePlan(S);
  const play = buildSetPiece(typeId, plan, name, spot);
  commit((doc) => { doc.setPieces.push(play); });
  setUI({ playId: play.id, step: 0, sel: null, spPick: null, flood: { color: plan.teams.home.primary, at: Date.now() } });
  return play.id;
}

// ---- Reset ----------------------------------------------------------------

// Put both teams back on their formation spots (on the board, or at the start of the open play).
export function resetPositions() {
  const plan = activePlan(S);
  const play = activePlay(S);
  if (play?.kind === 'setpiece' && play.spType) {
    const fresh = buildSetPiece(play.spType, plan, play.name, play.spot);
    commit((doc) => { const p = findPlay(doc, play.id); p.start = fresh.start; });
    setUI({ formationAnim: { at: Date.now(), side: 'home', label: 'Reset', color: plan.teams.home.primary }, sel: null });
    return;
  }
  commit((doc) => {
    const pl = planOf(doc);
    for (const side of ['home', 'away']) {
      const team = pl.teams[side];
      const f = shapeFor(team.formation, doc);
      if (!f) continue;
      const order = matchPlayersToSlots(team.players, f.slots, side);
      team.players = order.map((pi, si) => ({ ...team.players[pi], ...slotToPoint(f.slots[si], side), label: f.slots[si].label, role: f.slots[si].role, gk: si === 0 }));
    }
    pl.teams.away.players = separate(pl.teams.away.players, pl.teams.home.players, 4.2);
    const p = findPlay(doc, S.ui.playId);
    if (p) for (const side of ['home', 'away']) for (const q of pl.teams[side].players) p.start.pos[q.id] = { x: q.x, y: q.y };
  });
  setUI({ formationAnim: { at: Date.now(), side: 'home', label: 'Reset', color: activePlan(S).teams.home.primary }, sel: null });
}

export function clearStep() {
  if (!activePlay(S)) return;
  commit((doc) => { const st = playOf(doc).steps[S.ui.step]; st.actions = []; });
  setUI({ sel: null });
}

export function clearPlay() {
  if (!activePlay(S)) return;
  commit((doc) => { const p = playOf(doc); p.steps = [newStep(p.steps[0]?.duration || 2)]; });
  setUI({ sel: null, step: 0 });
}

export function resetView() {
  S = { ...S, prefs: { ...DEFAULT_PREFS } };
  emit();
  idb.set(PREFS_KEY, S.prefs);
}

export function setStep(k) {
  const play = activePlay(S);
  if (!play) return;
  setUI({ step: Math.max(0, Math.min(play.steps.length - 1, k)), sel: null });
}

export function addStep() {
  const play = activePlay(S);
  if (!play) { newPlay(); return; }
  const at = S.ui.step + 1;
  commit((doc) => { playOf(doc).steps.splice(at, 0, newStep(play.steps[S.ui.step]?.duration || 2)); });
  setUI({ step: at, sel: null });
}

export function duplicateStep(k = S.ui.step) {
  commit((doc) => {
    const play = playOf(doc);
    const copy = structuredClone(play.steps[k]);
    copy.id = uid('st_');
    copy.actions.forEach((a) => { a.id = uid('ac_'); });
    play.steps.splice(k + 1, 0, copy);
  });
  setUI({ step: k + 1, sel: null });
}

export function deleteStep(k = S.ui.step) {
  const play = activePlay(S);
  if (!play) return;
  if (play.steps.length === 1) {
    commit((doc) => { playOf(doc).steps[0].actions = []; playOf(doc).steps[0].caption = ''; });
    return;
  }
  commit((doc) => { playOf(doc).steps.splice(k, 1); });
  setUI({ step: Math.max(0, Math.min(k, play.steps.length - 2)), sel: null });
}

export function moveStep(from, to) {
  const play = activePlay(S);
  if (!play || to < 0 || to >= play.steps.length || from === to) return;
  commit((doc) => {
    const steps = playOf(doc).steps;
    const [st] = steps.splice(from, 1);
    steps.splice(to, 0, st);
  });
  setUI({ step: to });
}

export function updateStep(k, patch) {
  commit((doc) => { Object.assign(playOf(doc).steps[k], patch); });
}

export function addAction(action) {
  let play = activePlay(S);
  if (!play) { newPlay(); play = activePlay(S); }
  const a = { id: uid('ac_'), to: null, target: null, curve: 0, delay: 0, lofted: false, move: action.type === 'press', color: null, ...action };
  let replaced = false;
  commit((doc) => {
    const st = playOf(doc).steps[S.ui.step];
    // One movement per player per step: a new run or dribble replaces the old one.
    if (a.type === 'run' || a.type === 'dribble') st.actions = st.actions.filter((x) => !(x.from === a.from && (x.type === 'run' || x.type === 'dribble')));
    if (a.type === 'press') st.actions = st.actions.filter((x) => !(x.type === 'press' && x.from === a.from));
    // One pass, dribble or shot per step: the newest one wins.
    if (BALL_ACTIONS.has(a.type)) {
      if (st.actions.some((x) => BALL_ACTIONS.has(x.type))) replaced = true;
      st.actions = st.actions.filter((x) => !BALL_ACTIONS.has(x.type) || (a.type === 'dribble' && x.from === a.from && x.type === 'dribble'));
      if (a.type === 'dribble') st.actions = st.actions.filter((x) => !(x.from === a.from && x.type === 'run'));
    }
    st.actions.push(a);
  });
  setUI({ sel: { kind: 'action', id: a.id }, lastCreated: { id: a.id, at: Date.now() } });
  if (replaced) toast('One pass, dribble or shot per step. Replaced the previous one.');
  return a.id;
}

export function updateAction(id, patch, opts) {
  commit((doc) => {
    for (const st of playOf(doc)?.steps || []) {
      const a = st.actions.find((x) => x.id === id);
      if (a) { Object.assign(a, patch); return; }
    }
    return false;
  }, opts);
}

export function deleteAction(id) {
  commit((doc) => {
    for (const st of playOf(doc)?.steps || []) st.actions = st.actions.filter((x) => x.id !== id);
  });
  setUI({ sel: null });
}

export function setBall(ball) {
  commit((doc) => { const play = playOf(doc); if (play) play.start.ball = ball; });
}

export function deleteSelection() {
  const sel = S.ui.sel;
  if (sel?.kind === 'action') deleteAction(sel.id);
}

// ---- Plans --------------------------------------------------------------

export function selectPlan(id) {
  S = { ...S, doc: { ...S.doc, activePlanId: id }, past: [], future: [] };
  const plan = activePlan(S);
  S.ui = { ...S.ui, playId: plan?.plays[0]?.id ?? null, step: 0, sel: null, playing: false };
  scheduleSave();
  emit();
}

export function createPlan(name) {
  const p = newPlan(name);
  commit((doc) => { doc.plans.push(p); });
  selectPlan(p.id);
}

export function duplicatePlan(id) {
  const src = S.doc.plans.find((p) => p.id === id);
  if (!src) return;
  const copy = structuredClone(src);
  copy.id = uid('plan_'); copy.name = src.name + ' (copy)'; copy.createdAt = copy.updatedAt = Date.now();
  commit((doc) => { doc.plans.push(copy); });
  selectPlan(copy.id);
}

export function renamePlan(id, name) {
  commit((doc) => { const p = doc.plans.find((q) => q.id === id); if (p) p.name = name; });
}

export function deletePlan(id) {
  if (S.doc.plans.length === 1) {
    const p = newPlan('Game plan');
    commit((doc) => { doc.plans = [p]; doc.activePlanId = p.id; });
    selectPlan(p.id);
    return;
  }
  const wasActive = S.doc.activePlanId === id;
  commit((doc) => { doc.plans = doc.plans.filter((p) => p.id !== id); if (wasActive) doc.activePlanId = doc.plans[0].id; });
  if (wasActive) selectPlan(S.doc.plans[0].id);
}

export function updatePlan(patch) {
  commit((doc) => {
    const plan = planOf(doc);
    Object.assign(plan, patch);
    const o = patch.opponentId ? doc.opponents.find((q) => q.id === patch.opponentId) : null;
    if (o) { renameInPlanName(plan, plan.teams.away.name, cleanName(o.name)); plan.teams.away.name = cleanName(o.name); plan.teams.away.primary = o.primary; plan.teams.away.secondary = o.secondary; }
  });
}

// ---- Roster -------------------------------------------------------------

export function addRosterPlayer() {
  if (S.doc.roster.length >= 30) { toast('The squad is full (30 players).', 'risk'); return null; }
  const used = new Set(S.doc.roster.map((r) => r.number));
  let n = 1; while (used.has(n)) n++;
  const r = {
    id: uid('r_'), name: 'New player', number: n, foot: 'R', positions: [], available: true, notes: '',
    attrs: { pace: 3, shooting: 3, passing: 3, dribbling: 3, vision: 3, defending: 3, physical: 3, stamina: 3, goalkeeping: 1 },
  };
  commit((doc) => { doc.roster.push(r); });
  setUI({ rosterId: r.id });
  return r.id;
}

export function updateRosterPlayer(id, patch) {
  commit((doc) => {
    const r = doc.roster.find((q) => q.id === id);
    if (!r) return false;
    Object.assign(r, patch);
    delete r.sample;
    // Keep linked board players in step with name and number changes.
    for (const plan of doc.plans) for (const side of ['home', 'away']) for (const p of plan.teams[side].players) {
      if (p.rosterId === id) { p.name = r.name; p.num = r.number; }
    }
  });
}

export function deleteRosterPlayer(id) {
  commit((doc) => {
    doc.roster = doc.roster.filter((r) => r.id !== id);
    for (const plan of doc.plans) for (const side of ['home', 'away']) for (const p of plan.teams[side].players) if (p.rosterId === id) p.rosterId = null;
  });
}

export function clearSampleData() {
  commit((doc) => {
    const ids = new Set(doc.roster.filter((r) => r.sample).map((r) => r.id));
    doc.roster = doc.roster.filter((r) => !r.sample);
    for (const plan of doc.plans) for (const p of plan.teams.home.players) if (ids.has(p.rosterId)) p.rosterId = null;
  });
  toast('Example squad removed.');
}

export function assignRoster(playerId, rosterId) {
  commit((doc) => {
    const plan = planOf(doc);
    const r = doc.roster.find((q) => q.id === rosterId);
    const side = teamOfId(plan, playerId);
    const team = plan.teams[side];
    // A squad player can only fill one spot: clear them from any other spot first.
    for (const p of team.players) if (p.rosterId === rosterId && p.id !== playerId) { p.rosterId = null; }
    const p = team.players.find((q) => q.id === playerId);
    if (!p) return false;
    if (!r) { p.rosterId = null; return; }
    p.rosterId = r.id; p.name = r.name; p.num = r.number;
  });
}

export function applyLineup(lineup, formationId) {
  if (formationId) applyFormation('home', formationId);
  commit((doc) => {
    const team = planOf(doc).teams.home;
    lineup.forEach((l, i) => {
      const p = team.players[i];
      if (!p) return;
      if (l.player) { p.rosterId = l.player.id; p.name = l.player.name; p.num = l.player.number; }
    });
  });
  toast('Lineup applied to the board.', 'good');
}

// ---- Opponents ----------------------------------------------------------

export function addOpponent() {
  const o = { id: uid('opp_'), name: 'New opponent', formation: '4-4-2', primary: '#b3122e', secondary: '#f6f1ea', notes: '', tags: [], keyPlayers: [], ratings: {} };
  commit((doc) => { doc.opponents.push(o); });
  setUI({ scoutId: o.id });
  return o.id;
}

const cleanName = (n) => (n || '').replace(/\s*\(example\)$/i, '');

export function updateOpponent(id, patch) {
  commit((doc) => {
    const o = doc.opponents.find((q) => q.id === id);
    if (!o) return false;
    Object.assign(o, patch);
    delete o.sample;
    // Keep every game plan that faces this opponent in step: name and colors on the board.
    for (const plan of doc.plans) {
      if (plan.opponentId !== id) continue;
      const t = plan.teams.away;
      if ('name' in patch) { const nn = cleanName(o.name) || 'Opponent'; renameInPlanName(plan, t.name, nn); t.name = nn; }
      if ('primary' in patch) t.primary = o.primary;
      if ('secondary' in patch) t.secondary = o.secondary;
    }
  });
}

export function deleteOpponent(id) {
  commit((doc) => {
    doc.opponents = doc.opponents.filter((o) => o.id !== id);
    for (const p of doc.plans) if (p.opponentId === id) p.opponentId = null;
  });
  if (S.ui.scoutId === id) setUI({ scoutId: null });
}

export function loadOpponentOnBoard(id) {
  const o = S.doc.opponents.find((q) => q.id === id);
  if (!o) return;
  commit((doc) => {
    const plan = planOf(doc);
    plan.opponentId = o.id;
    const t = plan.teams.away;
    renameInPlanName(plan, t.name, cleanName(o.name));
    t.name = cleanName(o.name);
    t.primary = o.primary; t.secondary = o.secondary;
  });
  applyFormation('away', o.formation);
  setUI({ flood: { color: o.primary, at: Date.now() } });
  toast(`${o.name} loaded as the opponent.`);
}

// ---- Import / export ----------------------------------------------------

export function exportPlanData(planId = S.doc.activePlanId) {
  const plan = S.doc.plans.find((p) => p.id === planId);
  const rosterIds = new Set(plan.teams.home.players.map((p) => p.rosterId).filter(Boolean));
  const usedForms = new Set([plan.teams.home.formation, plan.teams.away.formation]);
  return {
    app: 'soccer-tactics-board', kind: 'game-plan', version: 1, exportedAt: new Date().toISOString(),
    plan,
    opponent: S.doc.opponents.find((o) => o.id === plan.opponentId) || null,
    roster: S.doc.roster.filter((r) => rosterIds.has(r.id)),
    customFormations: S.doc.customFormations.filter((f) => usedForms.has(f.id)),
    setPieces: S.doc.setPieces,
  };
}

export function importPlanData(data) {
  if (!data || data.app !== 'soccer-tactics-board' || !data.plan?.teams?.home?.players) {
    throw new Error('This file is not a Soccer Tactics Board game plan.');
  }
  const plan = structuredClone(data.plan);
  if (S.doc.plans.some((p) => p.id === plan.id)) { plan.id = uid('plan_'); plan.name += ' (imported)'; }
  commit((doc) => {
    doc.plans.push(plan);
    if (data.opponent && !doc.opponents.some((o) => o.id === data.opponent.id)) doc.opponents.push(data.opponent);
    for (const r of data.roster || []) if (!doc.roster.some((q) => q.id === r.id) && doc.roster.length < 30) doc.roster.push(r);
    for (const f of data.customFormations || []) if (!doc.customFormations.some((q) => q.id === f.id)) doc.customFormations.push(f);
    for (const sp of data.setPieces || []) if (!doc.setPieces.some((q) => q.id === sp.id)) doc.setPieces.push(sp);
    reconcileOpponents(doc);
  });
  selectPlan(plan.id);
  return plan;
}

export function resetWorkspace() {
  const doc = migrate(makeSampleWorkspace());
  const team = teamFromDoc(doc);
  S = { ...S, club: { version: 2, teams: [team], activeTeamId: team.id }, doc, past: [], future: [], ui: { ...S.ui, playId: doc.plans[0].plays[0]?.id ?? null, step: 0, sel: null } };
  scheduleSave();
  emit();
}

export { makeTeam };
