// Shared UI building blocks.
import { html, useState, useEffect, useRef } from './lib.js';
import { Icon } from './icons.js';
import { ATTRS } from './data.js';

export const cx = (...xs) => xs.filter(Boolean).join(' ');

// ---- Color helpers ------------------------------------------------------

export function hexToRgb(hex) {
  const h = (hex || '#000').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// A team color that reads on the dark UI: primary, else secondary, else the accent.
export const showColor = (team) => (luminance(team.primary) > 0.06 ? team.primary : luminance(team.secondary) > 0.06 ? team.secondary : 'var(--accent)');
export const inkOn = (hex) => (luminance(hex) > 0.4 ? '#0f1512' : '#ffffff');
export const alpha = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

// ---- Controls -----------------------------------------------------------

export function Btn({ icon, children, variant = 'ghost', size, class: c, ...rest }) {
  return html`<button type="button" class=${cx('btn', 'btn-' + variant, size && 'btn-' + size, c)} ...${rest}>
    ${icon ? html`<${Icon} name=${icon} size=${size === 'sm' ? 16 : 18} />` : null}
    ${children ? html`<span>${children}</span>` : null}
  </button>`;
}

export function IconBtn({ icon, label, active, kbd, class: c, size = 20, ...rest }) {
  return html`<button type="button" class=${cx('ibtn', active && 'on', c)} aria-label=${label} aria-pressed=${active === undefined ? null : String(!!active)}
    data-tip=${kbd ? `${label} (${kbd})` : label} ...${rest}>
    <${Icon} name=${icon} size=${size} />
  </button>`;
}

export function Seg({ value, options, onChange, label, size, wrap }) {
  return html`<div class=${cx('seg', size && 'seg-' + size, wrap && 'seg-wrap')} role="radiogroup" aria-label=${label}>
    ${options.map((o) => html`<button type="button" role="radio" aria-checked=${String(o.value === value)}
      class=${cx(o.value === value && 'on')} onClick=${() => onChange(o.value)} title=${o.title || null} aria-label=${o.label ? null : o.title}>
      ${o.icon ? html`<${Icon} name=${o.icon} size=${16} />` : null}${o.label ? html`<span>${o.label}</span>` : null}
    </button>`)}
  </div>`;
}

export function Toggle({ checked, onChange, label, hint, id }) {
  return html`<label class="toggle" for=${id}>
    <span class="toggle-text"><span>${label}</span>${hint ? html`<small>${hint}</small>` : null}</span>
    <input id=${id} type="checkbox" role="switch" checked=${checked} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
  </label>`;
}

export function Field({ label, hint, children, for: f, class: c }) {
  return html`<div class=${cx('field', c)}>
    ${label ? html`<label class="field-label" for=${f}>${label}</label>` : null}
    ${children}
    ${hint ? html`<p class="field-hint">${hint}</p>` : null}
  </div>`;
}

// Text input that commits on blur / Enter, so typing doesn't flood the undo history.
export function TextInput({ value, onCommit, id, placeholder, class: c, maxLength = 80, multiline, rows = 3, ...rest }) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(value ?? ''); }, [value]);
  // Read the box itself on blur: state from the last render can lag a fast edit.
  const done = (e) => {
    focused.current = false;
    const now = e?.currentTarget?.value ?? v;
    setV(now);
    if ((now ?? '') !== (value ?? '')) onCommit(now);
  };
  const common = {
    id, class: cx('input', c), value: v, placeholder, maxLength,
    onFocus: () => { focused.current = true; },
    onInput: (e) => setV(e.currentTarget.value),
    onBlur: done,
    ...rest,
  };
  if (multiline) return html`<textarea rows=${rows} ...${common}></textarea>`;
  return html`<input type="text" ...${common} onKeyDown=${(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(value ?? ''); setTimeout(() => e.target.blur()); } }} />`;
}

export function ColorInput({ value, onChange, id, label }) {
  return html`<label class="color-input" for=${id}>
    <input id=${id} type="color" value=${value} onChange=${(e) => onChange(e.currentTarget.value)} aria-label=${label} />
    <span class="swatch" style=${{ background: value }}></span>
    <span class="mono">${value.toUpperCase()}</span>
  </label>`;
}

export function Dots({ value, onChange, max = 5, label }) {
  return html`<div class="dots" role="radiogroup" aria-label=${label}>
    ${Array.from({ length: max }, (_, i) => html`<button type="button" role="radio" aria-checked=${String(value === i + 1)} aria-label=${`${label} ${i + 1}`}
      class=${cx('dot', i < value && 'on')} onClick=${() => onChange(i + 1)}></button>`)}
  </div>`;
}

export function ConfirmBtn({ label, confirm = 'Delete', icon = 'trash', onConfirm, size = 'sm', variant = 'ghost' }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!asking) return; const t = setTimeout(() => setAsking(false), 4000); return () => clearTimeout(t); }, [asking]);
  if (asking) {
    return html`<span class="confirm">
      <${Btn} size=${size} variant="danger" onClick=${() => { setAsking(false); onConfirm(); }}>${confirm}<//>
      <${Btn} size=${size} onClick=${() => setAsking(false)}>Cancel<//>
    </span>`;
  }
  return html`<${Btn} size=${size} variant=${variant} icon=${icon} onClick=${() => setAsking(true)}>${label}<//>`;
}

export function Section({ title, aside, children, class: c }) {
  return html`<section class=${cx('section', c)}>
    ${title ? html`<header class="section-head"><h3>${title}</h3>${aside ? html`<div class="section-aside">${aside}</div>` : null}</header>` : null}
    ${children}
  </section>`;
}

// Number that counts up/down to its value.
export function CountUp({ value, duration = 520 }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value;
    if (a === b) return;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const v = Math.round(a + (b - a) * e);
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value]);
  return html`<span class="tnum">${shown}</span>`;
}

// Fit chip: green / amber / red by score.
export function FitChip({ fit, label }) {
  const tone = fit >= 70 ? 'good' : fit >= 55 ? 'ok' : 'bad';
  return html`<span class=${'fit fit-' + tone} title=${label ? `${label} fit ${fit}` : `Fit ${fit}`}><span class="tnum">${fit}</span></span>`;
}

// Attribute radar chart.
export function Radar({ attrs, color = 'var(--accent)', size = 168, keys = ATTRS.filter((a) => a.id !== 'goalkeeping') }) {
  const n = keys.length, R = size / 2 - 22, c = size / 2;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };
  const poly = keys.map((k, i) => pt(i, (R * (attrs?.[k.id] ?? 3)) / 5).join(',')).join(' ');
  return html`<svg class="radar" viewBox=${`0 0 ${size} ${size}`} width=${size} height=${size} role="img" aria-label="Attribute profile">
    ${[1, 2, 3, 4, 5].map((l) => html`<polygon points=${keys.map((_, i) => pt(i, (R * l) / 5).join(',')).join(' ')} class=${l === 5 ? 'radar-ring outer' : 'radar-ring'} />`)}
    ${keys.map((_, i) => { const [x, y] = pt(i, R); return html`<line x1=${c} y1=${c} x2=${x} y2=${y} class="radar-spoke" />`; })}
    <polygon points=${poly} class="radar-shape" style=${{ fill: color, stroke: color }} />
    ${keys.map((k, i) => { const [x, y] = pt(i, R + 12); return html`<text x=${x} y=${y + 3.5} class="radar-label" text-anchor="middle">${k.short}</text>`; })}
  </svg>`;
}

// Small dot diagram of a shape, drawn vertically (attacking up).
export function MiniShape({ slots, color = 'var(--accent)', w = 54, h = 74 }) {
  return html`<svg class="mini-shape" viewBox="0 0 68 105" width=${w} height=${h} aria-hidden="true">
    <rect x="0.5" y="0.5" width="67" height="104" rx="3" class="mini-pitch" />
    <line x1="0" y1="52.5" x2="68" y2="52.5" class="mini-line" />
    <circle cx="34" cy="52.5" r="7" class="mini-line" fill="none" />
    ${slots.map((s, i) => html`<circle cx=${s.w * 68} cy=${105 - s.d * 105} r="5.2" style=${{ fill: i === 0 ? 'var(--fg-3)' : color }} />`)}
  </svg>`;
}

export function Empty({ icon = 'sparkle', title, children, action }) {
  return html`<div class="empty">
    <span class="empty-icon"><${Icon} name=${icon} size=${22} /></span>
    <strong>${title}</strong>
    ${children ? html`<p>${children}</p>` : null}
    ${action || null}
  </div>`;
}
