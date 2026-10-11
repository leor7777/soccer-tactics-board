// Line icons (24px grid, 1.8 stroke). Tool icons mirror the line style of each action.
import { html } from './lib.js';

const P = (d, extra = {}) => ({ d, ...extra });

const ICONS = {
  select: [P('M5.5 3.5l12.5 7.2-5.6 1.4 3.4 5.9-2.2 1.3-3.4-5.9-4.1 4z', { fill: 'currentColor', 'stroke-width': 1.2 })],
  pass: [P('M4 19L17.5 6.5'), P('M10.5 6h7.5v7.5')],
  dribble: [P('M3.5 17.5c1.5-1.8 2.6-1.2 3.2.1.7 1.4 1.9 1.9 3.2.3 1.2-1.6 2.4-1.4 3.1-.1.7 1.3 1.9 1.6 3-.2'), P('M13.6 8.6h6.4V15'), P('M16 15.4l3.6-6.4')],
  run: [P('M4 19L17.5 6.5', { 'stroke-dasharray': '2.6 2.4' }), P('M10.5 6h7.5v7.5')],
  shot: [P('M3.5 18.5l12-9', { 'stroke-width': 3.2 }), P('M10.6 8.2h5.6v5.6', { 'stroke-width': 2.2 }), P('M20.5 5v14', { 'stroke-width': 1.6 })],
  press: [P('M4.5 18.5L15 8', { 'stroke-dasharray': '0.1 3', 'stroke-width': 2.6 }), P('M18 6m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0')],
  undo: [P('M9 14L4 9l5-5'), P('M4 9h10.5a5.5 5.5 0 010 11H11')],
  redo: [P('M15 14l5-5-5-5'), P('M20 9H9.5a5.5 5.5 0 000 11H13')],
  play: [P('M7 4.5v15l12-7.5z', { fill: 'currentColor' })],
  pause: [P('M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', { fill: 'currentColor', stroke: 'none' })],
  next: [P('M6 5l9 7-9 7z', { fill: 'currentColor' }), P('M18 5v14')],
  prev: [P('M18 5l-9 7 9 7z', { fill: 'currentColor' }), P('M6 5v14')],
  restart: [P('M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5'), P('M3.5 3.5v5h5')],
  plus: [P('M12 5v14M5 12h14')],
  minus: [P('M5 12h14')],
  copy: [P('M9 9h11v11H9z'), P('M5 15H4V4h11v1')],
  trash: [P('M4 7h16'), P('M10 11v6M14 11v6'), P('M6 7l1 13h10l1-13'), P('M9 7V4h6v3')],
  zones: [P('M3 5h18v14H3z'), P('M9 5v14M15 5v14'), P('M3 9.7h18M3 14.3h18', { opacity: 0.55 })],
  ghost: [P('M8 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', { 'stroke-dasharray': '2 2' }), P('M16 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0')],
  flip: [P('M4 8h14l-3.5-3.5'), P('M20 16H6l3.5 3.5')],
  half: [P('M3 5h18v14H3z'), P('M12 5h9v14h-9z', { fill: 'currentColor', opacity: 0.35 })],
  eye: [P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'), P('M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0')],
  sliders: [P('M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1'), P('M15 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'), P('M9 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'), P('M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0')],
  download: [P('M12 4v11'), P('M7 10.5l5 5 5-5'), P('M4 20h16')],
  upload: [P('M12 16V5'), P('M7 9.5l5-5 5 5'), P('M4 20h16')],
  image: [P('M3.5 5h17v14h-17z'), P('M3.5 16l5-5 4 4 3-3 5 5'), P('M15.5 9m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0')],
  shirt: [P('M8 3.5L3.5 6.5l2 4 2-1V20.5h9V9.5l2 1 2-4L16 3.5c-.6 1.6-2.1 2.5-4 2.5S8.6 5.1 8 3.5z')],
  list: [P('M9 6h11M9 12h11M9 18h11'), P('M4.5 6h.01M4.5 12h.01M4.5 18h.01', { 'stroke-width': 3 })],
  chart: [P('M4 20V4'), P('M4 20h16'), P('M8 16v-4M12 16V8M16 16v-6M20 16v-9', { 'stroke-width': 2.4 })],
  users: [P('M9 8m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0'), P('M2.5 20c.5-3.6 3.2-5.5 6.5-5.5s6 1.9 6.5 5.5'), P('M16 4.6a3.5 3.5 0 0 1 0 6.8'), P('M18 14.8c2 .7 3.2 2.4 3.5 5.2')],
  scout: [P('M6.5 15m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0'), P('M17.5 15m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0'), P('M10 15h4'), P('M4 11.5L6.5 5h3l.5 6.5M20 11.5L17.5 5h-3l-.5 6.5')],
  folder: [P('M3.5 6.5h6l2 2h9v10.5h-17z')],
  present: [P('M3 4.5h18v11H3z'), P('M12 15.5v4M8 19.5h8'), P('M10.2 7.5v5l4.3-2.5z', { fill: 'currentColor' })],
  x: [P('M6 6l12 12M18 6L6 18')],
  chevronDown: [P('M6 9l6 6 6-6')],
  chevronRight: [P('M9 6l6 6-6 6')],
  chevronLeft: [P('M15 6l-6 6 6 6')],
  grip: [P('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', { 'stroke-width': 3.2 })],
  alert: [P('M12 4l9 16H3z'), P('M12 10v4.5M12 17.4h.01')],
  check: [P('M5 12.5l4.5 4.5L19 7.5')],
  ball: [P('M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0'), P('M12 8.2l3.2 2.3-1.2 3.8h-4l-1.2-3.8z'), P('M12 8.2V3.5M15.2 10.5l4.3-1.4M14 14.3l2.7 3.8M10 14.3l-2.7 3.8M8.8 10.5L4.5 9.1')],
  sparkle: [P('M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6-5.6-1.9 5.6-1.9z')],
  sun: [P('M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0'), P('M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4')],
  moon: [P('M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z')],
  panel: [P('M3.5 4.5h17v15h-17z'), P('M14.5 4.5v15')],
  target: [P('M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0'), P('M12 12m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0')],
  layers: [P('M12 3.5l9 4.8-9 4.8-9-4.8z'), P('M3 12.5l9 4.8 9-4.8'), P('M3 16.5l9 4.8 9-4.8', { opacity: 0.5 })],
  link: [P('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'), P('M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1')],
  maximize: [P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')],
  lofted: [P('M4 18c3-9 13-9 16 0', { 'stroke-dasharray': '0' }), P('M16.5 15.8L20 18l.5-4')],
  flag: [P('M5 21V3.5'), P('M5 4h12.5l-2.5 4 2.5 4H5', { fill: 'currentColor', 'fill-opacity': 0.18 })],
  help: [P('M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0'), P('M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4'), P('M12 17.3h.01', { 'stroke-width': 2.6 })],
  wand: [P('M4 20L14.5 9.5'), P('M15 3.5l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z', { fill: 'currentColor', 'fill-opacity': 0.25 }), P('M19.5 11l.6 1.3 1.3.6-1.3.6-.6 1.3-.6-1.3-1.3-.6 1.3-.6z')],
  palette: [P('M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.2-2.2H17a3.5 3.5 0 0 0 3.5-3.5c0-5.2-3.8-9.5-8.5-9.5z'), P('M7.5 11h.01M10 7.5h.01M14.5 7.5h.01', { 'stroke-width': 2.8 })],
  shield: [P('M12 3.5l7.5 3v5.2c0 4.4-3.1 7.8-7.5 9.3-4.4-1.5-7.5-4.9-7.5-9.3V6.5z'), P('M9 12l2.2 2.2L15.5 10')],
  curveL: [P('M5 19C5 10 10 6 19 6'), P('M14.5 3.5L19 6l-2.5 4.4')],
  curveR: [P('M5 19C14 19 18 14 18 5'), P('M15.6 9.4L18 5l2.6 4.3')],
  straight: [P('M5 19L19 5'), P('M12 5h7v7')],
  space: [P('M3.5 5h17v14h-17z'), P('M10 5c-1.5 3-1.5 11 0 14M14 5c2 4 2 10 0 14', { opacity: 0.6 }), P('M6.5 12h.01M17.5 9h.01M17.5 15h.01', { 'stroke-width': 2.8 })],
  sound: [P('M4 9.5h3.5L12 5.5v13l-4.5-4H4z'), P('M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11')],
  mute: [P('M4 9.5h3.5L12 5.5v13l-4.5-4H4z'), P('M16 9.5l5 5M21 9.5l-5 5')],
  pen: [P('M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z'), P('M14 7l3 3')],
};

export function Icon({ name, size = 20, class: cls = '', title }) {
  const parts = ICONS[name] || [];
  return html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden=${title ? null : 'true'} role=${title ? 'img' : null}>
    ${title ? html`<title>${title}</title>` : null}
    ${parts.map((p) => html`<path ...${p} />`)}
  </svg>`;
}
