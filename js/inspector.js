// Floating inspector for the selected player, players or action.
import { html } from './lib.js';
import { useStore, activePlan, activePlay, setUI, updatePlayer, updateAction, deleteAction, assignRoster, setBall, timelineFor } from './store.js';
import { POSITIONS, ROLES, ROLE_BY_ID, ACTION_NAMES, PITCH_THEMES } from './data.js';
import { slotFit, FIT_LOW, topRoles } from './analysis.js';
import { Icon } from './icons.js';
import { IconBtn, Toggle, TextInput, Field, FitChip, Seg, cx, inkOn } from './ui.js';

const LINE_SWATCHES = ['#ffffff', '#ffd35a', '#8fd6ff', '#ff6a4d', '#ff7fb0', '#7cf0b0', '#c9a7ff', '#111111'];

export function Inspector({ docked = false }) {
  const sel = useStore((s) => s.ui.sel);
  const playing = useStore((s) => s.ui.playing);
  if (!sel || playing) return null;
  return html`<div class=${'inspector ' + (docked ? 'docked' : 'floating')} role="dialog" aria-label="Selection">
    ${sel.kind === 'player' ? html`<${PlayerInspector} id=${sel.id} />` : null}
    ${sel.kind === 'players' ? html`<${MultiInspector} ids=${sel.ids} />` : null}
    ${sel.kind === 'action' ? html`<${ActionInspector} id=${sel.id} />` : null}
  </div>`;
}

const close = () => setUI({ sel: null });

function PlayerInspector({ id }) {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const roster = useStore((s) => s.doc.roster);
  const step = useStore((s) => s.ui.step);
  const side = plan.teams.home.players.some((p) => p.id === id) ? 'home' : 'away';
  const team = plan.teams[side];
  const p = team.players.find((q) => q.id === id);
  if (!p) return null;
  const linked = roster.find((r) => r.id === p.rosterId);
  const fit = linked ? slotFit(linked, p) : null;
  const tl = play ? timelineFor(plan, play, 2.6) : null;
  const hasBall = tl && tl.states[step]?.ball.owner === id;
  const color = p.gk ? team.gkPrimary : team.primary;

  return html`<header class="insp-head">
      <span class="insp-token" style=${{ background: color, color: inkOn(color), borderColor: p.gk ? team.gkSecondary : team.secondary }}>${p.num}</span>
      <div class="insp-title">
        <strong>${p.name || p.label}</strong>
        <small>${team.name} · ${ROLE_BY_ID[p.role]?.name || p.role}</small>
      </div>
      <${IconBtn} icon="x" label="Close" onClick=${close} />
    </header>
    <div class="insp-body">
      <div class="grid-2">
        <${Field} label="Name" for="ip-name"><${TextInput} id="ip-name" value=${p.name} placeholder="Player name" onCommit=${(v) => updatePlayer(id, { name: v })} /><//>
        <${Field} label="Number" for="ip-num">
          <input id="ip-num" class="input tnum" type="number" min="1" max="99" value=${p.num}
            onChange=${(e) => updatePlayer(id, { num: Math.max(1, Math.min(99, +e.currentTarget.value || 1)) })} />
        <//>
      </div>
      <div class="grid-2">
        <${Field} label="Position" for="ip-pos">
          <select id="ip-pos" class="input" value=${p.label} onChange=${(e) => updatePlayer(id, { label: e.currentTarget.value })}>
            ${POSITIONS.some(([l]) => l === p.label) ? null : html`<option value=${p.label}>${p.label}</option>`}
            ${POSITIONS.map(([l]) => html`<option value=${l}>${l}</option>`)}
          </select>
        <//>
        <${Field} label="Role" for="ip-role">
          <select id="ip-role" class="input" value=${p.role} onChange=${(e) => updatePlayer(id, { role: e.currentTarget.value })}>
            ${ROLES.map((r) => html`<option value=${r.id}>${r.name}</option>`)}
          </select>
        <//>
      </div>
      ${side === 'home' ? html`<${Field} label="Squad player" for="ip-roster">
        <div class="row gap-s">
          <select id="ip-roster" class="input grow" value=${p.rosterId || ''} onChange=${(e) => assignRoster(id, e.currentTarget.value || null)}>
            <option value="">Not linked</option>
            ${roster.map((r) => html`<option value=${r.id}>#${r.number} ${r.name}</option>`)}
          </select>
          ${fit != null ? html`<${FitChip} fit=${fit} label=${p.label} />` : null}
        </div>
        ${fit != null && fit < FIT_LOW ? html`<p class="warn-line"><${Icon} name="alert" size=${14} />${linked.name} is a weak fit for ${ROLE_BY_ID[p.role]?.name.toLowerCase()} (${fit}). Best: ${topRoles(linked, 2).map((t) => ROLE_BY_ID[t.role].short).join(', ')}.</p>` : null}
      <//>` : null}
      <${Field} label="Notes" for="ip-notes"><${TextInput} id="ip-notes" multiline rows=${2} value=${p.notes} maxLength=${280} placeholder="Instructions for this player" onCommit=${(v) => updatePlayer(id, { notes: v })} /><//>
      ${play && step === 0 && !hasBall ? html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => setBall({ owner: id })}><${Icon} name="ball" size=${16} /><span>Start the play with the ball</span></button>` : null}
      ${hasBall ? html`<p class="muted small"><${Icon} name="ball" size=${14} /> Has the ball at this step.</p>` : null}
    </div>`;
}

function MultiInspector({ ids }) {
  return html`<header class="insp-head">
      <span class="insp-token count">${ids.length}</span>
      <div class="insp-title"><strong>${ids.length} players selected</strong><small>Drag any of them to move the group</small></div>
      <${IconBtn} icon="x" label="Clear selection" onClick=${close} />
    </header>`;
}

function ActionInspector({ id }) {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const prefs = useStore((s) => s.prefs);
  const k = useStore((s) => s.ui.step);
  const a = play?.steps[k]?.actions.find((x) => x.id === id);
  if (!a) return null;
  const players = { ...Object.fromEntries(plan.teams.home.players.map((p) => [p.id, p])), ...Object.fromEntries(plan.teams.away.players.map((p) => [p.id, p])) };
  const who = (pid) => (players[pid] ? `#${players[pid].num} ${players[pid].name || players[pid].label}` : '?');
  const tl = timelineFor(plan, play, 2.6);
  const problem = tl.invalid.get(a.id);
  const def = (PITCH_THEMES[prefs.pitchTheme] || PITCH_THEMES.night).actions[a.type];
  const desc = a.type === 'pass' ? `${who(a.from)} → ${a.to ? who(a.to) : 'space'}` : a.type === 'press' ? `${who(a.from)} on ${who(a.to)}` : who(a.from);

  return html`<header class="insp-head">
      <span class=${'insp-line line-' + a.type}><${Icon} name=${a.type} size=${20} /></span>
      <div class="insp-title"><strong>${ACTION_NAMES[a.type]}</strong><small>${desc}</small></div>
      <${IconBtn} icon="trash" label="Delete action" kbd="Del" onClick=${() => deleteAction(id)} />
      <${IconBtn} icon="x" label="Close" onClick=${close} />
    </header>
    <div class="insp-body">
      ${problem ? html`<p class="warn-line"><${Icon} name="alert" size=${14} />${problem}</p>` : null}
      ${a.type === 'run' || a.type === 'dribble' ? html`<${Seg} label="Movement type" value=${a.type} onChange=${(v) => updateAction(id, { type: v })}
        options=${[{ value: 'run', label: 'Run (off ball)', icon: 'run' }, { value: 'dribble', label: 'Dribble', icon: 'dribble' }]} />` : null}
      ${a.type === 'pass' || a.type === 'shot' ? html`<${Field} label=${a.type === 'shot' ? 'Shot type' : 'Ball height'}>
        <${Seg} label="Ball height" value=${a.height || (a.lofted ? 'lofted' : 'ground')} onChange=${(v) => updateAction(id, { height: v, lofted: v === 'lofted' })}
          options=${a.type === 'shot'
            ? [{ value: 'ground', label: 'Placed' }, { value: 'driven', label: 'Driven' }, { value: 'lofted', label: 'Chip' }]
            : [{ value: 'ground', label: 'Ground' }, { value: 'driven', label: 'Driven' }, { value: 'lofted', label: 'Lofted' }]} />
      <//>` : null}
      ${a.type !== 'press' ? html`<div class="row gap-s">
        <span class="field-label grow">Quick curve</span>
        <${Seg} size="sm" label="Quick curve" value=${!a.curve ? 0 : a.curve < 0 ? -1 : 1} onChange=${(v) => updateAction(id, { curve: v * Math.max(3, Math.abs(a.curve || 0) || 5) })}
          options=${[{ value: -1, icon: 'curveL', title: 'Curve left' }, { value: 0, icon: 'straight', title: 'Straight' }, { value: 1, icon: 'curveR', title: 'Curve right' }]} />
      </div>` : null}
      ${a.type === 'press' ? html`<${Toggle} id="ia-move" label="Close down" hint="Presser moves toward the opponent" checked=${a.move} onChange=${(v) => updateAction(id, { move: v })} />` : null}
      ${a.type !== 'press' ? html`<${Field} label=${`Curve ${a.curve ? (a.curve > 0 ? '+' : '') + a.curve.toFixed(1) + ' m' : '(straight)'}`} for="ia-curve" hint="Or drag the round handle on the pitch">
        <div class="row gap-s">
          <input id="ia-curve" type="range" min="-20" max="20" step="0.5" value=${a.curve || 0} class="range grow"
            onInput=${(e) => updateAction(id, { curve: +e.currentTarget.value }, { history: false })}
            onChange=${(e) => updateAction(id, { curve: +e.currentTarget.value })} />
          <button type="button" class="btn btn-ghost btn-sm" onClick=${() => updateAction(id, { curve: 0 })}>Straight</button>
        </div>
      <//>` : null}
      <${Field} label=${`Starts at ${Math.round((a.delay || 0) * 100)}% of the step`} for="ia-delay" hint="Delay a run so it starts after the pass">
        <input id="ia-delay" type="range" min="0" max="0.8" step="0.05" value=${a.delay || 0} class="range"
          onInput=${(e) => updateAction(id, { delay: +e.currentTarget.value }, { history: false })}
          onChange=${(e) => updateAction(id, { delay: +e.currentTarget.value })} />
      <//>
      <${Field} label="Line color">
        <div class="swatches">
          <button type="button" class=${cx('swatch-btn', !a.color && 'on')} style=${{ background: def }} aria-label="Default color" onClick=${() => updateAction(id, { color: null })}><span>Auto</span></button>
          ${LINE_SWATCHES.map((c) => html`<button type="button" class=${cx('swatch-btn', a.color === c && 'on')} style=${{ background: c }} aria-label=${'Color ' + c} onClick=${() => updateAction(id, { color: c })}></button>`)}
        </div>
      <//>
    </div>`;
}
