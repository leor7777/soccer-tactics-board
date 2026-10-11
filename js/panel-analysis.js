import { html, useState, useMemo } from './lib.js';
import { useStore, activePlan, activePlay, setUI, setPrefs, boardPositions, timelineFor, shapeFor } from './store.js';
import { FORMATIONS, PROFILES } from './data.js';
import { SYSTEMS } from './systems.js';
import { matchupReport, slotsToPoints, shadesOf } from './analysis.js';
import { THIRD_NAMES, CHANNEL_NAMES } from './geometry.js';
import { Icon } from './icons.js';
import { Section, Seg, Toggle, CountUp, cx, showColor } from './ui.js';

const TONE_ICON = { good: 'check', risk: 'alert', info: 'target' };

export function AnalysisPanel() {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const prefs = useStore((s) => s.prefs);
  const step = useStore((s) => s.ui.step);
  const highlight = useStore((s) => s.ui.highlight);
  const customs = useStore((s) => s.doc.customFormations);
  const [source, setSource] = useState('live');
  const [mine, setMine] = useState(plan.teams.home.formation);
  const [theirs, setTheirs] = useState(plan.teams.away.formation);

  const options = [
    ...FORMATIONS.map((f) => ({ id: f.id, name: f.name })),
    ...customs.map((f) => ({ id: f.id, name: f.name })),
    ...SYSTEMS.map((f) => ({ id: f.id, name: f.title })),
  ];

  const report = useMemo(() => {
    if (source === 'live') {
      const pos = play ? timelineFor(plan, play, 2.6).states[step]?.pos || play.start.pos : boardPositions(plan);
      const pts = (side) => plan.teams[side].players.map((p) => ({ ...pos[p.id], label: p.label, role: p.role, gk: p.gk, id: p.id }));
      return matchupReport(pts('home'), pts('away'), { includeGK: prefs.includeGK });
    }
    const a = shapeFor(mine), b = shapeFor(theirs);
    if (!a || !b) return null;
    return matchupReport(slotsToPoints(a.slots, 'home'), slotsToPoints(b.slots, 'away'), { includeGK: prefs.includeGK });
  }, [source, plan, play, step, mine, theirs, prefs.includeGK]);

  const s = report?.summary;
  const rows = s ? [['Width', s.width], ['Midfield', s.midfield], ['Central lanes', s.central], ['Your front line', s.front], ['Your back line', s.back]] : [];
  const home = plan.teams.home, away = plan.teams.away;
  const focus = (f) => setUI({ highlight: f ? { zones: f.zones, key: f.title } : null });

  return html`<div class="panel-body">
    <${Section} title="Zone overlay">
      <${Toggle} id="an-zones" label="Show zones on the pitch" hint="15 zones: thirds × wings, half-spaces and center" checked=${prefs.zones} onChange=${(v) => setPrefs({ zones: v })} />
      <${Toggle} id="an-gk" label="Count goalkeepers" checked=${prefs.includeGK} onChange=${(v) => setPrefs({ includeGK: v })} />
      <div class="legend-row">
        <span><i class="lg good"></i>${home.name} outnumber</span>
        <span><i class="lg bad"></i>${away.name} outnumber</span>
        <span><i class="lg even"></i>Even</span>
      </div>
    <//>

    <${Section} title="Matchup report">
      <${Seg} size="sm" label="Analyze" value=${source} onChange=${setSource}
        options=${[{ value: 'live', label: play ? `Step ${step + 1} on the board` : 'Board as it is' }, { value: 'shapes', label: 'Compare shapes' }]} />
      ${source === 'shapes' ? html`<div class="grid-2">
        <div class="field"><label class="field-label" for="an-mine">${home.name}</label>
          <select id="an-mine" class="input" value=${mine} onChange=${(e) => setMine(e.currentTarget.value)}>${options.map((o) => html`<option value=${o.id}>${o.name}</option>`)}</select></div>
        <div class="field"><label class="field-label" for="an-theirs">${away.name}</label>
          <select id="an-theirs" class="input" value=${theirs} onChange=${(e) => setTheirs(e.currentTarget.value)}>${options.map((o) => html`<option value=${o.id}>${o.name}</option>`)}</select></div>
      </div>` : null}

      <div class="vs-table">
        <div class="vs-head"><span style=${{ color: 'var(--fg-2)' }}></span><span class="vs-team"><i style=${{ background: home.primary }}></i>${home.name}</span><span class="vs-team right">${away.name}<i style=${{ background: away.primary }}></i></span></div>
        ${rows.map(([label, p]) => {
          const total = Math.max(1, p.home + p.away);
          const tone = p.home > p.away ? 'good' : p.home < p.away ? 'bad' : 'even';
          return html`<button type="button" class=${cx('vs-row', highlight?.key === label && 'on')} onMouseEnter=${() => focus({ zones: p.zones, title: label })} onMouseLeave=${() => focus(null)}
            onFocus=${() => focus({ zones: p.zones, title: label })} onBlur=${() => focus(null)} onClick=${() => focus({ zones: p.zones, title: label })}>
            <span class="vs-label">${label}</span>
            <span class=${'vs-score tone-' + tone}><${CountUp} value=${p.home} /><em>v</em><${CountUp} value=${p.away} /></span>
            <span class="vs-bar"><span class="h" style=${`transform:scaleX(${p.home / total});background:${home.primary}`}></span><span class="a" style=${`transform:scaleX(${p.away / total});background:${away.primary}`}></span></span>
          </button>`;
        })}
      </div>

      <ul class="findings">
        ${(report?.findings || []).map((f, i) => html`<li style=${`animation-delay:${i * 45}ms`}>
          <button type="button" class=${cx('finding', 'tone-' + f.tone, highlight?.key === f.title && 'on')}
            onMouseEnter=${() => focus(f)} onMouseLeave=${() => focus(null)} onFocus=${() => focus(f)} onBlur=${() => focus(null)}
            onClick=${() => focus(highlight?.key === f.title ? null : f)}>
            <span class="finding-ic"><${Icon} name=${TONE_ICON[f.tone]} size=${16} /></span>
            <span><strong>${f.title}</strong><span>${f.text}</span></span>
          </button>
        </li>`)}
      </ul>
      <p class="muted small">Tap a finding to spotlight its zones and players on the pitch.</p>
    <//>

    <${ZoneTable} zones=${report?.zones} />
    <${Profiles} homeId=${source === 'shapes' ? mine : home.formation} awayId=${source === 'shapes' ? theirs : away.formation} />
  </div>`;
}

function ZoneTable({ zones }) {
  if (!zones) return null;
  return html`<${Section} title="Zone counts">
    <div class="ztable" role="table" aria-label="Players per zone, your team versus opponent">
      <div class="zt-row zt-head" role="row"><span role="columnheader"></span>${CHANNEL_NAMES.map((c) => html`<span role="columnheader">${c.replace('half-space', 'HS').replace('right ', 'R ').replace('left ', 'L ')}</span>`)}</div>
      ${[2, 1, 0].map((t) => html`<div class="zt-row" role="row">
        <span role="rowheader">${THIRD_NAMES[t].replace(' third', '')}</span>
        ${[0, 1, 2, 3, 4].map((c) => {
          const z = zones[t * 5 + c];
          return html`<span role="cell" class=${'zt-cell ' + (z.diff > 0 ? 'good' : z.diff < 0 ? 'bad' : 'even')}>${z.home}–${z.away}</span>`;
        })}
      </div>`)}
    </div>
  <//>`;
}

function Profiles({ homeId, awayId }) {
  const card = (id, who) => {
    const f = shapeFor(id);
    if (!f) return null;
    const prof = PROFILES[id];
    const sys = SYSTEMS.find((x) => x.id === id);
    const shade = !prof && !sys ? shadesOf(slotsToPoints(f.slots, 'home'), SYSTEMS, 'home', 1)[0] : null;
    const base = prof || (sys ? PROFILES[sys.family] : shade ? PROFILES[shade.system.family] : null);
    return html`<article class="profile">
      <header><small>${who}</small><strong>${sys ? sys.title : f.name}</strong></header>
      ${sys ? html`<p>${sys.summary}</p>
        <h4>Principles</h4><ul class="bullets">${sys.principles.map((x) => html`<li>${x}</li>`)}</ul>` : null}
      ${shade ? html`<p class="muted">Custom shape, closest to ${shade.system.name} (${shade.similarity}%).</p>` : null}
      ${base ? html`${!sys ? html`<p>${base.summary}</p>` : null}
        <h4 class="good-h">Strengths</h4><ul class="bullets">${base.strengths.map((x) => html`<li>${x}</li>`)}</ul>
        <h4 class="bad-h">Weaknesses</h4><ul class="bullets">${base.weaknesses.map((x) => html`<li>${x}</li>`)}</ul>
        <h4>Works well against</h4><ul class="bullets">${base.suits.map((x) => html`<li>${x}</li>`)}</ul>` : null}
    </article>`;
  };
  // Famous systems inherit the strengths and weaknesses of their base formation.
  return html`<${Section} title="Formation profiles">
    ${card(homeId, 'Your shape')}
    ${card(awayId, 'Their shape')}
  <//>`;
}
