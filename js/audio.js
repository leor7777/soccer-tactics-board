// Synthesized sound effects (Web Audio, no audio files). Short, punchy and "satisfying":
// a thock for passes, a soft tap for first touches, a net swish, crowd and chime for goals.

let ctx = null, master = null, comp = null, noiseBuf = null;
let volume = 0.7, enabled = true;

function ensure() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { enabled = false; return null; }
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

export function configure({ on, vol }) {
  if (on != null) enabled = on;
  if (vol != null) { volume = vol; if (master) master.gain.setTargetAtTime(vol, ctx.currentTime, 0.02); }
}

// Call from a click or key press so browsers allow sound later.
export function unlock() { ensure(); }

const env = (g, t, peak, attack, decay) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
};

function tone({ type = 'sine', from, to, at = 0, peak = 0.5, attack = 0.003, decay = 0.12, dest }) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay * 0.8);
  env(g, t, peak, attack, decay);
  o.connect(g).connect(dest || master);
  o.start(t); o.stop(t + attack + decay + 0.05);
}

function noise({ at = 0, peak = 0.3, attack = 0.003, decay = 0.1, type = 'bandpass', f0 = 1000, f1 = null, q = 1, dur = null }) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime + at;
  const src = c.createBufferSource(); src.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + (dur || attack + decay));
  const g = c.createGain();
  env(g, t, peak, attack, decay);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 1.5); src.stop(t + attack + decay + 0.05);
}

export const sfx = {
  // Ball struck: a punchy low thock with a crisp click on top.
  kick(height = 'ground') {
    const p = height === 'driven' ? 1.25 : height === 'lofted' ? 0.9 : 1;
    tone({ from: 150 * p, to: 52, peak: 0.85, decay: height === 'driven' ? 0.1 : 0.14 });
    tone({ type: 'triangle', from: 420 * p, to: 180, peak: 0.18, decay: 0.05 });
    noise({ type: 'highpass', f0: 2600, peak: 0.22, decay: 0.025 });
    if (height === 'lofted') noise({ at: 0.03, type: 'bandpass', f0: 700, f1: 2600, q: 0.8, peak: 0.1, attack: 0.08, decay: 0.38, dur: 0.4 });
    if (height === 'driven') noise({ at: 0.01, type: 'bandpass', f0: 1800, f1: 900, q: 1.2, peak: 0.08, attack: 0.02, decay: 0.18 });
  },
  // First touch: a soft, cushioned thud as the ball dies on the foot, then a tiny settle.
  touch() {
    tone({ from: 165, to: 68, peak: 0.6, attack: 0.004, decay: 0.12 });
    tone({ type: 'triangle', from: 250, to: 140, peak: 0.07, attack: 0.003, decay: 0.05 });
    noise({ type: 'lowpass', f0: 750, f1: 260, q: 0.7, peak: 0.16, attack: 0.002, decay: 0.07, dur: 0.07 });
    tone({ from: 118, to: 74, at: 0.075, peak: 0.15, attack: 0.004, decay: 0.07 });
  },
  dribble() {
    tone({ from: 190, to: 95, peak: 0.3, attack: 0.003, decay: 0.06 });
    noise({ type: 'lowpass', f0: 900, f1: 350, q: 0.7, peak: 0.07, attack: 0.002, decay: 0.035, dur: 0.04 });
  },
  bounce() {
    tone({ from: 130, to: 70, peak: 0.35, decay: 0.1 });
  },
  shot() {
    tone({ from: 190, to: 48, peak: 1, decay: 0.16 });
    tone({ type: 'triangle', from: 520, to: 160, peak: 0.24, decay: 0.06 });
    noise({ type: 'highpass', f0: 2200, peak: 0.32, decay: 0.03 });
    noise({ at: 0.02, type: 'bandpass', f0: 2400, f1: 600, q: 0.9, peak: 0.16, attack: 0.03, decay: 0.4 });
  },
  // Ball hits the net: thud plus a swishing ripple.
  net() {
    tone({ from: 95, to: 60, peak: 0.6, decay: 0.18 });
    noise({ type: 'bandpass', f0: 3800, f1: 900, q: 0.7, peak: 0.42, attack: 0.006, decay: 0.55, dur: 0.5 });
    for (let i = 0; i < 4; i++) noise({ at: 0.04 + i * 0.05, type: 'highpass', f0: 5000, peak: 0.05 * (1 - i * 0.2), decay: 0.03 });
  },
  goal() {
    this.net();
    const c = ensure(); if (!c) return;
    // Crowd roar: filtered noise that swells, with a slow wobble.
    const t = c.currentTime + 0.08;
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const bp = c.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 520; bp.gain.value = 9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.45);
    g.gain.setValueAtTime(0.32, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.frequency.value = 5.5; lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + 3.3); lfo.start(t); lfo.stop(t + 3.3);
    // Satisfying chime: a quick major arpeggio.
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
      tone({ type: 'sine', from: f, at: 0.12 + i * 0.075, peak: 0.13, attack: 0.004, decay: 0.7 });
      tone({ type: 'triangle', from: f * 2, at: 0.12 + i * 0.075, peak: 0.025, attack: 0.004, decay: 0.3 });
    });
  },
  pop() {
    tone({ from: 480, to: 960, peak: 0.16, attack: 0.002, decay: 0.06 });
  },
  whoosh() {
    noise({ type: 'bandpass', f0: 380, f1: 2400, q: 0.9, peak: 0.12, attack: 0.12, decay: 0.3, dur: 0.38 });
    tone({ type: 'sine', from: 220, to: 330, peak: 0.05, attack: 0.1, decay: 0.25 });
  },
};

export const audioAvailable = () => !!(window.AudioContext || window.webkitAudioContext);
