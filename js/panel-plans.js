import { html, useState, useRef } from './lib.js';
import {
  useStore, activePlan, selectPlan, createPlan, duplicatePlan, renamePlan, deletePlan, updatePlan,
  importPlanData, resetWorkspace, toast, exportPlanData,
} from './store.js';
import { exportPlanJSON, exportBoardPNG, exportStoryboardPNG } from './export.js';
import { Icon } from './icons.js';
import { Section, Btn, ConfirmBtn, TextInput, Field, cx } from './ui.js';

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function PlansPanel() {
  const plans = useStore((s) => s.doc.plans);
  const plan = useStore(activePlan);
  const opps = useStore((s) => s.doc.opponents);
  const fileRef = useRef();
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');

  const importText = (raw) => {
    try {
      const p = importPlanData(JSON.parse(raw));
      toast(`Imported "${p.name}".`, 'good');
      setPaste(false); setText('');
    } catch (e) {
      toast(e instanceof SyntaxError ? 'That is not valid JSON. Check the file and try again.' : e.message, 'risk');
    }
  };
  const onFile = (e) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importText(String(r.result));
    r.readAsText(f);
    e.currentTarget.value = '';
  };
  const copyJSON = async () => {
    const txt = JSON.stringify(exportPlanData(), null, 2);
    try { await navigator.clipboard.writeText(txt); toast('Game plan copied. Paste it into Import on another device.', 'good'); }
    catch { setPaste(true); setText(txt); toast('Copy the text below.'); }
  };

  return html`<div class="panel-body">
    <${Section} title="Game plans" aside=${html`<${Btn} size="sm" variant="primary" icon="plus" onClick=${() => createPlan('New game plan')}>New<//>`}>
      <ul class="plan-list">
        ${[...plans].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => html`<li>
          <button type="button" class=${cx('plan-row', p.id === plan.id && 'on')} onClick=${() => selectPlan(p.id)}>
            <span class="plan-kits">
              <i style=${{ background: p.teams.home.primary, borderColor: p.teams.home.secondary }}></i>
              <i style=${{ background: p.teams.away.primary, borderColor: p.teams.away.secondary }}></i>
            </span>
            <span class="plan-name"><strong>${p.name}</strong><small>${p.plays.length} play${p.plays.length === 1 ? '' : 's'} · ${ago(p.updatedAt)}</small></span>
          </button>
        </li>`)}
      </ul>
    <//>

    <${Section} title="This plan">
      <${Field} label="Name" for="pl-name"><${TextInput} id="pl-name" value=${plan.name} onCommit=${(v) => renamePlan(plan.id, v || 'Game plan')} /><//>
      <${Field} label="Opponent" for="pl-opp">
        <select id="pl-opp" class="input" value=${plan.opponentId || ''} onChange=${(e) => updatePlan({ opponentId: e.currentTarget.value || null })}>
          <option value="">None</option>
          ${opps.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
        </select>
      <//>
      <${Field} label="Notes" for="pl-notes"><${TextInput} id="pl-notes" multiline rows=${4} maxLength=${2000} value=${plan.notes} placeholder="Team talk, set pieces, substitutions" onCommit=${(v) => updatePlan({ notes: v })} /><//>
      <div class="row gap-s wrap">
        <${Btn} size="sm" icon="copy" onClick=${() => duplicatePlan(plan.id)}>Duplicate<//>
        <${ConfirmBtn} label="Delete plan" onConfirm=${() => deletePlan(plan.id)} />
      </div>
    <//>

    <${Section} title="Share and export">
      <div class="export-grid">
        <button type="button" class="export-card" onClick=${exportPlanJSON}><${Icon} name="download" size=${20} /><strong>Game plan file</strong><small>.json, opens on any device</small></button>
        <button type="button" class="export-card" onClick=${() => fileRef.current.click()}><${Icon} name="upload" size=${20} /><strong>Import plan</strong><small>From a .json file</small></button>
        <button type="button" class="export-card" onClick=${exportBoardPNG}><${Icon} name="image" size=${20} /><strong>Board image</strong><small>PNG of what's on the pitch</small></button>
        <button type="button" class="export-card" onClick=${exportStoryboardPNG}><${Icon} name="layers" size=${20} /><strong>Storyboard</strong><small>Every step of the play</small></button>
      </div>
      <input ref=${fileRef} type="file" accept=".json,application/json" class="sr" aria-label="Import game plan file" onChange=${onFile} />
      <div class="row gap-s wrap">
        <${Btn} size="sm" icon="copy" onClick=${copyJSON}>Copy as text<//>
        <${Btn} size="sm" icon="upload" onClick=${() => setPaste(!paste)}>Paste plan text<//>
      </div>
      ${paste ? html`<div class="field">
        <label class="field-label" for="pl-paste">Plan text</label>
        <textarea id="pl-paste" class="input mono" rows="5" value=${text} onInput=${(e) => setText(e.currentTarget.value)} placeholder='{"app": "soccer-tactics-board", ...}'></textarea>
        <div class="row gap-s"><${Btn} size="sm" variant="primary" onClick=${() => importText(text)}>Import<//><${Btn} size="sm" onClick=${() => setPaste(false)}>Cancel<//></div>
      </div>` : null}
      <p class="muted small">Everything saves automatically in this browser. Use a game plan file to move a plan to a tablet or share it with staff.</p>
    <//>

    <${Section} title="Data">
      <div class="row gap-s wrap"><${ConfirmBtn} label="Reset to example workspace" confirm="Erase and reset" icon="restart" onConfirm=${resetWorkspace} /></div>
      <p class="muted small">Replaces every plan, squad player and opponent in this browser with the examples.</p>
    <//>
  </div>`;
}
