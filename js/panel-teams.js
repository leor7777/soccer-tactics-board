// Teams manager: coaches with several sides (Varsity, JV, U14...) keep each team's squad,
// plans, opponents, set pieces and saved shapes separate.
import { html, useState, useRef } from './lib.js';
import {
  useStore, switchTeam, createTeam, updateTeamProfile, duplicateTeam, deleteTeam, exportTeamData, importTeamData,
  teamStats, toast,
} from './store.js';
import { stop } from './player.js';
import { saveFile, slug } from './export.js';
import { KIT_PRESETS } from './data.js';
import { Icon } from './icons.js';
import { Btn, ConfirmBtn, TextInput, Toggle, cx } from './ui.js';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function TeamsPanel() {
  const s = useStore((x) => x);
  const club = s.club;
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(club.teams.length === 1);
  const fileRef = useRef();

  const onFile = (e) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { const t = importTeamData(JSON.parse(String(r.result))); toast(`Imported ${t.name}.`, 'good'); }
      catch (err) { toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'risk'); }
    };
    r.readAsText(f);
    e.currentTarget.value = '';
  };

  return html`<div class="panel-body teams-body">
    <p class="intro-line"><${Icon} name="users" size=${16} />Each team has its own squad, game plans, opponents, set pieces and saved shapes. View settings are shared.</p>
    <ul class="team-list">
      ${club.teams.map((t) => {
        const st = teamStats(t, s);
        const active = t.id === club.activeTeamId;
        const open = editing === t.id;
        return html`<li class=${cx('team-card', active && 'on', open && 'open')}>
          <div class="team-card-main">
            <button type="button" class="team-pick" onClick=${() => { if (!active) { stop(); switchTeam(t.id); } }} aria-label=${active ? `${t.name} (current team)` : `Switch to ${t.name}`}>
              <span class="team-badge" style=${{ background: `linear-gradient(135deg, ${t.primary} 0 56%, ${t.secondary} 56%)` }}>${(t.name || '?').trim().slice(0, 1).toUpperCase()}</span>
              <span class="team-text">
                <strong>${t.name}</strong>
                <small>${plural(st.players, 'player')} · ${plural(st.plans, 'plan')} · ${plural(st.plays, 'play')} · ${plural(st.setPieces, 'set piece')}</small>
              </span>
              ${active ? html`<span class="badge">Current</span>` : html`<span class="team-switch-cta">Switch<${Icon} name="chevronRight" size=${14} /></span>`}
            </button>
            <button type="button" class=${cx('ibtn', open && 'on')} aria-label=${`Edit ${t.name}`} aria-expanded=${String(open)} onClick=${() => setEditing(open ? null : t.id)}><${Icon} name="sliders" size=${18} /></button>
          </div>
          ${open ? html`<${TeamEditor} t=${t} onDone=${() => setEditing(null)} canDelete=${club.teams.length > 1} />` : null}
        </li>`;
      })}
    </ul>

    ${adding ? html`<${NewTeamForm} onCancel=${() => setAdding(false)} />` : html`<div class="row gap-s wrap">
      <${Btn} variant="primary" icon="plus" onClick=${() => setAdding(true)}>New team<//>
      <${Btn} icon="upload" onClick=${() => fileRef.current.click()}>Import team<//>
    </div>`}
    <input ref=${fileRef} type="file" accept=".json,application/json" class="sr" aria-label="Import team backup" onChange=${onFile} />
  </div>`;
}

function TeamEditor({ t, onDone, canDelete }) {
  return html`<div class="team-edit">
    <div class="field"><label class="field-label" for=${'tn-' + t.id}>Team name</label>
      <${TextInput} id=${'tn-' + t.id} value=${t.name} maxLength=${40} onCommit=${(v) => updateTeamProfile(t.id, { name: v.trim() || t.name })} /></div>
    <div class="row gap-m wrap">
      <label class="tc-swatch big"><input type="color" value=${t.primary} aria-label="Main color" onChange=${(e) => updateTeamProfile(t.id, { primary: e.currentTarget.value })} /><span style=${{ background: t.primary }}></span><small>Main</small></label>
      <label class="tc-swatch big"><input type="color" value=${t.secondary} aria-label="Trim color" onChange=${(e) => updateTeamProfile(t.id, { secondary: e.currentTarget.value })} /><span style=${{ background: t.secondary }}></span><small>Trim</small></label>
      <div class="kit-row">${KIT_PRESETS.map((k) => html`<button type="button" class="kit-preset" title=${k.name} aria-label=${'Use ' + k.name} onClick=${() => updateTeamProfile(t.id, { primary: k.primary, secondary: k.secondary })}>
        <span style=${{ background: `linear-gradient(135deg, ${k.primary} 0 58%, ${k.secondary} 58% 100%)` }}></span></button>`)}</div>
    </div>
    <p class="muted small">Name and colors apply to your side in every game plan for this team.</p>
    <div class="row gap-s wrap">
      <${Btn} size="sm" icon="download" onClick=${() => saveFile(`${slug(t.name)}.team.json`, JSON.stringify(exportTeamData(t.id), null, 2))}>Back up team<//>
      <${Btn} size="sm" icon="copy" onClick=${() => { duplicateTeam(t.id); toast(`Copied ${t.name}.`, 'good'); }}>Duplicate<//>
      ${canDelete ? html`<${ConfirmBtn} label="Delete team" confirm=${`Delete ${t.name}`} onConfirm=${() => { deleteTeam(t.id); onDone(); }} />` : null}
      <${Btn} size="sm" onClick=${onDone}>Done<//>
    </div>
  </div>`;
}

function NewTeamForm({ onCancel }) {
  const [name, setName] = useState('');
  const [kit, setKit] = useState(KIT_PRESETS[2]);
  const [primary, setPrimary] = useState(KIT_PRESETS[2].primary);
  const [secondary, setSecondary] = useState(KIT_PRESETS[2].secondary);
  const [copy, setCopy] = useState({ setPieces: true, shapes: true, opponents: false });
  const submit = (e) => {
    e.preventDefault();
    stop();
    createTeam({ name: name.trim() || 'New team', primary, secondary, copy });
  };
  return html`<form class="new-team" onSubmit=${submit}>
    <header><strong>New team</strong><span class="muted small">Starts with an empty squad and one game plan.</span></header>
    <div class="field"><label class="field-label" for="nt-name">Team name</label>
      <input id="nt-name" class="input" placeholder="e.g. JV, U14 Girls, Varsity" maxLength="40" value=${name} onInput=${(e) => setName(e.currentTarget.value)} /></div>
    <div class="field"><span class="field-label">Kit</span>
      <div class="row gap-m wrap">
        <label class="tc-swatch big"><input type="color" value=${primary} aria-label="Main color" onInput=${(e) => setPrimary(e.currentTarget.value)} /><span style=${{ background: primary }}></span><small>Main</small></label>
        <label class="tc-swatch big"><input type="color" value=${secondary} aria-label="Trim color" onInput=${(e) => setSecondary(e.currentTarget.value)} /><span style=${{ background: secondary }}></span><small>Trim</small></label>
        <div class="kit-row">${KIT_PRESETS.map((k) => html`<button type="button" class=${cx('kit-preset', kit === k && 'on')} title=${k.name} aria-label=${'Use ' + k.name}
          onClick=${() => { setKit(k); setPrimary(k.primary); setSecondary(k.secondary); }}><span style=${{ background: `linear-gradient(135deg, ${k.primary} 0 58%, ${k.secondary} 58% 100%)` }}></span></button>`)}</div>
      </div>
    </div>
    <div class="field"><span class="field-label">Bring over from your current team</span>
      <${Toggle} id="nt-sp" label="Set pieces" checked=${copy.setPieces} onChange=${(v) => setCopy({ ...copy, setPieces: v })} />
      <${Toggle} id="nt-sh" label="Saved shapes" checked=${copy.shapes} onChange=${(v) => setCopy({ ...copy, shapes: v })} />
      <${Toggle} id="nt-op" label="Opponent scouting reports" hint="Useful when two of your teams play the same schools" checked=${copy.opponents} onChange=${(v) => setCopy({ ...copy, opponents: v })} />
    </div>
    <div class="row gap-s">
      <${Btn} variant="primary" type="submit" icon="plus">Create team<//>
      <${Btn} onClick=${onCancel}>Cancel<//>
    </div>
  </form>`;
}
