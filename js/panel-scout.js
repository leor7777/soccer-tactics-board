import { html, useState, useMemo } from './lib.js';
import {
  useStore, activePlan, setUI, addOpponent, updateOpponent, deleteOpponent, loadOpponentOnBoard, applyFormation,
  applyLineup, updatePlan, shapeFor, getState,
} from './store.js';
import { FORMATIONS, TAGS, TAG_BY_ID, ROLE_BY_ID, OPP_RATINGS } from './data.js';
import { SYSTEMS } from './systems.js';
import { optimizeFormation } from './analysis.js';
import { useEffect, useRef } from './lib.js';
import { uid } from './sample.js';
import { Icon } from './icons.js';
import { Section, Btn, ConfirmBtn, TextInput, ColorInput, Field, Empty, FitChip, MiniShape, Seg, Dots, CountUp, cx } from './ui.js';

export function ScoutPanel() {
  const opps = useStore((s) => s.doc.opponents);
  const plan = useStore(activePlan);
  const scoutId = useStore((s) => s.ui.scoutId);
  const current = opps.find((o) => o.id === (scoutId || plan.opponentId)) || null;

  return html`<div class="panel-body">
    <${Optimizer} o=${current} />
    <${Section} title="Opponents" aside=${html`<${Btn} size="sm" variant="primary" icon="plus" onClick=${addOpponent}>Add<//>`}>
      ${opps.length ? html`<ul class="opp-list">
        ${opps.map((o) => html`<li>
          <button type="button" class=${cx('opp-row', current?.id === o.id && 'on')} onClick=${() => setUI({ scoutId: o.id })}>
            <span class="opp-kit" style=${{ background: `linear-gradient(135deg, ${o.primary} 0 60%, ${o.secondary} 60%)` }}></span>
            <span class="opp-name"><strong>${o.name}</strong><small>${shapeFor(o.formation)?.name || o.formation} · ${o.tags.length} tendencies</small></span>
            ${plan.opponentId === o.id ? html`<span class="badge">This plan</span>` : null}
          </button>
        </li>`)}
      </ul>` : html`<${Empty} icon="scout" title="No opponents scouted">Add an opponent with their usual shape and tendencies to get matchup suggestions.<//>`}
    <//>
    ${current ? html`<${OpponentEditor} o=${current} />` : null}
  </div>`;
}

function OpponentEditor({ o }) {
  const plan = useStore(activePlan);
  const set = (patch) => updateOpponent(o.id, patch);
  const toggleTag = (t) => set({ tags: o.tags.includes(t) ? o.tags.filter((x) => x !== t) : [...o.tags, t] });
  return html`<${Section} title="Scouting report">
    <${Field} label="Team name" for="op-name"><${TextInput} id="op-name" value=${o.name} onCommit=${(v) => set({ name: v || 'Opponent' })} /><//>
    <div class="grid-2">
      <${Field} label="Usual shape" for="op-form">
        <select id="op-form" class="input" value=${o.formation} onChange=${(e) => set({ formation: e.currentTarget.value })}>
          <optgroup label="Formations">${FORMATIONS.map((f) => html`<option value=${f.id}>${f.name}</option>`)}</optgroup>
          <optgroup label="Famous systems">${SYSTEMS.map((f) => html`<option value=${f.id}>${f.title}</option>`)}</optgroup>
        </select>
      <//>
      <${Field} label="Colors">
        <div class="row gap-s">
          <${ColorInput} id="op-p" label="Primary" value=${o.primary} onChange=${(v) => set({ primary: v })} />
          <input type="color" class="color-mini" value=${o.secondary} aria-label="Secondary color" onChange=${(e) => set({ secondary: e.currentTarget.value })} />
        </div>
      <//>
    </div>
    <${Field} label="Tendencies">
      <div class="chips selectable">${TAGS.map((t) => html`<button type="button" class=${cx('chip', o.tags.includes(t.id) && 'on')} aria-pressed=${String(o.tags.includes(t.id))} onClick=${() => toggleTag(t.id)}>${t.name}</button>`)}</div>
    <//>
    <${Field} label="Their strengths (1 weak – 5 strong)">
      <div class="ratings">
        ${OPP_RATINGS.map((r) => html`<div class="rating-row" title=${r.hint}>
          <span>${r.name}</span>
          <${Dots} label=${r.name} value=${o.ratings?.[r.id] ?? 3} onChange=${(v) => set({ ratings: { ...(o.ratings || {}), [r.id]: v } })} />
        </div>`)}
      </div>
    <//>
    <${Field} label="Notes" for="op-notes"><${TextInput} id="op-notes" multiline rows=${3} maxLength=${600} value=${o.notes} placeholder="How they play, what to watch for" onCommit=${(v) => set({ notes: v })} /><//>
    <${KeyPlayers} o=${o} />
    <div class="row gap-s wrap">
      <${Btn} size="sm" variant="primary" icon="users" onClick=${() => loadOpponentOnBoard(o.id)}>Put on the board<//>
      ${plan.opponentId !== o.id ? html`<${Btn} size="sm" icon="link" onClick=${() => updatePlan({ opponentId: o.id })}>Link to this plan<//>` : null}
      <${ConfirmBtn} label="Delete" onConfirm=${() => deleteOpponent(o.id)} />
    </div>
  <//>`;
}

function KeyPlayers({ o }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const set = (keyPlayers) => updateOpponent(o.id, { keyPlayers });
  return html`<div class="field">
    <span class="field-label">Key players</span>
    <ul class="kp-list">
      ${o.keyPlayers.map((k) => html`<li>
        <div class="grow">
          <${TextInput} value=${k.name} aria-label="Key player" onCommit=${(v) => set(o.keyPlayers.map((x) => (x.id === k.id ? { ...x, name: v } : x)))} />
          <${TextInput} value=${k.note} aria-label="Note" class="input-sub" placeholder="Note" onCommit=${(v) => set(o.keyPlayers.map((x) => (x.id === k.id ? { ...x, note: v } : x)))} />
        </div>
        <button type="button" class="ibtn" aria-label=${'Remove ' + k.name} onClick=${() => set(o.keyPlayers.filter((x) => x.id !== k.id))}><${Icon} name="x" size=${16} /></button>
      </li>`)}
    </ul>
    <form class="kp-add" onSubmit=${(e) => { e.preventDefault(); if (!name.trim()) return; set([...o.keyPlayers, { id: uid('kp_'), name: name.trim(), note: note.trim() }]); setName(''); setNote(''); }}>
      <input class="input" placeholder="#10 Playmaker" value=${name} maxLength="40" aria-label="New key player" onInput=${(e) => setName(e.currentTarget.value)} />
      <input class="input" placeholder="What to watch for" value=${note} maxLength="120" aria-label="Note for new key player" onInput=${(e) => setNote(e.currentTarget.value)} />
      <${Btn} size="sm" type="submit" icon="plus">Add<//>
    </form>
  </div>`;
}

// Ranks every shape for the next game from your squad's attributes and the opponent's
// shape, tendencies and strengths, with a suggested lineup for each.
function Optimizer({ o }) {
  const roster = useStore((s) => s.doc.roster);
  const customs = useStore((s) => s.doc.customFormations);
  const plan = useStore(activePlan);
  const requested = useStore((s) => s.ui.optimizeAt);
  const [scope, setScope] = useState('all');
  const [open, setOpen] = useState(null);
  const ref = useRef();
  useEffect(() => { if (requested && ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [requested]);

  const oppShape = o ? shapeFor(o.formation) : shapeFor(plan.teams.away.formation);
  const opponent = { slots: oppShape?.slots || FORMATIONS[0].slots, tags: o?.tags || [], ratings: o?.ratings || {} };
  const results = useMemo(() => {
    const cands = [
      ...(scope !== 'systems' ? FORMATIONS.map((f) => ({ id: f.id, name: f.name, slots: f.slots, kind: f.alias || f.group })) : []),
      ...(scope !== 'systems' ? customs.map((f) => ({ id: f.id, name: f.name, slots: f.slots, kind: 'Saved shape' })) : []),
      ...(scope !== 'formations' ? SYSTEMS.map((f) => ({ id: f.id, name: f.title, slots: f.slots, kind: f.shape })) : []),
    ];
    const kinds = Object.fromEntries(cands.map((c) => [c.id, c.kind]));
    return optimizeFormation(cands, { roster, opponent }).slice(0, 6).map((r) => ({ ...r, kind: kinds[r.id] }));
  }, [roster, customs, scope, o, oppShape]);

  const squadReady = roster.filter((r) => r.available !== false).length >= 11;
  const apply = (r) => {
    if (r.lineup) applyLineup(r.lineup, r.id); else applyFormation('home', r.id);
    if (o && plan.opponentId !== o.id) updatePlan({ opponentId: o.id });
    setUI({ flood: { color: plan.teams.home.primary, at: Date.now() } });
  };
  const oppName = o ? o.name.replace(/\s*\(example\)$/i, '') : plan.teams.away.name;

  return html`<section class="optimizer" ref=${ref} key=${requested}>
    <header class="opt-head">
      <span class="opt-ic"><${Icon} name="wand" size=${20} /></span>
      <div><small class="eyebrow">Optimize formation</small><strong>Best shapes against ${oppName}</strong></div>
    </header>
    <p class="opt-basis">
      Using ${squadReady ? html`<b>your squad's attributes</b>` : html`<b class="warn-text-inline">no squad yet</b> (add 11+ players in Squad)`},
      their <b>${oppShape?.title || oppShape?.name || 'shape'}</b>${o?.tags?.length ? html`, <b>${o.tags.length} tendencies</b>` : ''}${o && Object.keys(o.ratings || {}).length ? html` and <b>strength ratings</b>` : o ? ' (rate their strengths below for sharper results)' : ''}.
    </p>
    <${Seg} size="sm" label="Compare" value=${scope} onChange=${setScope} options=${[{ value: 'all', label: 'Everything' }, { value: 'formations', label: 'Formations' }, { value: 'systems', label: 'Famous sides' }]} />
    <ol class="opt-list">
      ${results.map((r, i) => {
        const isOpen = open === r.id || (open === null && i === 0);
        return html`<li class=${cx(isOpen && 'open', i === 0 && 'best')} style=${`animation-delay:${i * 55}ms`}>
          <button type="button" class="opt-row" aria-expanded=${String(isOpen)} onClick=${() => setOpen(isOpen ? '' : r.id)}>
            <span class="rank tnum">${i + 1}</span>
            <span class="opt-name"><strong>${r.name}</strong><small>${r.kind}</small></span>
            <span class="score-ring" style=${`--p:${r.total}`}><span class="tnum"><${CountUp} value=${r.total} /></span></span>
          </button>
          ${isOpen ? html`<div class="opt-body">
            <div class="opt-bars">
              ${[['Matchup', r.parts.matchup], ['Squad fit', r.parts.squad], ['Exploits', r.parts.exploit]].map(([label, v]) => html`<div class="opt-bar">
                <span>${label}</span>
                <span class="opt-track"><span style=${`transform:scaleX(${(v ?? 0) / 100})`}></span></span>
                <span class="tnum">${v ?? '–'}</span>
              </div>`)}
            </div>
            <ul class="reasons">${r.reasons.slice(0, 5).map((x) => html`<li class=${x.delta > 0 ? 'pos' : x.delta < 0 ? 'neg' : 'zero'}>
              <span class="delta tnum">${x.delta > 0 ? '+' : ''}${x.delta}</span><span>${x.text}</span>
            </li>`)}</ul>
            ${r.lineup ? html`<ul class="lineup compact">
              ${r.lineup.map((l) => html`<li><span class="slot-label">${l.label}</span><span class="grow">${l.player ? `#${l.player.number} ${l.player.name}` : '—'}</span><span class="slot-role">${ROLE_BY_ID[l.role]?.short}</span>${l.player ? html`<${FitChip} fit=${l.fit} />` : null}</li>`)}
            </ul>` : null}
            <${Btn} variant="primary" size="sm" icon="sparkle" onClick=${() => apply(r)}>${r.lineup ? 'Apply shape and lineup' : 'Use this shape'}<//>
          </div>` : null}
        </li>`;
      })}
    </ol>
  </section>`;
}
