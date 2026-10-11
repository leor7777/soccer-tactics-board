// File export: JSON game plans and PNG images of the board.
import { getState, activePlan, activePlay, setUI, toast, exportPlanData } from './store.js';

const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'letter-spacing', 'transform', 'paint-order', 'dominant-baseline'];
const FONT = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

export const slug = (s) => (s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'plan';

// Offer a file to the viewer. Inside claude.ai this goes through the downloads capability;
// self-hosted, it falls back to a normal browser download.
export async function saveFile(filename, data) {
  try {
    const dl = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dl) {
      await dl.save({ filename, data });
      toast(`Saved ${filename}`, 'good');
      return true;
    }
  } catch (e) {
    if (e?.code === 'declined') return false;
    if (e?.code && e.code !== 'unavailable' && e.code !== 'not_granted') { toast(`Could not save the file (${e.code}).`, 'risk'); return false; }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Saved ${filename}`, 'good');
    return true;
  } catch {
    toast('Saving files is blocked here. Copy the plan from the Plans panel instead.', 'risk');
    return false;
  }
}

export function exportPlanJSON() {
  const data = exportPlanData();
  return saveFile(`${slug(data.plan.name)}.tactics.json`, JSON.stringify(data, null, 2));
}

// Wait for the board to repaint; the timeout covers hidden tabs where frames don't fire.
const nextFrame = () => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 120); });

// Snapshot the live pitch SVG into an Image, copying computed styles so it renders standalone.
async function snapshotSVG(svgEl, width) {
  const clone = svgEl.cloneNode(true);
  const src = svgEl.querySelectorAll('*');
  const dst = clone.querySelectorAll('*');
  for (let i = 0; i < src.length; i++) {
    const cs = getComputedStyle(src[i]);
    let style = '';
    for (const p of STYLE_PROPS) {
      let v = cs.getPropertyValue(p);
      if (!v || v === 'none' && p !== 'stroke' && p !== 'fill' && p !== 'stroke-dasharray' && p !== 'transform') continue;
      if (p === 'font-family') v = FONT;
      style += `${p}:${v};`;
    }
    dst[i].setAttribute('style', style);
  }
  clone.querySelectorAll('[data-hit="pitch"], .hit-line, .handles, .sel-ring, .snap-ring').forEach((n) => n.remove());
  const vb = svgEl.viewBox.baseVal;
  const height = Math.round((width * vb.height) / vb.width);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  const img = new Image();
  img.decoding = 'async';
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  URL.revokeObjectURL(url);
  return { img, width, height };
}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawHeader(ctx, x, y, w, { eyebrow, title, caption, home, away }) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = css('--accent') || '#f4b740';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText((eyebrow || '').toUpperCase(), x, y + 26);
  ctx.fillStyle = css('--fg') || '#fff';
  ctx.font = `700 48px ${FONT}`;
  ctx.fillText(title || '', x, y + 78);
  if (caption) {
    ctx.fillStyle = css('--fg-2') || '#aaa';
    ctx.font = `500 26px Barlow, Arial, sans-serif`;
    ctx.fillText(caption, x, y + 118);
  }
  // Team legend, right-aligned.
  ctx.font = `600 24px ${FONT}`;
  let rx = x + w;
  for (const t of [away, home]) {
    if (!t) continue;
    const label = t.name.toUpperCase();
    const tw = ctx.measureText(label).width;
    rx -= tw;
    ctx.fillStyle = css('--fg') || '#fff';
    ctx.fillText(label, rx, y + 26);
    rx -= 30;
    ctx.beginPath(); ctx.arc(rx + 11, y + 18, 10, 0, Math.PI * 2);
    ctx.fillStyle = t.primary; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = t.secondary; ctx.stroke();
    rx -= 28;
  }
}

async function toBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

const pitchSVG = () => document.querySelector('.stage svg.pitch');

export async function exportBoardPNG() {
  const out = await boardCanvas();
  if (!out) return;
  return saveFile(out.name, await toBlob(out.canvas));
}

export async function boardCanvas() {
  const svg = pitchSVG();
  if (!svg) return null;
  const s = getState();
  const plan = activePlan(s), play = activePlay(s);
  const W = 2000, pad = 60, head = 150;
  svg.classList.add('exporting');
  await nextFrame();
  const shot = await snapshotSVG(svg, W - pad * 2);
  svg.classList.remove('exporting');
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = shot.height + head + pad * 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css('--bg') || '#0b1114';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const step = play?.steps[s.ui.step];
  drawHeader(ctx, pad, pad - 10, W - pad * 2, {
    eyebrow: play ? `${plan.name} · Step ${s.ui.step + 1} of ${play.steps.length}` : plan.name,
    title: play ? play.name : `${plan.teams.home.name} v ${plan.teams.away.name}`,
    caption: step?.caption,
    home: plan.teams.home, away: plan.teams.away,
  });
  ctx.drawImage(shot.img, pad, pad + head - 10, shot.width, shot.height);
  const name = play ? `${slug(play.name)}-step-${s.ui.step + 1}.png` : `${slug(plan.name)}-board.png`;
  return { canvas, name };
}

// Every step of the current play on one image, two columns.
export async function exportStoryboardPNG() {
  const s0 = getState();
  const plan = activePlan(s0), play = activePlay(s0);
  const svg = pitchSVG();
  if (!play || !svg) { toast('Open a play to export its storyboard.'); return; }
  const startStep = s0.ui.step;
  svg.classList.add('exporting');
  const shots = [];
  for (let i = 0; i < play.steps.length; i++) {
    setUI({ step: i, sel: null });
    await nextFrame();
    shots.push(await snapshotSVG(pitchSVG(), 940));
  }
  setUI({ step: startStep });
  pitchSVG()?.classList.remove('exporting');
  const cols = play.steps.length > 1 ? 2 : 1, pad = 50, gap = 40, capH = 70, head = 140;
  const cw = 940, ch = shots[0].height;
  const rows = Math.ceil(shots.length / cols);
  const W = pad * 2 + cols * cw + (cols - 1) * gap;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = pad * 2 + head + rows * (ch + capH) + (rows - 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css('--bg') || '#0b1114';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawHeader(ctx, pad, pad - 10, W - pad * 2, { eyebrow: `${plan.name} · ${play.steps.length} steps`, title: play.name, home: plan.teams.home, away: plan.teams.away });
  shots.forEach((sh, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = pad + head + Math.floor(i / cols) * (ch + capH + gap);
    ctx.fillStyle = css('--accent') || '#f4b740';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(String(i + 1).padStart(2, '0'), x, y + 34);
    ctx.fillStyle = css('--fg') || '#fff';
    ctx.font = `500 24px Barlow, Arial, sans-serif`;
    ctx.fillText(play.steps[i].caption || '', x + 56, y + 32);
    ctx.drawImage(sh.img, x, y + capH - 16, sh.width, sh.height);
  });
  return saveFile(`${slug(play.name)}-storyboard.png`, await toBlob(canvas));
}
