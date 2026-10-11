import { html, useState, useMemo, useEffect, useRef } from './lib.js';
import {
  useStore, activePlan, setUI, addRosterPlayer, updateRosterPlayer, deleteRosterPlayer, clearSampleData,
  assignRoster, applyLineup, toast,
} from './store.js';
import { ATTRS, ROLES, ROLE_BY_ID, POSITIONS, FORMATIONS } from './data.js';
import { SYSTEMS } from './systems.js';
import { roleFit, topRoles, suggestLineup, squadSystemFit, slotFit, FIT_LOW } from './analysis.js';
import { Icon } from './icons.js';
import { Section, Seg, Btn, ConfirmBtn, Dots, Radar, FitChip, TextInput, Toggle, Empty, MiniShape, cx, showColor } from './ui.js';

export function SquadPanel() {
  const roster = useStore((s) => s.doc.roster);
  const [tab, setTab] = useState('players');
  const hasSample = roster.some((r) => r.sample);
  return html`<div class="panel-body">
    <div class="row between">
      <div class="count-pill"><strong class="tnum">${roster.length}</strong><span>/ 30 in squad</span></div>
      <${Btn} size="sm" variant="primary" icon="plus" onClick=${addRosterPlayer}>Add player<//>
    </div>
    ${hasSample ? html`<div class="notice">
      <${Icon} name="sparkle" size=${16} />
      <span>These are example players so you can try lineups and system fit. Edit them or clear them out.</span>
      <${ConfirmBtn} label="Clear examples" confirm="Clear" onConfirm=${clearSampleData} />
    </div>` : null}
    <${Seg} label="Squad view" value=${tab} onChange=${setTab}
      options=${[{ value: 'players', label: 'Profiles' }, { value: 'lineup', label: 'Lineup' }, { value: 'systems', label: 'System fit' }]} />
    ${tab === 'players' ? html`<${RosterList} />` : null}
    ${tab === 'lineup' ? html`<${Lineup} />` : null}
    ${tab === 'systems' ? html`<${SystemFit} />` : null}
  </div>`;
}

// Drag a squad player from the list onto a player token on the pitch.
function useRosterDrag() {
  const [ghost, setGhost] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    const move = (e) => { if (ref.current) { ref.current.x = e.clientX; ref.current.y = e.clientY; setGhost({ ...ref.current }); } };
    const up = (e) => {
      const g = ref.current;
      if (!g) return;
      ref.current = null;
      setGhost(null);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-hit="player"]');
      const pid = el?.dataset.id;
      if (!pid) return;
      if (!pid.startsWith('h')) { toast('Drop squad players onto your own team.', 'risk'); return; }
      assignRoster(pid, g.id);
      toast(`${g.name} assigned.`, 'good');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);
  const start = (e, r) => {
    e.preventDefault();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    ref.current = { id: r.id, name: r.name, number: r.number, x: e.clientX, y: e.clientY };
    setGhost({ ...ref.current });
  };
  const el = ghost ? html`<div class="drag-ghost" style=${`transform:translate(${ghost.x}px,${ghost.y}px)`}><span class="tnum">${ghost.number}</span>${ghost.name}</div>` : null;
  return [start, el];
}

function RosterList() {
  const roster = useStore((s) => s.doc.roster);
  const openId = useStore((s) => s.ui.rosterId);
  const plan = useStore(activePlan);
  const [start, ghost] = useRosterDrag();
  const onPitch = new Set(plan.teams.home.players.map((p) => p.rosterId).filter(Boolean));
  if (!roster.length) return html`<${Empty} icon="users" title="No players yet" action=${html`<${Btn} variant="primary" size="sm" icon="plus" onClick=${addRosterPlayer}>Add your first player<//>`}>
    Add up to 30 players with their attributes to get role fits, lineups and system suggestions.<//>`;
  return html`<div>
    <p class="muted small">Drag a player by the grip onto a spot on the pitch, or open their profile.</p>
    <ul class="roster">
      ${roster.map((r) => {
        const top = topRoles(r, 1)[0];
        const open = openId === r.id;
        return html`<li class=${cx('rrow', open && 'open', r.available === false && 'out')}>
          <div class="rrow-head">
            <span class="grip" onPointerDown=${(e) => start(e, r)} aria-label=${`Drag ${r.name} onto the pitch`} role="button" tabindex="0"><${Icon} name="grip" size=${16} /></span>
            <button type="button" class="rrow-hit" aria-expanded=${String(open)} onClick=${() => setUI({ rosterId: open ? null : r.id })}>
              <span class="rnum tnum">${r.number}</span>
              <span class="rname"><strong>${r.name}</strong><small>${r.positions.join(' · ') || 'No positions set'}${r.available === false ? ' · Unavailable' : ''}</small></span>
              ${onPitch.has(r.id) ? html`<span class="badge">XI</span>` : null}
              <span class="rtop"><small>${ROLE_BY_ID[top.role].short}</small><${FitChip} fit=${top.score} /></span>
            </button>
          </div>
          ${open ? html`<${RosterEditor} r=${r} />` : null}
        </li>`;
      })}
    </ul>
    ${ghost}
  </div>`;
}

function RosterEditor({ r }) {
  const plan = useStore(activePlan);
  const [showAll, setShowAll] = useState(false);
  const fits = useMemo(() => ROLES.map((ro) => ({ role: ro, score: roleFit(r, ro.id) })).sort((a, b) => b.score - a.score), [r]);
  const set = (patch) => updateRosterPlayer(r.id, patch);
  const togglePos = (l) => set({ positions: r.positions.includes(l) ? r.positions.filter((x) => x !== l) : [...r.positions, l] });
  const color = 'var(--accent)';
  return html`<div class="redit">
    <div class="grid-3">
      <div class="field"><label class="field-label" for=${'rn-' + r.id}>Name</label><${TextInput} id=${'rn-' + r.id} value=${r.name} onCommit=${(v) => set({ name: v || 'Player' })} /></div>
      <div class="field"><label class="field-label" for=${'rno-' + r.id}>Number</label>
        <input id=${'rno-' + r.id} class="input tnum" type="number" min="1" max="99" value=${r.number} onChange=${(e) => set({ number: Math.max(1, Math.min(99, +e.currentTarget.value || 1)) })} /></div>
      <div class="field"><span class="field-label">Foot</span>
        <${Seg} size="sm" label="Preferred foot" value=${r.foot} onChange=${(v) => set({ foot: v })} options=${[{ value: 'L', label: 'L' }, { value: 'R', label: 'R' }, { value: 'B', label: 'Both' }]} /></div>
    </div>
    <div class="field"><span class="field-label">Preferred positions</span>
      <div class="chips selectable">${POSITIONS.map(([l]) => html`<button type="button" class=${cx('chip', r.positions.includes(l) && 'on')} aria-pressed=${String(r.positions.includes(l))} onClick=${() => togglePos(l)}>${l}</button>`)}</div>
    </div>
    <div class="profile-grid">
      <div class="attr-list">
        ${ATTRS.map((a) => html`<div class="attr">
          <span class="attr-name">${a.name}</span>
          <${Dots} label=${a.name} value=${r.attrs[a.id] ?? 3} onChange=${(v) => set({ attrs: { ...r.attrs, [a.id]: v } })} />
        </div>`)}
      </div>
      <div class="radar-wrap"><${Radar} attrs=${r.attrs} color=${color} /></div>
    </div>
    <div class="field">
      <span class="field-label">Role fit</span>
      <ul class="fits">
        ${(showAll ? fits : fits.slice(0, 3)).map((f, i) => html`<li class=${cx(i < 3 && 'top')}>
          <span>${f.role.name}</span>
          <span class="fit-bar"><span style=${`transform:scaleX(${f.score / 100})`} class=${f.score >= 70 ? 'good' : f.score >= 55 ? 'ok' : 'bad'}></span></span>
          <span class="tnum fit-num">${f.score}</span>
        </li>`)}
      </ul>
      <button type="button" class="link-btn" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Show top 3' : `Show all ${ROLES.length} roles`}</button>
    </div>
    <${Toggle} id=${'ra-' + r.id} label="Available for selection" checked=${r.available !== false} onChange=${(v) => set({ available: v })} />
    <div class="field"><label class="field-label" for=${'rnotes-' + r.id}>Notes</label><${TextInput} id=${'rnotes-' + r.id} multiline rows=${2} maxLength=${280} value=${r.notes} onCommit=${(v) => set({ notes: v })} /></div>
    <div class="row end"><${ConfirmBtn} label="Remove from squad" confirm="Remove" onConfirm=${() => deleteRosterPlayer(r.id)} /></div>
  </div>`;
}

function Lineup() {
  const plan = useStore(activePlan);
  const roster = useStore((s) => s.doc.roster);
  const team = plan.teams.home;
  const slots = team.players.map((p) => ({ label: p.label, role: p.role }));
  const best = () => {
    const { lineup } = suggestLineup(slots, roster);
    applyLineup(lineup);
  };
  return html`<div class="stack-s">
    <div class="row between"><span class="muted small">${team.name} · ${team.formation}</span><${Btn} size="sm" variant="primary" icon="sparkle" disabled=${!roster.length} onClick=${best}>Pick best XI<//></div>
    <ul class="lineup">
      ${team.players.map((p) => {
        const r = roster.find((q) => q.id === p.rosterId);
        const fit = r ? slotFit(r, p) : null;
        return html`<li>
          <span class="slot-label">${p.label}</span>
          <span class="slot-role">${ROLE_BY_ID[p.role]?.short}</span>
          <select class="input grow" value=${p.rosterId || ''} aria-label=${`Player for ${p.label}`} onChange=${(e) => assignRoster(p.id, e.currentTarget.value || null)}>
            <option value="">—</option>
            ${roster.map((q) => html`<option value=${q.id} disabled=${q.available === false}>#${q.number} ${q.name} · ${slotFit(q, p)}</option>`)}
          </select>
          ${fit != null ? html`<${FitChip} fit=${fit} />` : html`<span class="fit fit-none">–</span>`}
        </li>`;
      })}
    </ul>
    <p class="muted small">Numbers next to each name are their fit for that spot. Spots under ${FIT_LOW} get a warning on the pitch.</p>
  </div>`;
}

function SystemFit() {
  const roster = useStore((s) => s.doc.roster);
  const customs = useStore((s) => s.doc.customFormations);
  const plan = useStore(activePlan);
  const [open, setOpen] = useState(null);
  const results = useMemo(() => {
    const cands = [
      ...FORMATIONS.map((f) => ({ ...f, title: f.name, kind: 'Formation' })),
      ...customs.map((f) => ({ ...f, title: f.name, kind: 'Saved shape' })),
      ...SYSTEMS.map((s) => ({ ...s, kind: s.shape })),
    ];
    return squadSystemFit(roster, cands);
  }, [roster, customs]);
  if (roster.length < 11) return html`<${Empty} icon="users" title="Add at least 11 players">System fit compares your squad's attributes against every formation and famous system.<//>`;
  return html`<div class="stack-s">
    <p class="muted small">How well your squad's attributes suit each system, picking the best player for every role.</p>
    <ol class="sysfit">
      ${results.slice(0, 10).map((r, i) => {
        const isOpen = open === r.id;
        return html`<li class=${cx(isOpen && 'open')} style=${`animation-delay:${i * 40}ms`}>
          <button type="button" class="sysfit-head" aria-expanded=${String(isOpen)} onClick=${() => setOpen(isOpen ? null : r.id)}>
            <span class="rank tnum">${i + 1}</span>
            <span class="sysfit-name"><strong>${r.candidate.title}</strong><small>${r.candidate.kind}${r.gaps.length ? ` · ${r.gaps.length} weak spot${r.gaps.length > 1 ? 's' : ''}` : ' · No weak spots'}</small></span>
            <span class="score-ring" style=${`--p:${r.average}`}><span class="tnum">${r.average}</span></span>
          </button>
          ${isOpen ? html`<div class="sysfit-body">
            <div class="row gap-m">
              <${MiniShape} slots=${r.candidate.slots} />
              <ul class="lineup compact">
                ${r.lineup.map((l) => html`<li><span class="slot-label">${l.label}</span><span class="grow">${l.player ? l.player.name : '—'}</span><span class="slot-role">${ROLE_BY_ID[l.role]?.short}</span><${FitChip} fit=${l.fit} /></li>`)}
              </ul>
            </div>
            ${r.gaps.length ? html`<p class="warn-line"><${Icon} name="alert" size=${14} />Weak spots: ${r.gaps.map((g) => `${g.label} (${ROLE_BY_ID[g.role]?.name.toLowerCase()})`).join(', ')}.</p>` : null}
            <${Btn} size="sm" variant="primary" icon="layers" onClick=${() => applyLineup(r.lineup, r.id)}>Use this system and lineup<//>
          </div>` : null}
        </li>`;
      })}
    </ol>
  </div>`;
}
