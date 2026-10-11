// Set pieces: a shared library of routines (corners, free kicks, throws, restarts)
// available in every game plan.
import { html, useState, useRef } from './lib.js';
import { useStore, activePlay, setUI, createSetPiece, selectPlay, renamePlay, updatePlay, duplicatePlay, deletePlay, isSetPiece } from './store.js';
import { stop } from './player.js';
import { SET_PIECE_TYPES, SET_PIECE_BY_ID, freeKickAt, longThrowAt } from './setpieces.js';
import { Icon } from './icons.js';
import { Section, Btn, ConfirmBtn, TextInput, Empty, cx } from './ui.js';

const GROUPS = ['Attacking', 'Restart', 'Defending'];
const GROUP_LABEL = { Attacking: 'Attacking', Restart: 'Restarts', Defending: 'Defending' };

// Small vertical pitch (your team attacks up) with the ball spot marked.
function SpotPitch({ ball, size = 1, pick, half }) {
  const vb = half ? '0 -2 68 56' : '0 -2 68 109';
  const toV = (p) => ({ x: p.y, y: 105 - p.x });
  const b = ball ? toV(ball) : null;
  return html`<svg class=${'spot-pitch' + (half ? ' half' : '')} viewBox=${vb} aria-hidden="true" style=${size !== 1 ? `width:${size * 100}%` : null}>
    <rect x="0" y="0" width="68" height=${half ? 52.5 : 105} class="sp-grass" />
    <rect x="13.84" y="0" width="40.32" height="16.5" class="sp-line" />
    <rect x="24.84" y="0" width="18.32" height="5.5" class="sp-line" />
    <rect x="30.34" y="-1.8" width="7.32" height="1.8" class="sp-line" />
    ${half ? html`<line x1="0" y1="52.5" x2="68" y2="52.5" class="sp-line" />` : html`<line x1="0" y1="52.5" x2="68" y2="52.5" class="sp-line" />
      <circle cx="34" cy="52.5" r="9.15" class="sp-line" />
      <rect x="13.84" y="88.5" width="40.32" height="16.5" class="sp-line" />`}
    <rect x="0" y="0" width="68" height=${half ? 52.5 : 105} class="sp-line" />
    ${pick === 'throw' ? html`<rect x="0" y="0" width="68" height="35" class="sp-zone" />` : null}
    ${b ? html`<g style=${`transform:translate(${b.x}px,${b.y}px)`}><circle r="3.4" class="sp-ball-glow" /><circle r="1.5" class="sp-ball" /></g>` : null}
  </svg>`;
}

function SpotPicker({ typeId }) {
  const t = SET_PIECE_BY_ID[typeId];
  const [spot, setSpot] = useState(t.defaultSpot);
  const ref = useRef();
  const place = (e) => {
    const svg = ref.current.querySelector('svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const v = pt.matrixTransform(svg.getScreenCTM().inverse());
    let x = 105 - v.y, y = v.x;
    if (t.pick === 'throw') { x = Math.min(103, Math.max(70, x)); y = y < 34 ? 0 : 68; }
    else { x = Math.min(104, Math.max(52.5, x)); y = Math.min(67.5, Math.max(0.5, y)); }
    setSpot({ x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 });
  };
  const fk = t.pick === 'fk' ? freeKickAt(spot.x, spot.y) : null;
  const dGoal = Math.round(Math.hypot(105 - spot.x, 34 - spot.y));
  const desc = t.pick === 'throw'
    ? `Long throw ${Math.round(105 - spot.x)} m from the goal line, ${spot.y < 34 ? 'left' : 'right'} side`
    : fk.mode === 'shooting' ? `Shooting chance, ${dGoal} m out: ${fk.wall}-man wall` : `Delivery into the box from ${dGoal} m${fk.wall ? ', 2-man wall' : ''}`;
  return html`<div class="spot-picker">
    <p class="muted small">${t.pick === 'throw' ? 'Tap along either touchline in the final third.' : 'Tap anywhere in the attacking half to place the ball.'}</p>
    <div class="spot-hit" ref=${ref} onPointerDown=${place} onPointerMove=${(e) => { if (e.buttons) place(e); }}>
      <${SpotPitch} ball=${spot} half pick=${t.pick} />
    </div>
    <div class="spot-desc"><${Icon} name=${t.pick === 'throw' ? 'upload' : fk.mode === 'shooting' ? 'shot' : 'pass'} size=${16} /><span>${desc}</span></div>
    <div class="row gap-s">
      <${Btn} variant="primary" size="sm" icon="plus" onClick=${() => { stop(); createSetPiece(typeId, spot, t.pick === 'throw' ? `Long throw (${spot.y < 34 ? 'left' : 'right'})` : `Free kick, ${dGoal} m`); }}>Create set piece<//>
      <${Btn} size="sm" onClick=${() => setUI({ spPick: null })}>Cancel<//>
    </div>
  </div>`;
}

export function SetPiecesPanel() {
  const list = useStore((s) => s.doc.setPieces);
  const play = useStore(activePlay);
  const pick = useStore((s) => s.ui.spPick);
  const current = isSetPiece(play) ? play : null;

  const start = (t) => {
    if (t.pick) { setUI({ spPick: t.id }); return; }
    stop();
    createSetPiece(t.id);
  };

  return html`<div class="panel-body">
    <p class="intro-line"><${Icon} name="flag" size=${16} />Set pieces are saved once and ready in every game plan. Open one, then draw the routine with the tools.</p>

    <${Section} title="New set piece">
      ${pick ? html`<div class="picker-card"><header><strong>${SET_PIECE_BY_ID[pick].name}</strong></header><${SpotPicker} typeId=${pick} key=${pick} /></div>` : null}
      ${GROUPS.map((g) => html`<div class="sp-group">
        <span class="sp-group-label">${GROUP_LABEL[g]}</span>
        <div class="sp-grid">
          ${SET_PIECE_TYPES.filter((t) => t.group === g).map((t) => html`<button type="button" class=${cx('sp-card', pick === t.id && 'on')} onClick=${() => start(t)}>
            <${SpotPitch} ball=${t.ball || t.defaultSpot} />
            <span class="sp-name">${t.name}</span>
            ${t.pick ? html`<span class="sp-badge">Pick spot</span>` : null}
          </button>`)}
        </div>
      </div>`)}
    <//>

    <${Section} title=${`Your set pieces (${list.length})`}>
      ${list.length ? html`<ul class="sp-list">
        ${list.map((sp) => html`<li>
          <button type="button" class=${cx('sp-row', current?.id === sp.id && 'on')} onClick=${() => { stop(); selectPlay(sp.id); }}>
            <span class="sp-mini"><${SpotPitch} ball=${sp.start.ball.owner ? null : sp.start.ball} /></span>
            <span class="sp-row-text"><strong>${sp.name}</strong><small>${SET_PIECE_BY_ID[sp.spType]?.name || 'Set piece'} · ${sp.steps.length} step${sp.steps.length === 1 ? '' : 's'}</small></span>
          </button>
        </li>`)}
      </ul>` : html`<${Empty} icon="flag" title="No set pieces yet">Pick a template above to start your first routine.<//>`}
    <//>

    ${current ? html`<${Section} title="This set piece">
      <div class="field"><label class="field-label" for="sp-name">Name</label>
        <${TextInput} id="sp-name" value=${current.name} onCommit=${(v) => renamePlay(current.id, v || 'Set piece')} /></div>
      <div class="field"><label class="field-label" for="sp-notes">Coaching notes</label>
        <${TextInput} id="sp-notes" multiline rows=${3} maxLength=${600} value=${current.notes || ''} placeholder="Signals, who goes where, what to watch for" onCommit=${(v) => updatePlay(current.id, { notes: v })} /></div>
      <div class="row gap-s wrap">
        <${Btn} size="sm" icon="copy" onClick=${() => duplicatePlay(current.id)}>Duplicate<//>
        <${Btn} size="sm" icon="layers" onClick=${() => { stop(); setUI({ playId: null, step: 0, sel: null }); }}>Back to the board<//>
        <${ConfirmBtn} label="Delete" onConfirm=${() => deletePlay(current.id)} />
      </div>
    <//>` : null}
  </div>`;
}
