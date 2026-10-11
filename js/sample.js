// Builders for teams, plans and the example workspace shown on first open.

import { FORMATIONS } from './data.js';
import { slotToPoint } from './analysis.js';
import { separate } from './geometry.js';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9);
export const formationById = (id, customs = []) => FORMATIONS.find((f) => f.id === id) || customs.find((f) => f.id === id) || FORMATIONS[1];

const NUMBER_FOR = { GK: 1, RB: 2, LB: 3, RCB: 4, LCB: 5, CB: 6, CDM: 6, LDM: 6, RDM: 8, LCM: 8, CM: 8, RCM: 10, CAM: 10, LM: 11, RM: 7, LAM: 11, RAM: 7, LW: 11, RW: 7, ST: 9, LS: 9, RS: 10, CF: 9, LWB: 3, RWB: 2 };

export function makeTeam(side, formationId, opts = {}) {
  const f = formationById(formationId);
  const used = new Set();
  const players = f.slots.map((s, i) => {
    let num = NUMBER_FOR[s.label] || 12;
    while (used.has(num)) num = num < 12 ? 12 : num + 1;
    used.add(num);
    return {
      id: side[0] + (i + 1), num, name: opts.names?.[i] || '', label: s.label, role: s.role, notes: '',
      ...slotToPoint(s, side), gk: i === 0, rosterId: null,
    };
  });
  return {
    name: opts.name || (side === 'home' ? 'Home' : 'Away'),
    primary: opts.primary || (side === 'home' ? '#1c2f5f' : '#b3122e'),
    secondary: opts.secondary || (side === 'home' ? '#f3f5f7' : '#f6f1ea'),
    gkPrimary: side === 'home' ? '#f2d02b' : '#3fcf86',
    gkSecondary: side === 'home' ? '#1a1a1a' : '#0f2f1f',
    pattern: opts.pattern || 'solid',
    numColor: 'auto',
    formation: f.id,
    visible: true,
    players,
  };
}

export function newPlan(name = 'New game plan') {
  const home = makeTeam('home', '4-3-3', { name: 'Your team' });
  const away = makeTeam('away', '4-4-2', { name: 'Opponent' });
  away.players = separate(away.players, home.players);
  return {
    id: uid('plan_'), name, notes: '', opponentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    teams: { home, away },
    plays: [],
  };
}

export function newStep(duration = 2) {
  return { id: uid('st_'), caption: '', duration, actions: [] };
}

const A = (type, from, extra) => ({ id: uid('ac_'), type, from, to: null, target: null, curve: 0, delay: 0, lofted: false, move: false, color: null, ...extra });

function samplePlay(plan) {
  const pos = {};
  for (const side of ['home', 'away']) for (const p of plan.teams[side].players) pos[p.id] = { x: p.x, y: p.y };
  return {
    id: uid('play_'), name: 'Overlap down the left',
    start: { pos, ball: { owner: 'h3' } },
    steps: [
      { id: uid('st_'), duration: 2.2, caption: 'Center back finds the left eight between the lines', actions: [
        A('pass', 'h3', { to: 'h7' }),
        A('run', 'h2', { target: { x: 46, y: 5 } }),
        A('run', 'h9', { target: { x: 66, y: 9 }, curve: 1.5 }),
        A('press', 'a8', { to: 'h7', move: true }),
      ] },
      { id: uid('st_'), duration: 2.2, caption: 'Eight plays it wide; left back starts the overlap', actions: [
        A('pass', 'h7', { to: 'h9' }),
        A('run', 'h2', { target: { x: 72, y: 4 } }),
        A('run', 'h7', { target: { x: 61, y: 19 } }),
        A('press', 'a5', { to: 'h9', move: true }),
      ] },
      { id: uid('st_'), duration: 2.4, caption: 'Winger drives inside and drags the fullback with him', actions: [
        A('dribble', 'h9', { target: { x: 77, y: 19 }, curve: -3 }),
        A('run', 'h2', { target: { x: 86, y: 5 }, curve: 1 }),
        A('run', 'h10', { target: { x: 90, y: 31 }, curve: 2 }),
        A('press', 'a5', { to: 'h9', move: true }),
      ] },
      { id: uid('st_'), duration: 2.4, caption: 'Slip the overlap in behind; striker attacks the near post', actions: [
        A('pass', 'h9', { target: { x: 93, y: 8 } }),
        A('run', 'h2', { target: { x: 93, y: 7 }, curve: 1 }),
        A('run', 'h10', { target: { x: 98, y: 29 } }),
        A('run', 'h11', { target: { x: 95, y: 44 }, curve: -3 }),
        A('run', 'a4', { target: { x: 96, y: 31 } }),
      ] },
    ],
  };
}

// Attribute order: pace, shooting, passing, dribbling, vision, defending, physical, stamina, goalkeeping.
const KEYS = ['pace', 'shooting', 'passing', 'dribbling', 'vision', 'defending', 'physical', 'stamina', 'goalkeeping'];
const R = (name, number, foot, positions, vals) => ({
  id: uid('r_'), name, number, foot, positions, attrs: Object.fromEntries(KEYS.map((k, i) => [k, vals[i]])),
  available: true, notes: '', sample: true,
});

export function sampleRoster() {
  return [
    R('Rivera', 1, 'R', ['GK'], [2, 1, 4, 2, 3, 2, 4, 3, 5]),
    R('Brooks', 3, 'L', ['LB', 'LWB'], [4, 2, 3, 3, 3, 3, 3, 5, 1]),
    R('Okafor', 5, 'L', ['LCB', 'CB'], [3, 1, 4, 2, 4, 5, 4, 3, 1]),
    R('Lindqvist', 4, 'R', ['RCB', 'CB'], [2, 2, 3, 1, 2, 5, 5, 4, 1]),
    R('Tanaka', 2, 'R', ['RB', 'RWB'], [5, 2, 3, 3, 3, 3, 2, 4, 1]),
    R('Mensah', 6, 'R', ['CDM', 'CM'], [3, 2, 4, 2, 3, 4, 4, 4, 1]),
    R('Costa', 8, 'L', ['LCM', 'CM', 'CAM'], [3, 3, 5, 4, 5, 2, 2, 4, 1]),
    R('Byrne', 10, 'R', ['RCM', 'CM'], [3, 3, 3, 3, 3, 3, 4, 5, 1]),
    R('Silva', 11, 'L', ['LW', 'LM'], [5, 3, 3, 5, 3, 1, 2, 3, 1]),
    R('Kowalski', 9, 'R', ['ST', 'CF'], [4, 5, 3, 4, 3, 2, 3, 3, 1]),
    R('Haddad', 7, 'R', ['RW', 'RM'], [4, 4, 4, 4, 4, 2, 2, 4, 1]),
    R('Nguyen', 12, 'R', ['GK'], [3, 1, 3, 2, 3, 2, 3, 3, 4]),
    R('Petrov', 14, 'R', ['CB', 'CDM'], [2, 1, 2, 1, 2, 5, 5, 3, 1]),
    R('Adeyemi', 15, 'L', ['LWB', 'LM'], [5, 2, 2, 3, 2, 3, 3, 5, 1]),
    R('Moreau', 16, 'R', ['CM', 'CAM'], [3, 3, 5, 4, 5, 2, 2, 3, 1]),
    R('Schmidt', 18, 'R', ['CF', 'ST'], [2, 4, 4, 2, 3, 3, 5, 4, 1]),
    R('Ortiz', 19, 'B', ['ST', 'RW'], [5, 4, 2, 4, 2, 1, 2, 3, 1]),
    R('Walsh', 20, 'R', ['RB', 'CB'], [3, 1, 3, 2, 2, 4, 4, 4, 1]),
  ];
}

export function sampleOpponent() {
  return {
    id: uid('opp_'), name: 'Riverside (example)', formation: '4-4-2', primary: '#b3122e', secondary: '#f6f1ea',
    notes: 'Example scouting profile. Aggressive front two, center backs struggle turning.',
    tags: ['presses-high', 'slow-cbs'],
    ratings: { blPace: 2, blAir: 4, midControl: 3, press: 5, attPace: 4, wide: 3 },
    keyPlayers: [
      { id: uid('kp_'), name: '#9 Target man', note: 'Wins headers; mark tightly on set pieces' },
      { id: uid('kp_'), name: '#7 Right mid', note: 'Fast, cuts inside on his left foot' },
    ],
    sample: true,
  };
}

export function makeSampleWorkspace() {
  const plan = newPlan('vs Riverside');
  const roster = sampleRoster();
  const opp = sampleOpponent();
  plan.opponentId = opp.id;
  plan.notes = 'Example plan. Their back four steps up; play early balls in behind the fullbacks.';
  plan.teams.away = makeTeam('away', '4-4-2', { name: 'Riverside', primary: opp.primary, secondary: opp.secondary });
  plan.teams.away.players = separate(plan.teams.away.players, plan.teams.home.players);
  plan.teams.home.name = 'Your team';
  // Link the starting eleven to the example squad.
  plan.teams.home.players.forEach((p, i) => {
    const r = roster[i];
    p.rosterId = r.id; p.name = r.name; p.num = r.number;
  });
  plan.plays.push(samplePlay(plan));
  return { version: 1, plans: [plan], activePlanId: plan.id, roster, opponents: [opp], customFormations: [] };
}
