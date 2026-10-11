// Playback controller. Kept in its own tiny store so 60fps updates only re-render
// the pitch and the transport, not the panels.
//
// Each step plays in three phases:
//   lead  - the step's arrows draw themselves on (players hold still)
//   move  - everyone moves along their paths
//   hold  - a short beat at the end before the next step

import { useReducer, useEffect, useRef } from './lib.js';
import { getState, setUI, activePlay, activePlan, timelineFor } from './store.js';
import { eventsBetween } from './playback.js';
import { sfx, unlock } from './audio.js';

// Sound: remember where the last frame was so each kick, touch and goal plays once.
let lastStep = 0, lastT = -1e-6;
function playSounds(s, play, step, t) {
  if (s.prefs.sound) {
    const tl = timelineFor(activePlan(s), play, 2.6);
    const evs = step === lastStep ? eventsBetween(tl, step, lastT, t)
      : [...eventsBetween(tl, lastStep, lastT, 1), ...eventsBetween(tl, step, -1e-6, t)];
    for (const e of evs) {
      if (e.type === 'kick') sfx.kick(e.height);
      else if (e.type === 'shot') sfx.shot();
      else if (e.type === 'goal') sfx.goal();
      else if (e.type === 'touch') sfx.touch();
      else if (e.type === 'bounce') sfx.bounce();
      else if (e.type === 'dribble') sfx.dribble();
    }
  }
  lastStep = step; lastT = t;
}
const resetSound = (step, t = -1e-6) => { lastStep = step; lastT = t; };

const LEAD = 0.55, HOLD = 0.4;

let P = { active: false, playing: false, step: 0, t: 0, draw: 1, phase: 'move', ended: false };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
export const pbState = () => P;

export function usePB() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { subs.add(force); return () => subs.delete(force); }, []);
  return P;
}

let raf = 0, last = 0, held = 0;

function loop(now) {
  const s = getState();
  let dt = Math.min(0.25, (now - last) / 1000) * (s.ui.speed || 1);
  last = now;
  const play = activePlay(s);
  if (!play || !play.steps.length) { stop(); return; }
  const st = play.steps[P.step];
  const flow = s.prefs.playStyle !== 'coach';
  const drawOn = s.prefs.drawOn;
  let { step, t, draw, phase, ended } = P;

  // Slow motion as a shot reaches the goal.
  if (s.prefs.slowmo && phase === 'move') {
    const g = timelineFor(activePlan(s), play, 2.6)?.steps[step]?.ballGeo;
    if (g && g.kind === 'shot' && t > g.ta - 0.2 && t < g.ta + 0.12) dt *= 0.32;
  }

  if (flow) {
    // Continuous: steps run back to back; arrows draw on while players move.
    if (phase === 'move') {
      t += dt / (st?.duration || 2);
      draw = 1;
      if (t >= 1) {
        if (step < play.steps.length - 1) {
          const over = (t - 1) * (st?.duration || 2);
          step++;
          t = Math.min(0.5, over / (play.steps[step].duration || 2));
          setUI({ step });
        } else { t = 1; phase = 'hold'; held = 0; }
      }
    } else if (phase === 'hold') {
      held += dt;
      if (held >= 0.9) {
        P = { ...P, step, t: 1, draw: 1, phase: 'hold', playing: false, ended: true };
        setUI({ playing: false, step });
        emit();
        return;
      }
    } else { phase = 'move'; }
  } else if (phase === 'lead') {
    draw = Math.min(1, draw + dt / LEAD);
    if (!drawOn || draw >= 1) { draw = 1; phase = 'move'; }
  } else if (phase === 'move') {
    t = Math.min(1, t + dt / (st?.duration || 2));
    if (t >= 1) { phase = 'hold'; held = 0; }
  } else if (phase === 'hold') {
    held += dt;
    if (held >= HOLD) {
      if (step < play.steps.length - 1) {
        step++; t = 0; draw = drawOn ? 0 : 1; phase = drawOn ? 'lead' : 'move';
      } else {
        ended = true;
        P = { ...P, step, t: 1, draw: 1, phase: 'hold', playing: false, ended };
        setUI({ playing: false, step });
        emit();
        return;
      }
    }
  }
  P = { ...P, step, t, draw, phase };
  playSounds(s, play, step, phase === 'lead' ? -1e-6 : t);
  emit();
  raf = requestAnimationFrame(loop);
}

export function play() {
  const s = getState();
  const pl = activePlay(s);
  if (!pl) return;
  const lead = s.prefs.drawOn && s.prefs.playStyle === 'coach';
  if (!P.active || P.ended) {
    P = { active: true, playing: true, step: P.ended && s.ui.step === pl.steps.length - 1 ? 0 : s.ui.step, t: 0, draw: lead ? 0 : 1, phase: lead ? 'lead' : 'move', ended: false };
  } else {
    P = { ...P, playing: true };
  }
  setUI({ playing: true, sel: null });
  unlock();
  resetSound(P.step, P.t > 0 ? P.t : -1e-6);
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(loop);
  emit();
}

export function pause() {
  cancelAnimationFrame(raf);
  P = { ...P, playing: false };
  setUI({ playing: false, step: P.step });
  emit();
}

export function toggle() { (P.playing ? pause : play)(); }

// Leave playback and return to editing the step that was showing.
export function stop() {
  cancelAnimationFrame(raf);
  const wasActive = P.active;
  P = { ...P, active: false, playing: false, ended: false };
  if (wasActive) setUI({ playing: false, step: P.step });
  emit();
}

export function restart() {
  stop();
  setUI({ step: 0 });
  play();
}

export function jump(delta) {
  const s = getState();
  const pl = activePlay(s);
  if (!pl) return;
  if (!P.active) {
    setUI({ step: Math.max(0, Math.min(pl.steps.length - 1, s.ui.step + delta)), sel: null });
    return;
  }
  const step = Math.max(0, Math.min(pl.steps.length - 1, P.step + delta));
  const lead = s.prefs.drawOn && s.prefs.playStyle === 'coach';
  P = { ...P, step, t: 0, draw: lead ? 0 : 1, phase: lead ? 'lead' : 'move', ended: false };
  resetSound(step);
  setUI({ step });
  emit();
}

// Scrub: set an exact position (used by the step progress bars).
export function seek(step, t) {
  if (!P.active) P = { ...P, active: true, playing: false };
  P = { ...P, step, t, draw: 1, phase: 'move', ended: false };
  resetSound(step, t);
  setUI({ step });
  emit();
}

// Re-render while a time-based effect (like a newly drawn arrow) is animating.
export function useTicker(activeUntil) {
  const [, force] = useReducer((x) => x + 1, 0);
  const r = useRef(0);
  useEffect(() => {
    if (!activeUntil || Date.now() > activeUntil) return;
    const tick = () => { force(); if (Date.now() < activeUntil) r.current = requestAnimationFrame(tick); };
    r.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r.current);
  }, [activeUntil]);
}
