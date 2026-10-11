// The tactics board: an SVG pitch in meters, with players, action lines, the ball,
// zone overlay and all pointer interactions (mouse, pen and touch).

import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, useReducer } from './lib.js';
import {
  useStore, getState, activePlan, activePlay, timelineFor, boardPositions, playerIndex, sideMap,
  setUI, movePlayers, addAction, updateAction, setBall, toast, newPlay, defenseOpts,
} from './store.js';
import { usePB, stop as stopPlayback, useTicker } from './player.js';
import {
  PITCH, viewMatrix, invertM, applyM, viewBox, makePath, pathD, arrowHead, handlePoint, curveFromHandle,
  clampToPitch, dist, zoneRect, clamp, lerpPt, lerp, ease,
} from './geometry.js';
import { buildTimeline, frameAt, RECEIVE_RADIUS, BALL_ACTIONS } from './playback.js';
import { PITCH_THEMES, ACTION_LINE, ACTION_NAMES } from './data.js';
import { zoneCounts, slotFit, FIT_LOW } from './analysis.js';
import { inkOn, alpha, luminance } from './ui.js';
import { SET_PIECE_BY_ID } from './setpieces.js';
import { spaceControl } from './defense.js';
import { sfx } from './audio.js';

const PREVIEW = '__preview';
const f2 = (v) => Math.round(v * 100) / 100;

function useSize(ref) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setSize({ w: r.width || 900, h: r.height || 600 });
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return size;
}

export function viewFor(prefs, size, areaOverride) {
  const orient = prefs.orient === 'auto' ? (size.h > size.w * 1.08 ? 'v' : 'h') : prefs.orient;
  const M = viewMatrix(orient, prefs.flip);
  const area = areaOverride && prefs.area === 'full' ? areaOverride : prefs.area;
  const rect = area === 'attack' ? { x: 45, y: 0, w: 60, h: 68 } : area === 'defend' ? { x: 0, y: 0, w: 60, h: 68 } : { x: 0, y: 0, w: 105, h: 68 };
  const vb = viewBox(M, rect, 3.6);
  const ppm = Math.max(1, Math.min(size.w / vb.w, size.h / vb.h)) || 8;
  return { orient, M, Mi: invertM(M), vb, ppm };
}

// Apply an in-progress drag to a play so the preview uses the real timeline logic.
function previewPlay(play, drag, k) {
  if (!play || !drag) return play;
  if (drag.type === 'move' && k === 0) {
    const pos = { ...play.start.pos };
    for (const id in drag.moves) pos[id] = drag.moves[id];
    return { ...play, start: { ...play.start, pos } };
  }
  if (drag.type === 'ball') return { ...play, start: { ...play.start, ball: drag.ball } };
  if (drag.type === 'draw' && drag.action) {
    const steps = play.steps.slice();
    const st = steps[k];
    let actions = st.actions;
    const a = drag.action;
    if (a.type === 'run' || a.type === 'dribble') actions = actions.filter((x) => !(x.from === a.from && (x.type === 'run' || x.type === 'dribble')));
    if (BALL_ACTIONS.has(a.type)) actions = actions.filter((x) => !BALL_ACTIONS.has(x.type));
    if (a.type === 'press') actions = actions.filter((x) => !(x.type === 'press' && x.from === a.from));
    steps[k] = { ...st, actions: [...actions, { ...a, id: PREVIEW }] };
    return { ...play, steps };
  }
  if ((drag.type === 'curve' || drag.type === 'end') && drag.patch) {
    return {
      ...play,
      steps: play.steps.map((st, i) => (i !== k ? st : { ...st, actions: st.actions.map((a) => (a.id === drag.id ? { ...a, ...drag.patch } : a)) })),
    };
  }
  return play;
}

// Geometry for one action at step k, from the timeline (single source of truth with playback).
function geometryFor(a, tl, k, pos, R) {
  const st = tl.steps[k], s0 = tl.states[k];
  if (!st || !s0.pos[a.from]) return null;
  const bad = tl.invalid.get(a.id);
  if (bad) {
    const p0 = s0.pos[a.from], p2 = a.to ? s0.pos[a.to] : a.target;
    return p2 ? { path: makePath(p0, p2, a.curve || 0), invalid: bad } : null;
  }
  if (a.type === 'run' || a.type === 'dribble') {
    const m = st.paths[a.from];
    return m ? { path: m.path, delay: m.delay } : null;
  }
  if (a.type === 'pass' || a.type === 'shot') return st.ballGeo ? { path: st.ballGeo.path, ball: st.ballGeo } : null;
  if (a.type === 'press') {
    const p0 = pos[a.from], p2 = pos[a.to];
    if (!p0 || !p2) return null;
    const d = dist(p0, p2);
    if (d < R * 2.2) return null;
    const cut = Math.min(0.45, (R + 0.35) / d);
    return { path: makePath(lerpPt(p0, p2, cut), lerpPt(p2, p0, cut), 0), live: true };
  }
  return null;
}

function Markings({ theme, id }) {
  const P = PITCH;
  const stripes = [];
  const n = 16;
  for (let i = 0; i < n; i++) stripes.push(html`<rect x=${(i * P.L) / n} y="0" width=${P.L / n + 0.02} height=${P.W} fill=${i % 2 ? theme.stripeA : theme.stripeB} />`);
  const boxY = (P.W - P.boxW) / 2, sixY = (P.W - P.sixW) / 2, goalY = (P.W - P.goalW) / 2;
  const lw = 0.17;
  return html`<g class="markings">
    <rect x="-60" y="-60" width=${P.L + 120} height=${P.W + 120} fill=${theme.surround} />
    ${stripes}
    <rect x="0" y="0" width=${P.L} height=${P.W} fill=${`url(#${id}-light)`} />
    <g fill="none" stroke=${theme.line} stroke-width=${lw}>
      <rect x="0" y="0" width=${P.L} height=${P.W} />
      <line x1=${P.L / 2} y1="0" x2=${P.L / 2} y2=${P.W} />
      <circle cx=${P.L / 2} cy=${P.W / 2} r=${P.circleR} />
      <rect x="0" y=${boxY} width=${P.boxD} height=${P.boxW} />
      <rect x=${P.L - P.boxD} y=${boxY} width=${P.boxD} height=${P.boxW} />
      <rect x="0" y=${sixY} width=${P.sixD} height=${P.sixW} />
      <rect x=${P.L - P.sixD} y=${sixY} width=${P.sixD} height=${P.sixW} />
      <g clip-path=${`url(#${id}-arcL)`}><circle cx=${P.spot} cy=${P.W / 2} r=${P.circleR} /></g>
      <g clip-path=${`url(#${id}-arcR)`}><circle cx=${P.L - P.spot} cy=${P.W / 2} r=${P.circleR} /></g>
      <g clip-path=${`url(#${id}-field)`}>
        ${[[0, 0], [P.L, 0], [0, P.W], [P.L, P.W]].map(([x, y]) => html`<circle cx=${x} cy=${y} r=${P.cornerR} />`)}
      </g>
      <rect x=${-P.goalD} y=${goalY} width=${P.goalD} height=${P.goalW} fill=${`url(#${id}-net)`} />
      <rect x=${P.L} y=${goalY} width=${P.goalD} height=${P.goalW} fill=${`url(#${id}-net)`} />
    </g>
    <g fill=${theme.line}>
      <circle cx=${P.L / 2} cy=${P.W / 2} r="0.3" />
      <circle cx=${P.spot} cy=${P.W / 2} r="0.3" />
      <circle cx=${P.L - P.spot} cy=${P.W / 2} r="0.3" />
    </g>
  </g>`;
}

function KitDefs({ id, team, side }) {
  const pid = `${id}-kit-${side}`;
  const a = team.primary, b = team.secondary;
  let body;
  switch (team.pattern) {
    case 'stripes': body = html`<rect width="1" height="1" fill=${a} />${[0.14, 0.42, 0.7].map((x) => html`<rect x=${x} y="0" width="0.15" height="1" fill=${b} />`)}`; break;
    case 'hoops': body = html`<rect width="1" height="1" fill=${a} />${[0.2, 0.52].map((y) => html`<rect x="0" y=${y} width="1" height="0.16" fill=${b} />`)}<rect x="0" y="0.84" width="1" height="0.16" fill=${b} />`; break;
    case 'halves': body = html`<rect width="1" height="1" fill=${a} /><rect x="0.5" y="0" width="0.5" height="1" fill=${b} />`; break;
    case 'sash': body = html`<rect width="1" height="1" fill=${a} /><polygon points="0,0.18 0.18,0 1,0.82 0.82,1" fill=${b} />`; break;
    default: body = html`<rect width="1" height="1" fill=${a} />`;
  }
  return html`<pattern id=${pid} patternContentUnits="objectBoundingBox" width="1" height="1">${body}</pattern>`;
}

export function Pitch({ presenting = false, svgRef: outerRef }) {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const prefs = useStore((s) => s.prefs);
  const ui = useStore((s) => s.ui);
  const roster = useStore((s) => s.doc.roster);
  const pb = usePB();
  const wrap = useRef();
  const svgLocal = useRef();
  const svg = outerRef || svgLocal;
  const measured = useSize(wrap);
  const size = measured || { w: 900, h: 600 };
  // Skip token transitions until the board has settled at its real size.
  const [settled, setSettled] = useState(false);
  useEffect(() => { if (measured && !settled) { const t = setTimeout(() => setSettled(true), 120); return () => clearTimeout(t); } }, [measured]);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const trailRef = useRef([]);
  const uid = 'pt';

  // Set pieces zoom to the half where they happen.
  const spGroup = play?.kind === 'setpiece' ? SET_PIECE_BY_ID[play.spType]?.group : null;
  const spArea = spGroup === 'Defending' ? 'defend' : spGroup === 'Attacking' ? 'attack' : null;
  const { orient, M, Mi, vb, ppm } = viewFor(prefs, size, spArea);
  const K = clamp(7.5 / ppm, 0.85, 1.38);
  const R = ({ s: 1.6, m: 1.95, l: 2.35 }[prefs.tokenSize] || 1.95) * K;
  const carry = R + 0.7;
  const labelFont = Math.max(1.25, 10.5 / ppm);
  const hitR = Math.max(R * 1.15, 22 / ppm);
  const theme = PITCH_THEMES[prefs.pitchTheme] || PITCH_THEMES.night;
  const idx = useMemo(() => playerIndex(plan), [plan.teams]);
  const sides = useMemo(() => sideMap(plan), [plan.teams]);
  const showAway = prefs.showAway && plan.teams.away.visible !== false;
  const showHome = plan.teams.home.visible !== false;

  const k = play ? clamp(pb.active ? pb.step : ui.step, 0, play.steps.length - 1) : 0;
  const pPlay = useMemo(() => previewPlay(play, drag, k), [play, drag, k]);
  const tl = pPlay ? (pPlay === play ? timelineFor(plan, play, carry) : buildTimeline(pPlay, sides, { carry, defense: defenseOpts(plan, pPlay, prefs) })) : null;

  // Positions and ball for the frame being shown.
  const flow = prefs.playStyle !== 'coach';
  let pos, ball = null;
  if (tl) {
    const f = frameAt(tl, k, pb.active ? pb.t : 0, { flow: pb.active && flow });
    pos = f.pos; ball = f.ball;
  } else {
    pos = boardPositions(plan);
    if (drag?.type === 'move') pos = { ...pos, ...drag.moves };
  }
  if (drag?.type === 'move' && tl && k > 0) pos = { ...pos, ...drag.moves };

  const live = pb.active;
  const moving = pb.active && pb.phase === 'move';
  const V = (p) => applyM(M, p);

  // ---- Broadcast camera: during playback, ease toward the ball and the runners. ----
  const camRef = useRef(null);
  const camT = useRef(0);
  const [, camTick] = useReducer((x) => x + 1, 0);
  const g0 = live && tl ? tl.steps[k]?.ballGeo : null;
  let target = vb;
  if (live && ball && prefs.camera === 'follow') {
    const zoom = presenting ? 1.55 : 1.3;
    const vbBall = V(ball);
    const movers = Object.keys(tl.steps[k]?.paths || {}).map((id) => V(pos[id]));
    const avg = movers.length ? { x: movers.reduce((a, q) => a + q.x, 0) / movers.length, y: movers.reduce((a, q) => a + q.y, 0) / movers.length } : vbBall;
    const focus = { x: vbBall.x * 0.62 + avg.x * 0.38, y: vbBall.y * 0.62 + avg.y * 0.38 };
    const w = vb.w / zoom, h = vb.h / zoom;
    target = { x: clamp(focus.x - w / 2, vb.x, vb.x + vb.w - w), y: clamp(focus.y - h / 2, vb.y, vb.y + vb.h - h), w, h };
  }
  const nowT = performance.now();
  const camDt = Math.min(0.05, (nowT - (camT.current || nowT)) / 1000);
  camT.current = nowT;
  // The camera only glides while playing and while easing back afterwards;
  // resizes and orientation changes snap straight to the new framing.
  const returning = useRef(false);
  if (live) returning.current = true;
  let cam = camRef.current;
  if (!cam || (!live && !returning.current)) cam = vb;
  const kk = 1 - Math.exp(-camDt * (live ? 3 : 4.5));
  cam = { x: lerp(cam.x, target.x, kk), y: lerp(cam.y, target.y, kk), w: lerp(cam.w, target.w, kk), h: lerp(cam.h, target.h, kk) };
  const camOff = Math.abs(cam.x - vb.x) + Math.abs(cam.y - vb.y) + Math.abs(cam.w - vb.w);
  if (!live && camOff < 0.05) { cam = vb; returning.current = false; }
  camRef.current = cam;
  useEffect(() => {
    if (!live && camOff >= 0.05) { const r = requestAnimationFrame(camTick); return () => cancelAnimationFrame(r); }
  });
  // Camera shake as a shot hits the net.
  let shake = { x: 0, y: 0 };
  if (live && prefs.fx && g0 && g0.kind === 'shot') {
    const us = pb.t - g0.ta;
    if (us >= 0 && us < 0.14) { const a = 0.7 * (1 - us / 0.14); shake = { x: Math.sin(us * 190) * a, y: Math.cos(us * 160) * a }; }
  }
  const viewRect = { x: cam.x + shake.x, y: cam.y + shake.y, w: cam.w, h: cam.h };

  // Ball trail during playback.
  if (ball && moving && ball.moving && prefs.trail) {
    const v = applyM(M, ball);
    const tr = trailRef.current;
    const lastP = tr[tr.length - 1];
    if (!lastP || Math.hypot(lastP.x - v.x, lastP.y - v.y) > 0.25) tr.push({ x: v.x, y: v.y - ball.z * 0.6 });
    if (tr.length > 16) tr.shift();
  } else if (trailRef.current.length) {
    trailRef.current = [];
  }

  // New-arrow draw-on animation in edit mode.
  const lc = ui.lastCreated;
  const drawOnUntil = lc && prefs.drawOn ? lc.at + 460 : 0;
  useTicker(drawOnUntil);

  // Zones.
  const hlZones = ui.highlight?.zones;
  const zones = useMemo(() => {
    if (!prefs.zones && !hlZones) return null;
    const pts = (side) => plan.teams[side].players.map((p) => ({ ...pos[p.id], label: p.label, role: p.role, gk: p.gk, id: p.id }));
    return zoneCounts(showHome ? pts('home') : [], showAway ? pts('away') : [], { includeGK: prefs.includeGK });
  }, [prefs.zones, hlZones, prefs.includeGK, pos, plan.teams, showAway, showHome]);
  const hl = ui.highlight?.zones ? new Set(ui.highlight.zones) : null;
  const inHighlight = (p) => {
    if (!hl) return true;
    const zx = p.x < 35 ? 0 : p.x < 70 ? 1 : 2;
    const ch = [13.84, 24.84, 43.16, 54.16, 68].findIndex((e) => p.y < e);
    return hl.has(zx * 5 + (ch < 0 ? 4 : ch));
  };

  // ---- Pointer handling -------------------------------------------------

  const toPitch = (e) => {
    const el = svg.current;
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const v = pt.matrixTransform(el.getScreenCTM().inverse());
    return applyM(Mi, v);
  };

  const stepStart = () => (tl ? tl.states[k] : { pos: boardPositions(plan), ball: { owner: null } });
  const hasBall = (pid) => {
    const s = stepStart();
    if (!tl) return false;
    if (s.ball.owner) return s.ball.owner === pid;
    return dist(s.pos[pid], s.ball) <= RECEIVE_RADIUS;
  };
  const visibleIds = Object.keys(idx).filter((id) => (idx[id].side === 'home' ? showHome : showAway));

  // Nearest visible player to a pitch point, checking where they start and where they end the step.
  const playerNear = (p, filter = () => true, tol = hitR * 1.1) => {
    let best = null, bd = tol;
    const s = stepStart();
    const ends = tl ? tl.states[k + 1]?.pos : null;
    for (const id of visibleIds) {
      if (!filter(id)) continue;
      for (const q of [s.pos[id], ends?.[id]]) {
        if (!q) continue;
        const d = dist(p, q);
        if (d < bd) { bd = d; best = id; }
      }
    }
    return best;
  };

  // Height and curve from the options strip, scaled to the length of the pass.
  function passStyle(from, end) {
    const height = prefs.passHeight || 'ground';
    const len = end ? dist(stepStart().pos[from], end) : 20;
    const curve = (prefs.passBend || 0) * clamp(len * 0.16, 2.5, 9);
    return { height, lofted: height === 'lofted', curve };
  }

  function buildDrawAction(d, p) {
    const from = d.from;
    const side = sides[from];
    switch (d.tool) {
      case 'pass': {
        const to = playerNear(p, (id) => id !== from && sides[id] === side);
        const end = to ? stepStart().pos[to] : p;
        return { type: 'pass', from, ...(to ? { to } : { target: clampToPitch(p) }), ...passStyle(from, end) };
      }
      case 'shot': {
        const gx = side === 'home' ? PITCH.L + 1.1 : -1.1;
        const target = { x: gx, y: clamp(p.y, 30.9, 37.1) };
        return { type: 'shot', from, target, ...passStyle(from, target) };
      }
      case 'press': {
        const to = playerNear(p, (id) => sides[id] !== side);
        return { type: 'press', from, to, move: true, _target: to ? null : p };
      }
      default:
        return { type: d.tool, from, target: clampToPitch(p) };
    }
  }

  const onDown = (e) => {
    if (presenting) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragRef.current) return;
    if (pb.active) stopPlayback();
    const el = e.target.closest('[data-hit]');
    const hit = el?.dataset.hit || null;
    const id = el?.dataset.id || null;
    const p = toPitch(e);
    svg.current.setPointerCapture?.(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, hit, id, start: p, cx: e.clientX, cy: e.clientY, moved: false, tool: ui.tool };

    // Start a play automatically the first time someone draws on the board.
    if (ui.tool !== 'select' && hit === 'player' && !play) {
      const wantsBall = ['pass', 'dribble', 'shot'].includes(ui.tool);
      newPlay(undefined, { owner: wantsBall ? id : undefined });
      toast('Started a new play. Each step happens at the same time; add steps below.');
    }
  };

  const onMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toPitch(e);
    if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 5) return;
    d.moved = true;
    const s = getState();
    const curPlay = activePlay(s);
    const step = s.ui.step;

    if (d.tool === 'select' || d.hit?.startsWith('handle') || d.hit === 'ball') {
      if (d.hit === 'player') {
        if (curPlay && step > 0) {
          const type = hasBall(d.id) && !curPlay.steps[step].actions.some((a) => BALL_ACTIONS.has(a.type) && !(a.type === 'dribble' && a.from === d.id)) ? 'dribble' : 'run';
          setDrag({ type: 'draw', tool: type, from: d.id, point: p, action: { type, from: d.id, target: clampToPitch(p) } });
        } else {
          const sel = s.ui.sel;
          const ids = sel?.kind === 'players' && sel.ids.includes(d.id) ? sel.ids : [d.id];
          const base = curPlay ? curPlay.start.pos : boardPositions(activePlan(s));
          const dx = p.x - d.start.x, dy = p.y - d.start.y;
          const moves = {};
          for (const id of ids) moves[id] = clampToPitch({ x: base[id].x + dx, y: base[id].y + dy });
          setDrag({ type: 'move', moves, ids });
        }
      } else if (d.hit === 'handle-curve' || d.hit === 'handle-end') {
        const a = curPlay?.steps[step]?.actions.find((x) => x.id === d.id);
        if (!a) return;
        const g = geometryFor(a, timelineFor(activePlan(s), curPlay, carry), step, pos, R);
        if (!g) return;
        if (d.hit === 'handle-curve') {
          setDrag({ type: 'curve', id: d.id, patch: { curve: clamp(curveFromHandle(g.path.p0, g.path.p2, p), -40, 40) } });
        } else if (a.type === 'pass') {
          const to = playerNear(p, (pid) => pid !== a.from && sides[pid] === sides[a.from]);
          setDrag({ type: 'end', id: d.id, patch: to ? { to, target: null } : { to: null, target: clampToPitch(p) } });
        } else if (a.type === 'shot') {
          const gx = sides[a.from] === 'home' ? PITCH.L + 1.1 : -1.1;
          setDrag({ type: 'end', id: d.id, patch: { target: { x: gx, y: clamp(p.y, 30.9, 37.1) } } });
        } else {
          setDrag({ type: 'end', id: d.id, patch: { target: clampToPitch(p) } });
        }
      } else if (d.hit === 'ball' && curPlay && step === 0) {
        const owner = playerNear(p, () => true, hitR * 1.3);
        setDrag({ type: 'ball', ball: owner ? { owner } : { owner: null, ...clampToPitch(p) } });
      } else if (!d.hit || d.hit === 'pitch') {
        setDrag({ type: 'marquee', a: d.start, b: p });
      }
    } else if (d.hit === 'player') {
      const action = buildDrawAction({ tool: d.tool, from: d.id }, p);
      setDrag({ type: 'draw', tool: d.tool, from: d.id, point: p, action, snap: action.to || null });
    }
  };

  const onUp = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const cur = drag;
    setDrag(null);
    const s = getState();

    if (!d.moved) {
      if (d.hit === 'player') {
        const sel = s.ui.sel;
        if ((e.shiftKey || e.metaKey) && s.ui.tool === 'select') {
          const ids = sel?.kind === 'players' ? sel.ids : sel?.kind === 'player' ? [sel.id] : [];
          const next = ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id];
          setUI({ sel: next.length ? { kind: 'players', ids: next } : null });
        } else setUI({ sel: { kind: 'player', id: d.id } });
      } else if (d.hit === 'action') setUI({ sel: { kind: 'action', id: d.id } });
      else if (!d.hit || d.hit === 'pitch') setUI({ sel: null, highlight: null });
      if (d.tool !== 'select' && d.hit !== 'player' && d.hit !== 'action' && !d.hit?.startsWith('handle')) {
        toast(`${ACTION_NAMES[d.tool]}: start the drag on a player.`);
      }
      return;
    }
    if (!cur) return;
    if (cur.type === 'move') {
      movePlayers(cur.moves);
    } else if (cur.type === 'marquee') {
      const x0 = Math.min(cur.a.x, cur.b.x), x1 = Math.max(cur.a.x, cur.b.x);
      const y0 = Math.min(cur.a.y, cur.b.y), y1 = Math.max(cur.a.y, cur.b.y);
      const ids = visibleIds.filter((id) => pos[id] && pos[id].x >= x0 && pos[id].x <= x1 && pos[id].y >= y0 && pos[id].y <= y1);
      setUI({ sel: ids.length ? { kind: 'players', ids } : null });
      if (ids.length > 1) toast(`${ids.length} players selected. Drag one to move them together.`);
    } else if (cur.type === 'ball') {
      setBall(cur.ball);
    } else if (cur.type === 'curve' || cur.type === 'end') {
      updateAction(cur.id, cur.patch);
    } else if (cur.type === 'draw') {
      const a = cur.action;
      if (!a) return;
      const t = tl;
      if (BALL_ACTIONS.has(a.type) && t && !hasBall(a.from)) {
        const owner = t.states[k].ball.owner;
        const who = owner ? idx[owner] : null;
        toast(who ? `Only the player on the ball (#${who.num} ${who.name || who.label}) can ${a.type} at this step.` : 'Nobody has the ball here. Start the pass from the player nearest the ball.', 'risk');
        return;
      }
      if (a.type === 'press' && !a.to) { toast('Drop the line on an opponent to show who is pressing or marking.', 'risk'); return; }
      if ((a.type === 'run' || a.type === 'dribble') && dist(stepStart().pos[a.from], a.target) < 1.2) return;
      const { _target, ...clean } = a;
      addAction(clean);
      if (s.prefs.sound) sfx.pop();
      if (!s.prefs.stickyTool) setUI({ tool: 'select' });
    }
  };

  const onCancel = (e) => {
    if (dragRef.current?.pointerId === e.pointerId) { dragRef.current = null; setDrag(null); }
  };

  // ---- Rendering --------------------------------------------------------

  const step = pPlay?.steps[k];
  const selId = ui.sel?.kind === 'action' ? ui.sel.id : null;
  const selPlayers = new Set(ui.sel?.kind === 'player' ? [ui.sel.id] : ui.sel?.kind === 'players' ? ui.sel.ids : []);

  const lines = [];
  if (step && tl) {
    step.actions.forEach((a, i) => {
      if (!idx[a.from]) return;
      if (sides[a.from] === 'away' && !showAway) return;
      if (sides[a.from] === 'home' && !showHome) return;
      const g = geometryFor(a, tl, k, pos, R);
      if (!g || g.path.len < 0.3) return;
      let prog = 1;
      if (live && flow && prefs.drawOn) prog = ease.outCubic(clamp((pb.t - i * 0.025) / 0.16, 0, 1));
      else if (live && pb.phase === 'lead') prog = ease.outCubic(clamp((pb.draw - i * 0.07) / 0.75, 0, 1));
      else if (!live && lc && lc.id === a.id && prefs.drawOn) prog = ease.outCubic(clamp((Date.now() - lc.at) / 420, 0, 1));
      // Traversed fraction while playing, for the "filling" effect.
      let done = 0;
      if (live && pb.phase !== 'lead') {
        if (a.type === 'run' || a.type === 'dribble') done = clamp((pb.t - (g.delay || 0)) / Math.max(0.05, 1 - (g.delay || 0)), 0, 1);
        else if (g.ball) done = clamp((pb.t - g.ball.td) / Math.max(0.01, g.ball.ta - g.ball.td), 0, 1);
        else done = 0;
      }
      lines.push({ a, g, prog, done, i });
    });
  }

  // In flowing playback the previous step's arrows fade out as the new ones draw in.
  const fading = [];
  if (live && flow && k > 0 && pb.t < 0.22 && pPlay) {
    const prevTl = tl;
    pPlay.steps[k - 1].actions.forEach((a, i) => {
      if (!idx[a.from] || (sides[a.from] === 'away' && !showAway) || (sides[a.from] === 'home' && !showHome)) return;
      const g = geometryFor(a, prevTl, k - 1, prevTl.states[k].pos, R);
      if (g && g.path.len >= 0.3) fading.push({ a, g, prog: 1, done: 1, i, fade: 1 - pb.t / 0.22 });
    });
  }

  // Space map: shade the area each team would reach first.
  let spaceEls = null;
  if (prefs.spaceMap) {
    const pts = (side) => (side === 'home' ? showHome : showAway) ? plan.teams[side].players.filter((p) => pos[p.id]).map((p) => pos[p.id]) : [];
    const col = (team) => (prefs.pitchTheme === 'paper' ? team.primary : luminance(team.primary) < 0.05 ? team.secondary : team.primary);
    const colors = { home: col(plan.teams.home), away: col(plan.teams.away) };
    const ops = [0.07, 0.15, 0.24];
    spaceEls = spaceControl(pts('home'), pts('away')).map((r) => html`<rect x=${r.x0} y=${r.y0} width=${r.x1 - r.x0 + 0.02} height=${r.y1 - r.y0 + 0.02} fill=${colors[r.side]} opacity=${ops[r.margin]} />`);
  }

  // Automatic defensive reactions, drawn as faint arrows.
  const autoLines = [];
  if (tl && prefs.showAuto && tl.steps[k] && prefs.autoDefense !== 'off') {
    for (const [id, m] of Object.entries(tl.steps[k].paths)) {
      if (!m.auto || !(sides[id] === 'home' ? showHome : showAway) || m.path.len < 1) continue;
      const prog = live && flow && prefs.drawOn ? ease.outCubic(clamp((pb.t - 0.05) / 0.2, 0, 1)) : 1;
      const color = m.role === 'press' ? theme.actions.press : m.role === 'lost' ? '#ffb070' : theme.ghost;
      const endS = Math.max(0, prog - 1.2 / m.path.len);
      autoLines.push(html`<g key=${'auto-' + id} class=${'auto-line auto-' + m.role}>
        <path d=${pathD(m.path, 0, endS)} stroke=${color} stroke-width="0.2" stroke-dasharray="0.35 0.55" fill="none" stroke-linecap="round" />
        ${prog > 0.8 ? html`<polygon points=${arrowHead(m.path.at(prog), m.path.tangentAt(prog), 1.15, 0.9)} fill=${color} />` : null}
      </g>`);
    }
  }

  const lineColor = (a) => a.color || (prefs.lineColor === 'team' ? (sides[a.from] === 'home' ? plan.teams.home.primary : plan.teams.away.primary) : theme.actions[a.type]);

  const renderLine = ({ a, g, prog, done, fade }) => {
    const st = ACTION_LINE[a.type];
    const color = g.invalid ? '#ff5a5a' : lineColor(a);
    const w = st.width * (a.height === 'driven' ? 1.45 : 1) * clamp(K, 0.9, 1.3);
    const headL = a.type === 'shot' ? 2.4 : 1.55 + w * 1.4;
    const len = g.path.len;
    const tipS = prog;
    const endS = Math.max(0, tipS - (headL * 0.62) / Math.max(len, 0.01));
    const wavy = st.wavy ? { amp: 0.5 * clamp(K, 0.9, 1.25), wavelength: 2.5, straight: 2.4 } : null;
    const dash = g.invalid ? '0.8 0.6' : st.dash;
    const d = pathD(g.path, 0, endS, wavy);
    const tip = g.path.at(tipS);
    const dir = g.path.tangentAt(tipS);
    const selected = selId === a.id;
    const isNew = a.id === PREVIEW;
    const dimmed = fade != null ? fade * 0.55 : live && done >= 1 ? 0.55 : 1;
    const head = a.type === 'press' ? null : arrowHead(tip, dir, headL, a.type === 'shot' ? 0.9 : 1);
    return html`<g class=${'line line-' + a.type + (selected ? ' sel' : '') + (isNew ? ' preview' : '')} opacity=${dimmed}>
      ${selected ? html`<path d=${d} stroke=${'rgba(255,200,80,0.35)'} stroke-width=${w + 1.1} fill="none" stroke-linecap="round" />` : null}
      ${a.lofted || a.height === 'lofted' ? html`<path d=${d} stroke=${color} stroke-opacity="0.22" stroke-width=${w * 3.2} fill="none" stroke-linecap="round" />` : null}
      <path d=${d} stroke=${color} stroke-width=${w} fill="none" stroke-dasharray=${dash} stroke-linecap="round" stroke-linejoin="round" opacity=${live && done > 0 && done < 1 ? 0.5 : 1} />
      ${live && done > 0 && done < 1 && a.type !== 'press' ? html`<path d=${pathD(g.path, 0, Math.min(done, endS), wavy)} stroke=${color} stroke-width=${w * 1.25} fill="none" stroke-dasharray=${dash} stroke-linecap="round" />` : null}
      ${head && prog > 0.82 ? html`<polygon points=${head} fill=${color} opacity=${clamp((prog - 0.82) / 0.18, 0, 1)} />` : null}
      ${head && prog > 0.82 && prog < 1 ? html`<circle cx=${f2(tip.x)} cy=${f2(tip.y)} r=${0.6 + (1 - prog) * 6} fill=${color} opacity=${(1 - prog) * 2} />` : null}
      ${a.type === 'press' && prog > 0.9 ? html`<circle cx=${f2(g.path.p2.x)} cy=${f2(g.path.p2.y)} r=${0.55} fill=${color} />` : null}
      ${!presenting && !isNew && fade == null ? html`<path d=${pathD(g.path, 0, 1)} class="hit-line" stroke-width=${Math.max(2.4, 20 / ppm)} data-hit="action" data-id=${a.id} />` : null}
    </g>`;
  };

  // Ghost of where players stood at the start of the previous step.
  const ghosts = [];
  if (tl && k > 0 && prefs.ghost && !live) {
    const prev = tl.states[k - 1].pos;
    for (const id of visibleIds) {
      const a = prev[id], b = tl.states[k].pos[id];
      if (a && b && dist(a, b) > 0.6) ghosts.push({ id, a, b });
    }
  }

  // Selected action handles.
  let handles = null;
  if (selId && !live && !presenting && tl) {
    const a = step?.actions.find((x) => x.id === selId);
    const g = a && geometryFor(a, tl, k, pos, R);
    if (g && a.type !== 'press') {
      const hc = V(handlePoint(g.path.p0, g.path.p2, a.curve || 0));
      const he = V(g.path.p2);
      const hr = Math.max(0.85, 9 / ppm);
      handles = html`<g class="handles">
        <line x1=${f2(V(g.path.p0).x)} y1=${f2(V(g.path.p0).y)} x2=${f2(hc.x)} y2=${f2(hc.y)} class="handle-guide" />
        <line x1=${f2(hc.x)} y1=${f2(hc.y)} x2=${f2(he.x)} y2=${f2(he.y)} class="handle-guide" />
        <g data-hit="handle-curve" data-id=${a.id} class="handle" style=${`transform:translate(${f2(hc.x)}px,${f2(hc.y)}px)`}>
          <circle r=${hr * 2.2} fill="transparent" />
          <circle r=${hr} class="handle-dot curve" />
        </g>
        <g data-hit="handle-end" data-id=${a.id} class="handle" style=${`transform:translate(${f2(he.x)}px,${f2(he.y)}px)`}>
          <circle r=${hr * 2.2} fill="transparent" />
          <rect x=${-hr} y=${-hr} width=${hr * 2} height=${hr * 2} rx=${hr * 0.35} class="handle-dot end" />
        </g>
      </g>`;
    }
  }

  const fa = ui.formationAnim;
  const faAge = fa ? Date.now() - fa.at : Infinity;
  const recentFormation = faAge < 1400;
  useTicker(fa ? fa.at + 1900 : 0);

  // Moving players lift slightly and leave a short motion streak.
  const lift = {};
  const streaks = [];
  if (live && tl && tl.steps[k]) {
    const paths = tl.steps[k].paths;
    const fA = prefs.trail && moving ? frameAt(tl, k, Math.max(0, pb.t - 0.035), { flow }) : null;
    const fB = prefs.trail && moving ? frameAt(tl, k, Math.max(0, pb.t - 0.075), { flow }) : null;
    for (const id in paths) {
      const m = paths[id];
      const u = clamp((pb.t - m.delay) / Math.max(0.05, 1 - m.delay), 0, 1);
      lift[id] = Math.sin(Math.PI * u) * (m.cin || m.cout ? 0.06 : 0.09);
      if (fA && u > 0 && u < 1 && (sides[id] === 'home' ? showHome : showAway)) {
        const a = V(fB.pos[id]), b = V(fA.pos[id]), c = V(pos[id]);
        if (Math.hypot(c.x - a.x, c.y - a.y) > 0.4) {
          const team = plan.teams[sides[id]];
          streaks.push({ id, a, b, c, color: luminance(team.primary) < 0.05 && prefs.pitchTheme !== 'paper' ? team.secondary : team.primary });
        }
      }
    }
  }

  // Team shape lines: connect each line of the team (defense, midfield, attack).
  const shapeFor = (side) => {
    const team = plan.teams[side];
    const pts = team.players.filter((p) => !p.gk && pos[p.id]).map((p) => ({ ...pos[p.id], d: side === 'home' ? pos[p.id].x : PITCH.L - pos[p.id].x }));
    pts.sort((a, b) => a.d - b.d);
    const groups = [];
    for (const q of pts) {
      const g = groups[groups.length - 1];
      if (g && q.d - g[g.length - 1].d < 6.5) g.push(q); else groups.push([q]);
    }
    return groups.filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.y - b.y));
  };
  const shapeLines = [];
  for (const side of ['home', 'away']) {
    if (side === 'away' ? !showAway : !showHome) continue;
    const team = plan.teams[side];
    const color = prefs.pitchTheme === 'paper' ? team.primary : luminance(team.primary) < 0.05 ? team.secondary : team.primary;
    let op = prefs.shapeLines ? 0.55 : 0, prog = 1;
    if (fa && fa.side === side && faAge < 1900 && !live) {
      prog = ease.outCubic(clamp((faAge - 200) / 700, 0, 1));
      op = Math.max(op, faAge < 1300 ? 0.95 : 0.95 * (1 - (faAge - 1300) / 600));
    }
    if (op <= 0.01) continue;
    for (const line of shapeFor(side)) {
      const pts = line.map((q) => `${f2(q.x)},${f2(q.y)}`).join(' ');
      shapeLines.push(html`<polyline points=${pts} fill="none" stroke=${color} stroke-width="0.32" stroke-linecap="round" stroke-linejoin="round"
        opacity=${op} pathLength="1" stroke-dasharray="1 1" stroke-dashoffset=${1 - prog} />`);
    }
  }

  // Impact effects: rings where the ball is struck and received, a burst when a shot goes in.
  const fx = [];
  let goalText = null;
  if (live && prefs.fx && g0 && g0.kind !== 'dribble') {
    const t = pb.t;
    const ring = (p, u, big, key) => {
      if (u < 0 || u > 1) return;
      const c = V(p);
      fx.push(html`<circle key=${key} cx=${f2(c.x)} cy=${f2(c.y)} r=${R * (0.5 + (big ? 4.2 : 2.1) * ease.outCubic(u))} fill="none"
        stroke="#fffbe6" stroke-width=${(big ? 0.55 : 0.32) * (1 - u) + 0.04} opacity=${(1 - u) * 0.85} />`);
    };
    ring(g0.path.p0, (t - g0.td) / 0.16, g0.kind === 'shot', 'kick');
    if (g0.kind === 'pass' && g0.receiver) ring(g0.path.p2, (t - g0.ta) / 0.16, false, 'recv');
    if (g0.kind === 'shot') {
      const u = (t - g0.ta) / 0.4;
      ring(g0.path.p2, u, true, 'goal1');
      ring(g0.path.p2, u - 0.18, true, 'goal2');
      if (u >= 0) {
        const c = V(g0.path.p2);
        fx.push(html`<circle key="flash" cx=${f2(c.x)} cy=${f2(c.y)} r=${8 + 10 * clamp(u, 0, 1)} fill="url(#pt-flash)" opacity=${clamp(1 - u, 0, 1)} />`);
        const side = sides[g0.from];
        const at = V({ x: side === 'home' ? 90 : 15, y: 34 });
        const ug = clamp((t - g0.ta) / 0.22, 0, 1);
        const sc = 0.6 + 0.4 * ease.outCubic(ug) + (ug < 1 ? Math.sin(ug * Math.PI) * 0.12 : 0);
        goalText = html`<g class="goal-burst" style=${`transform:translate(${f2(at.x)}px,${f2(at.y)}px) scale(${f2(sc)})`} opacity=${ug}>
          <text class="goal-text" font-size=${Math.max(7, 64 / ppm)} y=${Math.max(7, 64 / ppm) * 0.35}>GOAL</text>
        </g>`;
      }
    }
  }
  const draggingIds = new Set(drag?.type === 'move' ? drag.ids : []);

  const tokens = [];
  for (const side of ['away', 'home']) {
    if (side === 'away' ? !showAway : !showHome) continue;
    const team = plan.teams[side];
    team.players.forEach((p, i) => {
      const at = pos[p.id];
      if (!at) return;
      const v = V(at);
      const fillId = `url(#${uid}-kit-${side})`;
      const fill = p.gk ? team.gkPrimary : fillId;
      const stroke = p.gk ? team.gkSecondary : team.secondary;
      const ink = team.numColor === 'white' ? '#fff' : team.numColor === 'black' ? '#111' : inkOn(p.gk ? team.gkPrimary : team.primary);
      const label = prefs.labels === 'none' ? '' : prefs.labels === 'pos' ? p.label : prefs.labels === 'both' ? `${p.label}${p.name ? ' · ' + p.name : ''}` : (p.name || p.label);
      const sel = selPlayers.has(p.id);
      const snap = drag?.type === 'draw' && drag.action && (drag.action.to === p.id);
      const r = roster.find((q) => q.id === p.rosterId);
      const fit = side === 'home' && r ? slotFit(r, p) : null;
      const delay = recentFormation ? Math.round(((side === 'home' ? at.x : PITCH.L - at.x) / PITCH.L) * 260 + i * 12) : 0;
      const dim = hl ? (inHighlight(at) ? 1 : 0.32) : 1;
      const lw = label ? label.length * labelFont * 0.54 + labelFont * 1.1 : 0;
      tokens.push(html`<g key=${p.id} class=${'tok' + (draggingIds.has(p.id) ? ' dragging' : '') + (sel ? ' sel' : '')} data-hit="player" data-id=${p.id}
        style=${`transform:translate(${f2(v.x)}px,${f2(v.y)}px)${lift[p.id] ? ` scale(${f2(1 + lift[p.id])})` : ''};transition-delay:${delay}ms;opacity:${dim}`}>
        <ellipse cx="0" cy=${R * (0.5 + (lift[p.id] || 0) * 2.5)} rx=${R * 1.02} ry=${R * 0.5} fill="#000" opacity=${0.28 - (lift[p.id] || 0)} />
        ${sel ? html`<circle r=${R + 0.75} class="sel-ring" />` : null}
        ${snap ? html`<circle r=${R + 1} class="snap-ring" />` : null}
        <circle r=${R} fill=${fill} stroke=${stroke} stroke-width=${R * 0.15} />
        <circle r=${R * 0.93} fill="none" stroke="#000" stroke-opacity="0.12" stroke-width=${R * 0.06} />
        <text y=${R * 0.37} class="tok-num" font-size=${R * 1.04} fill=${p.gk || team.pattern === 'solid' ? ink : ink} stroke=${team.pattern === 'solid' || p.gk ? 'none' : alpha(team.primary, 0.9)} stroke-width=${R * 0.16} paint-order="stroke">${p.num}</text>
        ${label ? html`<g class="tok-label" style=${`transform:translate(0px,${f2(R + labelFont * 1.05)}px)`}>
          <rect x=${-lw / 2} y=${-labelFont * 0.78} width=${lw} height=${labelFont * 1.42} rx=${labelFont * 0.4} class="label-bg" />
          <text y=${labelFont * 0.32} font-size=${labelFont} class="label-text">${label}</text>
        </g>` : null}
        ${fit != null && fit < FIT_LOW ? html`<g style=${`transform:translate(${f2(R * 0.78)}px,${f2(-R * 0.78)}px)`}>
          <title>${`${r.name} fits this role ${fit}/100`}</title>
          <circle r=${R * 0.42} class="warn-dot" /><text y=${R * 0.17} font-size=${R * 0.55} class="warn-text">!</text>
        </g>` : null}
        <circle r=${hitR} fill="transparent" />
      </g>`);
    });
  }

  // Ball.
  let ballEl = null;
  if (ball) {
    const v = V(ball);
    const br = R * 0.4;
    const lift = (ball.z || 0) * 0.62;
    const scale = 1 + (ball.z || 0) * 0.05;
    ballEl = html`<g class=${'ballg' + (drag?.type === 'ball' ? ' dragging' : '')} data-hit=${!live && k === 0 && play ? 'ball' : null}
      style=${`transform:translate(${f2(v.x)}px,${f2(v.y)}px)`}>
      <ellipse cx="0" cy=${br * 0.55} rx=${br * (1.05 - Math.min(0.5, (ball.z || 0) / 16))} ry=${br * 0.45} fill="#000" opacity=${0.35 - Math.min(0.2, (ball.z || 0) / 30)} />
      <g style=${`transform:translate(0px,${f2(-lift)}px) scale(${f2(scale)}) rotate(${Math.round((ball.x * 61 + ball.y * 47) % 360)}deg)`}>
        <circle r=${br} fill="#fbfbf7" stroke="#11160f" stroke-width=${br * 0.14} />
        <path d=${`M0 ${-br * 0.42}L${br * 0.4} ${-br * 0.13}L${br * 0.25} ${br * 0.34}L${-br * 0.25} ${br * 0.34}L${-br * 0.4} ${-br * 0.13}Z`} fill="#11160f" />
      </g>
      ${!live && k === 0 && play && !presenting ? html`<circle r=${Math.max(br * 2.4, 16 / ppm)} fill="transparent" />` : null}
    </g>`;
  }

  const trail = trailRef.current;
  const marquee = drag?.type === 'marquee' ? (() => {
    const a = V(drag.a), b = V(drag.b);
    return html`<rect x=${Math.min(a.x, b.x)} y=${Math.min(a.y, b.y)} width=${Math.abs(a.x - b.x)} height=${Math.abs(a.y - b.y)} class="marquee" />`;
  })() : null;

  const cursorClass = ui.tool === 'select' ? 'tool-select' : 'tool-draw';
  const Mstr = `matrix(${M.join(',')})`;
  const awayTeam = plan.teams.away, homeTeam = plan.teams.home;

  return html`<div class=${'pitch-wrap ' + cursorClass} data-pitch=${prefs.pitchTheme} ref=${wrap}>
    <svg ref=${svg} class=${'pitch' + (live || drag || !settled ? ' live' : ' anim') + (recentFormation ? ' springy' : '') + (presenting ? ' presenting' : '')} style=${measured ? null : 'visibility:hidden'}
      viewBox=${`${f2(viewRect.x)} ${f2(viewRect.y)} ${f2(viewRect.w)} ${f2(viewRect.h)}`} preserveAspectRatio="xMidYMid meet"
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onCancel}
      role="application" aria-label="Tactics board. Use the panel to edit players; drag on the pitch to move players and draw actions.">
      <defs>
        <${KitDefs} id=${uid} team=${homeTeam} side="home" />
        <${KitDefs} id=${uid} team=${awayTeam} side="away" />
        <pattern id=${`${uid}-net`} patternUnits="userSpaceOnUse" width="0.7" height="0.7">
          <path d="M0 0L0.7 0.7M0.7 0L0 0.7" stroke=${theme.line} stroke-width="0.06" opacity="0.7" />
        </pattern>
        <radialGradient id=${`${uid}-light`} cx="50%" cy="45%" r="65%">
          <stop offset="0" stop-color="#ffffff" stop-opacity=${prefs.pitchTheme === 'paper' ? 0 : 0.07} />
          <stop offset="1" stop-color="#000000" stop-opacity=${prefs.pitchTheme === 'paper' ? 0 : 0.22} />
        </radialGradient>
        <clipPath id=${`${uid}-arcL`}><rect x=${PITCH.boxD} y="0" width="12" height=${PITCH.W} /></clipPath>
        <clipPath id=${`${uid}-arcR`}><rect x=${PITCH.L - PITCH.boxD - 12} y="0" width="12" height=${PITCH.W} /></clipPath>
        <clipPath id=${`${uid}-field`}><rect x="0" y="0" width=${PITCH.L} height=${PITCH.W} /></clipPath>
        <radialGradient id=${`${uid}-flash`}><stop offset="0" stop-color="#fff6d0" stop-opacity="0.9" /><stop offset="0.4" stop-color="#ffc94a" stop-opacity="0.45" /><stop offset="1" stop-color="#ffc94a" stop-opacity="0" /></radialGradient>
      </defs>
      <g transform=${Mstr}>
        <${Markings} theme=${theme} id=${uid} />
        <rect x="-6" y="-6" width=${PITCH.L + 12} height=${PITCH.W + 12} fill="transparent" data-hit="pitch" />
        ${zones ? html`<g class="zones">${zones.map((z) => {
          const r = zoneRect(z.index);
          const c = z.diff > 0 ? theme.zoneGood : z.diff < 0 ? theme.zoneBad : theme.zoneEven;
          const op = z.diff === 0 ? 0.05 : Math.min(0.42, 0.16 + Math.abs(z.diff) * 0.09);
          const on = hl ? hl.has(z.index) : false;
          return html`<rect x=${r.x + 0.15} y=${r.y + 0.15} width=${r.w - 0.3} height=${r.h - 0.3} rx="0.6" class=${'zone' + (on ? ' on' : '')}
            style=${`fill:${c};fill-opacity:${hl && !on ? op * 0.35 : op}`} stroke=${on ? '#ffc94a' : alpha('#ffffff', 0.12)} stroke-width=${on ? 0.4 : 0.12} />`;
        })}</g>` : null}
        ${ghosts.map((gh) => html`<line x1=${f2(gh.a.x)} y1=${f2(gh.a.y)} x2=${f2(gh.b.x)} y2=${f2(gh.b.y)} stroke=${theme.ghost} stroke-width="0.14" stroke-dasharray="0.4 0.5" />`)}
        ${shapeLines.length ? html`<g class="shape-lines">${shapeLines}</g>` : null}
        ${spaceEls ? html`<g class="space-map">${spaceEls}</g>` : null}
        ${autoLines.length ? html`<g class="auto-lines">${autoLines}</g>` : null}
        <g class="lines">${fading.map(renderLine)}${lines.map(renderLine)}</g>
      </g>
      ${zones ? html`<g class="zone-labels">${zones.map((z) => {
        const r = zoneRect(z.index);
        const fs = Math.max(1.6, 11 / ppm);
        // Pin the count to the top of the zone (in screen space) so it stays clear of players.
        const corners = [V({ x: r.x, y: r.y }), V({ x: r.x + r.w, y: r.y + r.h })];
        const c = { x: (corners[0].x + corners[1].x) / 2, y: Math.min(corners[0].y, corners[1].y) + fs * 1.25 };
        const tone = z.diff > 0 ? 'good' : z.diff < 0 ? 'bad' : 'even';
        return html`<g class=${'zl zl-' + tone} style=${`transform:translate(${f2(c.x)}px,${f2(c.y)}px)`} opacity=${hl && !hl.has(z.index) ? 0.35 : 1}>
          <rect x=${-fs * 1.9} y=${-fs * 0.82} width=${fs * 3.8} height=${fs * 1.5} rx=${fs * 0.75} />
          <text y=${fs * 0.36} font-size=${fs}>${z.home}<tspan class="zl-v" dx=${fs * 0.18}>v</tspan><tspan dx=${fs * 0.18}>${z.away}</tspan></text>
        </g>`;
      })}</g>` : null}
      ${ghosts.map((gh) => { const v = V(gh.a); return html`<circle cx=${f2(v.x)} cy=${f2(v.y)} r=${R * 0.92} class="ghost" stroke=${theme.ghost} />`; })}
      ${trail.length > 1 ? html`<g class="trail">${trail.slice(1).map((p, i) => html`<line x1=${f2(trail[i].x)} y1=${f2(trail[i].y)} x2=${f2(p.x)} y2=${f2(p.y)}
        stroke="#fffbe8" stroke-width=${R * 0.32 * ((i + 1) / trail.length)} stroke-linecap="round" opacity=${0.5 * ((i + 1) / trail.length)} />`)}</g>` : null}
      ${streaks.length ? html`<g class="streaks">${streaks.map((st) => html`<g key=${st.id}>
        <line x1=${f2(st.a.x)} y1=${f2(st.a.y)} x2=${f2(st.b.x)} y2=${f2(st.b.y)} stroke=${st.color} stroke-width=${R * 0.9} stroke-linecap="round" opacity="0.14" />
        <line x1=${f2(st.b.x)} y1=${f2(st.b.y)} x2=${f2(st.c.x)} y2=${f2(st.c.y)} stroke=${st.color} stroke-width=${R * 1.5} stroke-linecap="round" opacity="0.26" />
      </g>`)}</g>` : null}
      <g class="tokens">${tokens}</g>
      ${ballEl}
      ${fx.length ? html`<g class="fx">${fx}</g>` : null}
      ${goalText}
      ${handles}
      ${marquee}
    </svg>
  </div>`;
}
