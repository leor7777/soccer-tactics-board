import { html, useState, useMemo } from './lib.js';
import {
  useStore, activePlan, activePlay, setUI, applyFormation, updateTeam, updatePlayer, saveCustomFormation,
  deleteCustomFormation, resetToFormation, getState, boardPositions, timelineFor,
} from './store.js';
import { FORMATIONS, FORMATION_GROUPS, KIT_PRESETS, KIT_PATTERNS, POSITIONS, ROLE_BY_ID } from './data.js';
import { SYSTEMS, SYSTEM_GROUPS } from './systems.js';
import { shadesOf } from './analysis.js';
import { Icon } from './icons.js';
import { Seg, Field, TextInput, ColorInput, Section, MiniShape, Btn, ConfirmBtn, Toggle, cx, inkOn, showColor } from './ui.js';

export function TeamPanel() {
  const plan = useStore(activePlan);
  const side = useStore((s) => s.ui.teamSide);
  const team = plan.teams[side];
  return html`<div class="panel-body">
    <${TeamColors} />
    <${QuickShapes} />
    <div class="team-switch">
      <span class="field-label">Edit in detail</span>
      <${Seg} label="Team" value=${side} onChange=${(v) => setUI({ teamSide: v })}
        options=${['home', 'away'].map((s) => ({ value: s, label: plan.teams[s].name || (s === 'home' ? 'Home' : 'Away') }))} />
    </div>
    <div class="team-head">
      <span class="kit-chip" style=${{ background: team.primary, borderColor: team.secondary }}></span>
      <${TextInput} id="team-name" class="input-lg" value=${team.name} onCommit=${(v) => updateTeam(side, { name: v.trim() || (side === 'home' ? 'Your team' : 'Opponent') })} aria-label="Team name" />
      <${Icon} name="pen" size=${16} class="team-head-pen" />
    </div>
    <${ShapeLibrary} side=${side} />
    <${KitEditor} side=${side} />
    <${PlayerList} side=${side} />
  </div>`;
}

// Both teams' colors in one place: any color via the picker or hex, or a preset.
function TeamColors() {
  const plan = useStore(activePlan);
  const [openPresets, setOpenPresets] = useState(null);
  return html`<div class="team-colors">
    <header class="tc-head"><${Icon} name="palette" size=${16} /><span>Team names and colors</span></header>
    ${['home', 'away'].map((side) => {
      const t = plan.teams[side];
      return html`<div class="tc-row">
        <span class="tc-kit" style=${{ background: `linear-gradient(135deg, ${t.primary} 0 55%, ${t.secondary} 55%)` }}></span>
        <label class="tc-name-edit" title="Rename team">
          <span class="sr">${side === 'home' ? 'Your team name' : 'Opponent name'}</span>
          <${TextInput} class="tc-name-input" value=${t.name} maxLength=${40} onCommit=${(v) => updateTeam(side, { name: v.trim() || (side === 'home' ? 'Your team' : 'Opponent') })} />
          <${Icon} name="pen" size=${13} />
        </label>
        <label class="tc-swatch" title="Main color">
          <input type="color" value=${t.primary} aria-label=${`${t.name} main color`} onChange=${(e) => updateTeam(side, { primary: e.currentTarget.value })} />
          <span style=${{ background: t.primary }}></span><small>Main</small>
        </label>
        <label class="tc-swatch" title="Trim color">
          <input type="color" value=${t.secondary} aria-label=${`${t.name} trim color`} onChange=${(e) => updateTeam(side, { secondary: e.currentTarget.value })} />
          <span style=${{ background: t.secondary }}></span><small>Trim</small>
        </label>
        <label class="tc-swatch" title="Goalkeeper color">
          <input type="color" value=${t.gkPrimary} aria-label=${`${t.name} goalkeeper color`} onChange=${(e) => updateTeam(side, { gkPrimary: e.currentTarget.value })} />
          <span style=${{ background: t.gkPrimary }}></span><small>GK</small>
        </label>
        <button type="button" class=${cx('tc-more', openPresets === side && 'on')} aria-label=${`${t.name} color presets`} onClick=${() => setOpenPresets(openPresets === side ? null : side)}><${Icon} name="chevronDown" size=${16} /></button>
        ${openPresets === side ? html`<div class="tc-presets">
          ${KIT_PRESETS.map((k) => html`<button type="button" class="kit-preset" title=${k.name} aria-label=${'Use ' + k.name}
            onClick=${() => { updateTeam(side, { primary: k.primary, secondary: k.secondary }); setOpenPresets(null); }}>
            <span style=${{ background: `linear-gradient(135deg, ${k.primary} 0 58%, ${k.secondary} 58% 100%)` }}></span>
          </button>`)}
          <button type="button" class="link-btn" onClick=${() => updateTeam(side, { primary: t.secondary, secondary: t.primary })}>Swap main and trim</button>
        </div>` : null}
      </div>`;
    })}
  </div>`;
}

// Common formations as one-tap chips per team, plus every other shape in a menu.
function QuickShapes() {
  const plan = useStore(activePlan);
  const customs = useStore((s) => s.doc.customFormations);
  const common = FORMATIONS.filter((f) => f.common);
  return html`<div class="quick-shapes" role="group" aria-label="Quick formations">
    ${['home', 'away'].map((side) => {
      const t = plan.teams[side];
      const isCommon = common.some((f) => f.id === t.formation);
      return html`<div class="qs-row">
        <span class="qs-team"><i style=${{ background: t.primary, borderColor: t.secondary }}></i>${t.name}</span>
        <div class="qs-chips">
          ${common.map((f) => html`<button type="button" class=${cx('qs-chip', t.formation === f.id && 'on')}
            aria-pressed=${String(t.formation === f.id)} aria-label=${`${t.name}: ${f.name}`} onClick=${() => applyFormation(side, f.id)}>${f.name}</button>`)}
          <label class=${cx('qs-more', !isCommon && 'on')}>
            <span class="sr">More shapes for ${t.name}</span>
            <select value=${isCommon ? '' : t.formation} onChange=${(e) => e.currentTarget.value && applyFormation(side, e.currentTarget.value)} aria-label=${`More shapes for ${t.name}`}>
              <option value="">More…</option>
              ${FORMATION_GROUPS.map((g) => html`<optgroup label=${g}>${FORMATIONS.filter((f) => f.group === g && !f.common).map((f) => html`<option value=${f.id}>${f.name}${f.alias ? ` (${f.alias})` : ''}</option>`)}</optgroup>`)}
              ${SYSTEM_GROUPS.map((g) => html`<optgroup label=${`Famous sides: ${g}`}>${SYSTEMS.filter((x) => x.group === g).map((x) => html`<option value=${x.id}>${x.title}</option>`)}</optgroup>`)}
              ${customs.length ? html`<optgroup label="Saved shapes">${customs.map((f) => html`<option value=${f.id}>${f.name}</option>`)}</optgroup>` : null}
            </select>
          </label>
        </div>
      </div>`;
    })}
    <button type="button" class="btn btn-primary optimize-btn" onClick=${() => setUI({ panel: 'scout', optimizeAt: Date.now(), drawer: true })}>
      <${Icon} name="wand" size=${18} /><span>Optimize formation</span>
    </button>
  </div>`;
}

function ShapeLibrary({ side }) {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const customs = useStore((s) => s.doc.customFormations);
  const [tab, setTab] = useState('presets');
  const [open, setOpen] = useState(null);
  const [name, setName] = useState('');
  const [fgroup, setFgroup] = useState('All');
  const team = plan.teams[side];
  const color = 'var(--accent)';

  const step = useStore((s) => s.ui.step);
  const pos = play ? timelineFor(plan, play, 2.6).states[step]?.pos || play.start.pos : boardPositions(plan);
  const shades = useMemo(() => {
    const pts = team.players.map((p) => ({ ...pos[p.id], gk: p.gk, role: p.role }));
    return shadesOf(pts, SYSTEMS, side, 3);
  }, [team.players, pos, side]);

  return html`<${Section} title="Shape" aside=${html`<span class="muted small">${labelFor(team.formation, customs)}</span>`}>
    <div class="shades">
      ${shades.map((s, i) => html`<button type="button" class=${cx('shade', i === 0 && 'top')} onClick=${() => { setTab('systems'); setOpen(s.system.id); }}>
        <span class="shade-pct tnum">${s.similarity}%</span>
        <span class="shade-text"><small>Shades of</small><strong>${s.system.name}</strong></span>
        <span class="shade-bar"><span style=${`transform:scaleX(${s.similarity / 100})`}></span></span>
      </button>`)}
    </div>
    <${Seg} size="sm" label="Shape source" value=${tab} onChange=${setTab}
      options=${[{ value: 'presets', label: `Formations (${FORMATIONS.length})` }, { value: 'systems', label: `Famous sides (${SYSTEMS.length})` }, { value: 'custom', label: `Saved (${customs.length})` }]} />
    ${tab === 'presets' ? html`<div class="stack-s">
      <${Seg} size="sm" wrap label="Formation group" value=${fgroup} onChange=${setFgroup} options=${['All', ...FORMATION_GROUPS].map((g) => ({ value: g, label: g }))} />
      <div class="shape-grid">
        ${FORMATIONS.filter((f) => fgroup === 'All' || f.group === fgroup).map((f) => html`<button type="button" class=${cx('shape-card', team.formation === f.id && 'on')} onClick=${() => applyFormation(side, f.id)} title=${f.alias || f.name}>
          <${MiniShape} slots=${f.slots} color=${color} />
          <span class="shape-name tnum">${f.name}</span>
          ${f.alias ? html`<span class="shape-alias">${f.alias}</span>` : null}
        </button>`)}
      </div>
    </div>` : null}
    ${tab === 'systems' ? html`<${SystemList} side=${side} open=${open} setOpen=${setOpen} current=${team.formation} />` : null}
    ${tab === 'custom' ? html`<div class="stack-s">
      ${customs.length ? html`<div class="shape-grid">${customs.map((f) => html`<div class=${cx('shape-card', team.formation === f.id && 'on')}>
        <button type="button" class="shape-hit" onClick=${() => applyFormation(side, f.id)} aria-label=${'Use ' + f.name}>
          <${MiniShape} slots=${f.slots} color=${color} />
          <span class="shape-name">${f.name}</span>
        </button>
        <button type="button" class="shape-del" aria-label=${'Delete ' + f.name} onClick=${() => deleteCustomFormation(f.id)}><${Icon} name="x" size=${14} /></button>
      </div>`)}</div>` : html`<p class="muted small">Drag players into a shape, then save it here to reuse in any game plan.</p>`}
      <form class="row gap-s" onSubmit=${(e) => { e.preventDefault(); saveCustomFormation(name.trim() || `${team.name} shape`, side); setName(''); }}>
        <label class="sr" for="cf-name">Shape name</label>
        <input id="cf-name" class="input grow" placeholder="Name this shape" value=${name} maxLength="40" onInput=${(e) => setName(e.currentTarget.value)} />
        <${Btn} variant="primary" size="sm" type="submit" icon="plus">Save<//>
      </form>
    </div>` : null}
    <div class="row gap-s wrap">
      <${Btn} size="sm" icon="restart" onClick=${() => resetToFormation(side)}>Reset positions<//>
    </div>
  <//>`;
}

function labelFor(id, customs) {
  const f = FORMATIONS.find((x) => x.id === id) || customs.find((x) => x.id === id) || SYSTEMS.find((x) => x.id === id);
  if (!f) return id;
  return f.title || f.name;
}

const STYLE_KEYS = [['press', 'Press'], ['possession', 'Possession'], ['direct', 'Direct'], ['width', 'Width'], ['line', 'Line height']];

function SystemList({ side, open, setOpen, current }) {
  const [group, setGroup] = useState('All');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = SYSTEMS.filter((s) => (group === 'All' || s.group === group)
    && (!needle || `${s.title} ${s.shape} ${s.team} ${s.coach}`.toLowerCase().includes(needle)));
  return html`<div class="stack-s">
    <div class="row gap-s">
      <label class="search grow"><${Icon} name="scout" size=${15} /><span class="sr">Search famous sides</span>
        <input class="input" type="search" placeholder="Search coach, club or shape" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></label>
    </div>
    <${Seg} size="sm" label="Era" value=${group} onChange=${setGroup} options=${['All', ...SYSTEM_GROUPS].map((g) => ({ value: g, label: g === 'Current' ? 'Current (2020+)' : g === 'Modern' ? 'Modern (1990s+)' : g }))} />
    ${list.length ? null : html`<p class="muted small">No sides match "${q}".</p>`}
    <ul class="sys-list">
      ${list.map((s) => {
        const isOpen = open === s.id;
        return html`<li class=${cx('sys', isOpen && 'open', current === s.id && 'on')}>
          <button type="button" class="sys-head" aria-expanded=${String(isOpen)} onClick=${() => setOpen(isOpen ? null : s.id)}>
            <${MiniShape} slots=${s.slots} w=${36} h=${50} />
            <span class="sys-title"><strong>${s.name}</strong><small>${s.era} · ${s.shape}</small></span>
            <${Icon} name="chevronDown" size=${16} class="chev" />
          </button>
          ${isOpen ? html`<div class="sys-body">
            <p>${s.summary}</p>
            <div class="style-meters">
              ${STYLE_KEYS.map(([k, label]) => html`<div class="meter"><span>${label}</span><span class="meter-track">${[1, 2, 3, 4, 5].map((i) => html`<i class=${i <= s.style[k] ? 'on' : ''}></i>`)}</span></div>`)}
            </div>
            <h4>Principles</h4>
            <ul class="bullets">${s.principles.map((x) => html`<li>${x}</li>`)}</ul>
            <h4>Players it needs</h4>
            <ul class="bullets">${s.needs.map((x) => html`<li>${x}</li>`)}</ul>
            <div class="chips">${[...new Set(s.slots.map((x) => x.role))].map((r) => html`<span class="chip">${ROLE_BY_ID[r]?.name}</span>`)}</div>
            <${Btn} variant="primary" size="sm" icon="layers" onClick=${() => { applyFormation(side, s.id); setUI({ flood: { color: 'var(--accent)', at: Date.now() } }); }}>Use this shape<//>
          </div>` : null}
        </li>`;
      })}
    </ul>
  </div>`;
}

function KitEditor({ side }) {
  const plan = useStore(activePlan);
  const team = plan.teams[side];
  return html`<${Section} title="Kit details">
    <${Field} label="Pattern"><${Seg} size="sm" wrap label="Kit pattern" value=${team.pattern} onChange=${(v) => updateTeam(side, { pattern: v })} options=${KIT_PATTERNS.map((p) => ({ value: p.id, label: p.name }))} /><//>
    <div class="grid-2">
      <${Field} label="Number color"><${Seg} size="sm" label="Number color" value=${team.numColor} onChange=${(v) => updateTeam(side, { numColor: v })} options=${[{ value: 'auto', label: 'Auto' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }]} /><//>
      <${Field} label="Goalkeeper trim"><${ColorInput} id=${'kit-gs-' + side} label="Goalkeeper trim color" value=${team.gkSecondary} onChange=${(v) => updateTeam(side, { gkSecondary: v })} /><//>
    </div>
    <${Toggle} id=${'vis-' + side} label="Show this team" checked=${team.visible !== false} onChange=${(v) => updateTeam(side, { visible: v })} />
  <//>`;
}

function PlayerList({ side }) {
  const plan = useStore(activePlan);
  const sel = useStore((s) => s.ui.sel);
  const team = plan.teams[side];
  return html`<${Section} title="Players" aside=${html`<span class="muted small">Tap a row to select on the pitch</span>`}>
    <ul class="plist">
      ${team.players.map((p) => {
        const c = p.gk ? team.gkPrimary : team.primary;
        const on = sel?.kind === 'player' && sel.id === p.id;
        return html`<li class=${cx('prow', on && 'on')} onClick=${(e) => { if (e.target.closest('input,select')) return; setUI({ sel: { kind: 'player', id: p.id } }); }}>
          <span class="ptoken" style=${{ background: c, color: inkOn(c), borderColor: p.gk ? team.gkSecondary : team.secondary }}>${p.num}</span>
          <input class="input input-num tnum" type="number" min="1" max="99" value=${p.num} aria-label=${`Number for ${p.name || p.label}`}
            onChange=${(e) => updatePlayer(p.id, { num: Math.max(1, Math.min(99, +e.currentTarget.value || 1)) })} />
          <${TextInput} class="grow" value=${p.name} placeholder=${p.label} aria-label=${`Name for ${p.label}`} onCommit=${(v) => updatePlayer(p.id, { name: v })} />
          <select class="input input-pos" value=${p.label} aria-label=${`Position for ${p.name || p.label}`} onChange=${(e) => updatePlayer(p.id, { label: e.currentTarget.value })}>
            ${POSITIONS.some(([l]) => l === p.label) ? null : html`<option value=${p.label}>${p.label}</option>`}
            ${POSITIONS.map(([l]) => html`<option value=${l}>${l}</option>`)}
          </select>
        </li>`;
      })}
    </ul>
  <//>`;
}
