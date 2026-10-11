import { html, render, useEffect, useState, useMemo } from './lib.js';
import {
  init, useStore, getState, activePlan, activePlay, setUI, setPrefs, undo, redo, deleteSelection, timelineFor,
  boardPositions, toast, resetPositions, clearStep, clearPlay, resetView, resetWorkspace, isSetPiece, shapeFor, activeTeam,
} from './store.js';
import { usePB, toggle as togglePlay, jump, stop as stopPlayback, play as startPlay, restart } from './player.js';
import { Pitch } from './pitch.js';
import { StepBar } from './stepbar.js';
import { Inspector } from './inspector.js';
import { TeamPanel } from './panel-team.js';
import { PlaysPanel } from './panel-plays.js';
import { SetPiecesPanel } from './panel-setpieces.js';
import { AnalysisPanel } from './panel-analysis.js';
import { SquadPanel } from './panel-squad.js';
import { ScoutPanel } from './panel-scout.js';
import { PlansPanel } from './panel-plans.js';
import { TeamsPanel } from './panel-teams.js';
import { exportBoardPNG } from './export.js';
import { ACTIONS, PITCH_THEMES } from './data.js';
import { SYSTEMS } from './systems.js';
import { shadesOf } from './analysis.js';
import { Icon } from './icons.js';
import { sfx, configure as configureAudio, unlock as unlockAudio } from './audio.js';
import { IconBtn, Seg, Toggle, cx } from './ui.js';

const PANELS = [
  { id: 'team', label: 'Team', icon: 'shirt', C: TeamPanel },
  { id: 'plays', label: 'Plays', icon: 'list', C: PlaysPanel },
  { id: 'setpieces', label: 'Set pieces', icon: 'flag', C: SetPiecesPanel },
  { id: 'scout', label: 'Opponent', icon: 'scout', C: ScoutPanel },
  { id: 'squad', label: 'Squad', icon: 'users', C: SquadPanel },
  { id: 'analysis', label: 'Analysis', icon: 'chart', C: AnalysisPanel },
];

// Close a popover on Escape or a click outside it.
function useDismiss(close, selector) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onDown = (e) => { if (!e.target.closest(selector)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, []);
}

function TopBar() {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const saveState = useStore((s) => s.saveState);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const ui = useStore((s) => s.ui);
  return html`<header class="topbar">
    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="2.5" y="6.5" width="27" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2" />
        <line x1="16" y1="6.5" x2="16" y2="25.5" stroke="currentColor" stroke-width="2" />
        <circle cx="16" cy="16" r="3.6" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M6 20.5 Q11 9 21 12" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" />
        <path d="M18.6 9.8l3.4 2.4-3 2.6" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="brand-name">Tactics Board</span>
    </div>
    <${TeamSwitch} />
    <button type="button" class="plan-switch" onClick=${() => setUI({ plansOpen: true })} aria-label="Game plans and files">
      <span class="plan-switch-kits"><i style=${{ background: plan.teams.home.primary }}></i><i style=${{ background: plan.teams.away.primary }}></i></span>
      <span class="plan-switch-name">${plan.name}</span>
      <${Icon} name="chevronDown" size=${16} />
    </button>
    ${play ? html`<span class="play-chip"><span class="dot"></span>${isSetPiece(play) ? 'Set piece · ' : ''}${play.name}</span>` : null}
    <div class="topbar-right">
      <span class=${'save-state ' + saveState} title=${saveState === 'saved' ? 'All changes saved in this browser' : saveState === 'error' ? 'Could not save. Export your plan to keep it.' : 'Saving'}>
        <i></i><span>${saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : 'Saving'}</span>
      </span>
      <${IconBtn} icon="undo" label="Undo" kbd="⌘Z" disabled=${!canUndo} onClick=${undo} />
      <${IconBtn} icon="redo" label="Redo" kbd="⇧⌘Z" disabled=${!canRedo} onClick=${redo} />
      <div class="menu-anchor reset-anchor">
        <button type="button" class=${cx('btn btn-ghost reset-btn', ui.resetMenu && 'on')} onClick=${() => setUI({ resetMenu: !ui.resetMenu, viewMenu: false })} aria-expanded=${String(ui.resetMenu)}>
          <${Icon} name="restart" size=${17} /><span>Reset</span>
        </button>
        ${ui.resetMenu ? html`<${ResetMenu} />` : null}
      </div>
      <div class="menu-anchor view-anchor">
        <${IconBtn} icon="sliders" label="View and playback" active=${ui.viewMenu} onClick=${() => setUI({ viewMenu: !ui.viewMenu, resetMenu: false })} />
        ${ui.viewMenu ? html`<${ViewMenu} />` : null}
      </div>
      <${SoundBtn} />
      <${IconBtn} icon="help" label="How it works" class="hide-sm" onClick=${() => setUI({ guide: true })} />
      <button type="button" class="btn btn-primary present-btn" onClick=${() => { stopPlayback(); unlockAudio(); setUI({ present: true, sel: null, viewMenu: false, resetMenu: false }); }}>
        <${Icon} name="present" size=${18} /><span>Present</span>
      </button>
      <${IconBtn} icon="panel" label="Panel" class="drawer-btn" active=${ui.drawer} onClick=${() => setUI({ drawer: !ui.drawer })} />
    </div>
  </header>`;
}

function TeamSwitch() {
  const team = useStore(activeTeam);
  const count = useStore((s) => s.club?.teams.length || 1);
  if (!team) return null;
  return html`<button type="button" class="team-switcher" onClick=${() => setUI({ teamsOpen: true })} aria-label=${`Team: ${team.name}. Change team`}>
    <span class="ts-badge" style=${{ background: `linear-gradient(135deg, ${team.primary} 0 56%, ${team.secondary} 56%)` }}></span>
    <span class="ts-text"><small>${count > 1 ? `Team · ${count}` : 'Team'}</small><strong>${team.name}</strong></span>
    <${Icon} name="chevronDown" size=${15} />
  </button>`;
}

function SoundBtn() {
  const on = useStore((s) => s.prefs.sound);
  return html`<${IconBtn} icon=${on ? 'sound' : 'mute'} label=${on ? 'Sound on' : 'Sound off'} active=${on}
    onClick=${() => { setPrefs({ sound: !on }); if (!on) { unlockAudio(); configureAudio({ on: true }); sfx.touch(); } }} />`;
}

function ResetMenu() {
  const play = useStore(activePlay);
  const step = useStore((s) => s.ui.step);
  const [confirm, setConfirm] = useState(false);
  const close = () => setUI({ resetMenu: false });
  useDismiss(close, '.reset-anchor');
  const item = (icon, title, sub, fn, cls = '') => html`<button type="button" class=${'reset-item ' + cls} onClick=${() => { stopPlayback(); fn(); close(); }}>
    <span class="ri-ic"><${Icon} name=${icon} size=${18} /></span><span><strong>${title}</strong><small>${sub}</small></span>
  </button>`;
  return html`<div class="pop reset-menu" role="menu" aria-label="Reset">
    ${item('users', 'Reset player positions', play ? (isSetPiece(play) ? 'Put everyone back on their set-piece spots' : 'Both teams back to their formation at the start of this play') : 'Both teams back to their formation spots', resetPositions)}
    ${play ? item('pen', `Clear step ${step + 1}`, 'Remove every arrow in this step', clearStep) : null}
    ${play ? item('trash', 'Clear the whole play', 'Keep the players, remove all steps and arrows', clearPlay) : null}
    ${item('sliders', 'Reset view settings', 'Pitch look, orientation, labels and playback options', resetView)}
    <div class="reset-sep"></div>
    ${confirm
      ? html`<div class="reset-confirm"><span>Erase every team, plan, squad player, opponent and set piece in this browser?</span>
          <div class="row gap-s"><button type="button" class="btn btn-danger btn-sm" onClick=${() => { resetWorkspace(); close(); toast('Started over with the examples.'); }}>Erase and start over</button>
          <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setConfirm(false)}>Cancel</button></div></div>`
      : html`<button type="button" class="reset-item danger" onClick=${() => setConfirm(true)}>
          <span class="ri-ic"><${Icon} name="alert" size=${18} /></span><span><strong>Start over</strong><small>Erase every team and reload the examples</small></span>
        </button>`}
    <p class="reset-note">Everything except "Start over" can be undone with ⌘Z.</p>
  </div>`;
}

function ViewMenu() {
  const p = useStore((s) => s.prefs);
  useDismiss(() => setUI({ viewMenu: false }), '.view-anchor');
  return html`<div class="pop view-menu" role="dialog" aria-label="View and playback options">
    <div class="pop-section">
      <span class="pop-label">Pitch</span>
      <div class="theme-swatches">
        ${Object.entries(PITCH_THEMES).map(([id, t]) => html`<button type="button" class=${cx('theme-sw', p.pitchTheme === id && 'on')} onClick=${() => setPrefs({ pitchTheme: id })} aria-pressed=${String(p.pitchTheme === id)}>
          <span style=${{ background: `repeating-linear-gradient(90deg, ${t.stripeA} 0 8px, ${t.stripeB} 8px 16px)`, borderColor: t.line }}><i style=${{ background: t.actions.pass }}></i></span>
          <small>${t.name}</small>
        </button>`)}
      </div>
    </div>
    <div class="pop-grid">
      <span class="pop-label">Playback</span>
      <${Seg} size="sm" label="Playback style" value=${p.playStyle} onChange=${(v) => setPrefs({ playStyle: v })} options=${[{ value: 'flow', label: 'Flow', title: 'Continuous movement from step to step' }, { value: 'coach', label: 'Coach', title: 'Pause, show the arrows, then move' }]} />
      <span class="pop-label">Camera</span>
      <${Seg} size="sm" label="Camera" value=${p.camera} onChange=${(v) => setPrefs({ camera: v })} options=${[{ value: 'follow', label: 'Follow the ball' }, { value: 'off', label: 'Fixed' }]} />
      <span class="pop-label">Orientation</span>
      <${Seg} size="sm" label="Orientation" value=${p.orient} onChange=${(v) => setPrefs({ orient: v })} options=${[{ value: 'auto', label: 'Auto' }, { value: 'h', label: 'Wide' }, { value: 'v', label: 'Tall' }]} />
      <span class="pop-label">Show</span>
      <${Seg} size="sm" label="Pitch area" value=${p.area} onChange=${(v) => setPrefs({ area: v })} options=${[{ value: 'full', label: 'Full' }, { value: 'attack', label: 'Attack half' }, { value: 'defend', label: 'Defend half' }]} />
      <span class="pop-label">Players</span>
      <${Seg} size="sm" label="Token size" value=${p.tokenSize} onChange=${(v) => setPrefs({ tokenSize: v })} options=${[{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }]} />
      <span class="pop-label">Labels</span>
      <${Seg} size="sm" label="Labels" value=${p.labels} onChange=${(v) => setPrefs({ labels: v })} options=${[{ value: 'name', label: 'Name' }, { value: 'pos', label: 'Position' }, { value: 'both', label: 'Both' }, { value: 'none', label: 'None' }]} />
      <span class="pop-label">Line color</span>
      <${Seg} size="sm" label="Line color" value=${p.lineColor} onChange=${(v) => setPrefs({ lineColor: v })} options=${[{ value: 'action', label: 'By action' }, { value: 'team', label: 'By team' }]} />
      <span class="pop-label">App</span>
      <${Seg} size="sm" label="App theme" value=${p.appTheme} onChange=${(v) => setPrefs({ appTheme: v })} options=${[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Daylight' }]} />
    </div>
    <div class="pop-section">
      <span class="pop-label">Defense AI</span>
      <div class="pop-grid">
        <span class="pop-label">Reacts</span>
        <${Seg} size="sm" label="Auto defense" value=${p.autoDefense} onChange=${(v) => setPrefs({ autoDefense: v })} options=${[{ value: 'both', label: 'Both teams' }, { value: 'opponent', label: 'Opponent' }, { value: 'off', label: 'Off' }]} />
        <span class="pop-label">Block</span>
        <${Seg} size="sm" label="Defensive block" value=${p.defBlock} onChange=${(v) => setPrefs({ defBlock: v })} options=${[{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High' }]} />
        <span class="pop-label">Pressing</span>
        <${Seg} size="sm" label="Pressing" value=${p.defPress} onChange=${(v) => setPrefs({ defPress: v })} options=${[{ value: 'passive', label: 'Passive' }, { value: 'balanced', label: 'Balanced' }, { value: 'aggressive', label: 'Aggressive' }]} />
        <span class="pop-label">Quality</span>
        <${Seg} size="sm" label="Defense quality" value=${p.defQuality} onChange=${(v) => setPrefs({ defQuality: v })} options=${[{ value: 'sharp', label: 'Sharp', title: 'Well drilled: few mistakes, little space' }, { value: 'realistic', label: 'Realistic', title: 'Late reactions and the odd lost runner' }, { value: 'sloppy', label: 'Sloppy', title: 'Slow, disorganized, lots of space' }]} />
      </div>
      <${Toggle} id="vm-space" label="Space map" hint="Shade the area each team reaches first" checked=${p.spaceMap} onChange=${(v) => setPrefs({ spaceMap: v })} />
      <${Toggle} id="vm-auto" label="Show defensive reactions" hint="Faint arrows for automatic movement" checked=${p.showAuto} onChange=${(v) => setPrefs({ showAuto: v })} />
    </div>
    <div class="pop-section">
      <span class="pop-label">Sound</span>
      <${Toggle} id="vm-sound" label="Sound effects" hint="Passes, first touches, the net and the crowd" checked=${p.sound} onChange=${(v) => setPrefs({ sound: v })} />
      <div class="row gap-s vol-row">
        <${Icon} name="mute" size=${16} />
        <input type="range" class="range grow" min="0" max="1" step="0.05" value=${p.volume} aria-label="Volume" disabled=${!p.sound}
          onInput=${(e) => setPrefs({ volume: +e.currentTarget.value })} onChange=${() => { unlockAudio(); sfx.kick('ground'); }} />
        <${Icon} name="sound" size=${16} />
      </div>
    </div>
    <div class="pop-toggles">
      <${Toggle} id="vm-fx" label="Impact effects" hint="Kick rings, goal burst, camera shake" checked=${p.fx} onChange=${(v) => setPrefs({ fx: v })} />
      <${Toggle} id="vm-slow" label="Slow motion on shots" checked=${p.slowmo} onChange=${(v) => setPrefs({ slowmo: v })} />
      <${Toggle} id="vm-trail" label="Motion trails" hint="Ball trail and player streaks" checked=${p.trail} onChange=${(v) => setPrefs({ trail: v })} />
      <${Toggle} id="vm-draw" label="Draw arrows in during playback" checked=${p.drawOn} onChange=${(v) => setPrefs({ drawOn: v })} />
      <${Toggle} id="vm-shape" label="Team shape lines" hint="Connect each team's defense, midfield and attack" checked=${p.shapeLines} onChange=${(v) => setPrefs({ shapeLines: v })} />
      <${Toggle} id="vm-flip" label="Flip attacking direction" checked=${p.flip} onChange=${(v) => setPrefs({ flip: v })} />
      <${Toggle} id="vm-away" label="Show opponent" checked=${p.showAway} onChange=${(v) => setPrefs({ showAway: v })} />
      <${Toggle} id="vm-zones" label="Zone overlay" checked=${p.zones} onChange=${(v) => setPrefs({ zones: v })} />
      <${Toggle} id="vm-ghost" label="Ghost of previous step" checked=${p.ghost} onChange=${(v) => setPrefs({ ghost: v })} />
      <${Toggle} id="vm-shades" label='"Shades of" badge' checked=${p.shades} onChange=${(v) => setPrefs({ shades: v })} />
      <${Toggle} id="vm-sticky" label="Keep tool after drawing" checked=${p.stickyTool} onChange=${(v) => setPrefs({ stickyTool: v })} />
    </div>
  </div>`;
}

function Rail() {
  const tool = useStore((s) => s.ui.tool);
  const prefs = useStore((s) => s.prefs);
  return html`<nav class="rail" aria-label="Tools">
    <div class="rail-group" role="toolbar" aria-label="Drawing tools">
      ${ACTIONS.map((a) => html`<button type="button" class=${cx('tool', 'tool-' + a.id, tool === a.id && 'on')} aria-pressed=${String(tool === a.id)}
        onClick=${() => setUI({ tool: a.id })} aria-label=${a.name} data-tip=${`${a.hint} (${a.key})`}>
        <${Icon} name=${a.id} size=${21} />
        <span class="tool-name">${a.id === 'press' ? 'Press' : a.name}</span>
      </button>`)}
    </div>
    <div class="rail-sep"></div>
    <div class="rail-group" role="toolbar" aria-label="Quick view">
      <${IconBtn} icon="zones" label="Zones" kbd="Z" active=${prefs.zones} onClick=${() => setPrefs({ zones: !prefs.zones })} />
      <${IconBtn} icon="ghost" label="Ghost trail" kbd="G" active=${prefs.ghost} onClick=${() => setPrefs({ ghost: !prefs.ghost })} />
      <${IconBtn} icon="flip" label="Flip direction" kbd="F" active=${prefs.flip} onClick=${() => setPrefs({ flip: !prefs.flip })} />
      <${IconBtn} icon="half" label="Half pitch" kbd="H" active=${prefs.area !== 'full'} onClick=${() => setPrefs({ area: prefs.area === 'full' ? 'attack' : 'full' })} />
      <${IconBtn} icon="space" label="Space map" kbd="X" active=${prefs.spaceMap} onClick=${() => setPrefs({ spaceMap: !prefs.spaceMap })} />
      <${IconBtn} icon="shield" label=${prefs.autoDefense === 'off' ? 'Auto defense is off' : 'Auto defense is on'} kbd="A" active=${prefs.autoDefense !== 'off'}
        onClick=${() => { const on = prefs.autoDefense === 'off'; setPrefs({ autoDefense: on ? 'both' : 'off' }); toast(on ? 'Auto defense on: the team without the ball reacts to every step.' : 'Auto defense off: defenders only move where you tell them.'); }} />
    </div>
  </nav>`;
}

function ShadesBadge() {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const step = useStore((s) => s.ui.step);
  const on = useStore((s) => s.prefs.shades);
  const playing = useStore((s) => s.ui.playing);
  const best = useMemo(() => {
    if (!on || isSetPiece(play)) return null;
    const pos = play ? timelineFor(plan, play, 2.6).states[step]?.pos || play.start.pos : boardPositions(plan);
    const pts = plan.teams.home.players.map((p) => ({ ...pos[p.id], gk: p.gk, role: p.role }));
    const top = shadesOf(pts, SYSTEMS, 'home', 1)[0];
    return top && top.similarity >= 70 ? top : null;
  }, [on, plan, play, step]);
  if (!best || playing) return null;
  return html`<button type="button" key=${best.system.id} class="shades-badge" onClick=${() => setUI({ panel: 'team', teamSide: 'home', drawer: true })}>
    <span class="sb-eyebrow">Shades of</span>
    <span class="sb-name">${best.system.name}</span>
    <span class="sb-era">${best.system.era}</span>
    <span class="sb-pct tnum">${best.similarity}%</span>
  </button>`;
}

// Broadcast-style graphic when a formation is applied.
function FormationStamp() {
  const fa = useStore((s) => s.ui.formationAnim);
  const plan = useStore(activePlan);
  useEffect(() => { if (fa && Date.now() - fa.at < 400 && getState().prefs.sound) sfx.whoosh(); }, [fa?.at]);
  if (!fa || Date.now() - fa.at > 1800) return null;
  const team = plan.teams[fa.side];
  return html`<div class="stamp" key=${fa.at} style=${{ '--team': fa.color || 'var(--accent)' }} aria-hidden="true">
    <span class="stamp-bar"></span>
    <span class="stamp-team">${fa.label === 'Reset' ? 'Positions reset' : team.name}</span>
    <span class="stamp-shape">${fa.label}</span>
  </div>`;
}

function Caption() {
  const play = useStore(activePlay);
  const pb = usePB();
  const present = useStore((s) => s.ui.present);
  if (!play || (!pb.active && !present)) return null;
  const k = pb.active ? pb.step : getState().ui.step;
  const st = play.steps[k];
  if (!st) return null;
  return html`<div class="caption-card" key=${k} aria-live="polite">
    <span class="cc-step tnum">${String(k + 1).padStart(2, '0')}<small>/${String(play.steps.length).padStart(2, '0')}</small></span>
    <span class="cc-text">${st.caption || `Step ${k + 1}`}</span>
  </div>`;
}

function Flood() {
  const flood = useStore((s) => s.ui.flood);
  if (!flood || Date.now() - flood.at > 1200) return null;
  return html`<div class="flood" key=${flood.at} style=${{ '--flood': flood.color }} aria-hidden="true"></div>`;
}

function Toast() {
  const t = useStore((s) => s.ui.toast);
  return html`<div class="toast-region" aria-live="polite">${t ? html`<div class=${'toast tone-' + t.tone} key=${t.id}>${t.text}</div>` : null}</div>`;
}

function BoardHint() {
  const tool = useStore((s) => s.ui.tool);
  const prefs = useStore((s) => s.prefs);
  const a = ACTIONS.find((x) => x.id === tool);
  if (tool === 'select') return null;
  const ball = tool === 'pass' || tool === 'shot';
  return html`<div class=${'tool-hint' + (ball ? ' with-options' : '')}>
    <div class="th-main"><${Icon} name=${tool} size=${16} /><span><strong>${a.name}.</strong> ${a.hint}</span>
      <button type="button" class="link-btn" onClick=${() => setUI({ tool: 'select' })}>Done</button></div>
    ${ball ? html`<div class="th-options">
      <${Seg} size="sm" label="Ball height" value=${prefs.passHeight} onChange=${(v) => setPrefs({ passHeight: v })}
        options=${tool === 'shot'
          ? [{ value: 'ground', label: 'Placed' }, { value: 'driven', label: 'Driven' }, { value: 'lofted', label: 'Chip' }]
          : [{ value: 'ground', label: 'Ground' }, { value: 'driven', label: 'Driven' }, { value: 'lofted', label: 'Lofted' }]} />
      <${Seg} size="sm" label="Curve" value=${prefs.passBend} onChange=${(v) => setPrefs({ passBend: v })}
        options=${[{ value: -1, icon: 'curveL', title: 'Curve left' }, { value: 0, icon: 'straight', title: 'Straight' }, { value: 1, icon: 'curveR', title: 'Curve right' }]} />
    </div>` : null}
  </div>`;
}

function Panel() {
  const panel = useStore((s) => s.ui.panel);
  const drawer = useStore((s) => s.ui.drawer);
  const P = PANELS.find((p) => p.id === panel) || PANELS[0];
  return html`<aside class=${cx('panel', drawer && 'open')} aria-label="Side panel">
    <${Inspector} docked />
    <div class="tabs" role="tablist">
      ${PANELS.map((p) => html`<button type="button" role="tab" aria-selected=${String(p.id === panel)} class=${cx('tab', p.id === panel && 'on')} onClick=${() => setUI({ panel: p.id })}>
        <${Icon} name=${p.icon} size=${18} /><span>${p.label}</span>
      </button>`)}
      <${IconBtn} icon="x" label="Close panel" class="drawer-close" onClick=${() => setUI({ drawer: false })} />
    </div>
    <div class="panel-scroll" key=${panel}><${P.C} /></div>
  </aside>`;
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`<div class="modal-scrim" onPointerDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label=${title}>
      <header class="modal-head"><h2>${title}</h2><${IconBtn} icon="x" label="Close" onClick=${onClose} /></header>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

const GUIDE = [
  { icon: 'users', title: 'One board for all your teams', text: 'Coach more than one side? Add teams from the switcher at the top left. Each keeps its own squad, plans and set pieces.' },
  { icon: 'shirt', title: 'Set up both teams', text: 'In the Team tab, pick colors and a shape for each side, or browse 60 famous systems. Drag players anywhere.' },
  { icon: 'pass', title: 'Draw a play', text: 'Pick a tool on the left and drag from a player. Arrows in the same step happen together; add steps below the pitch.' },
  { icon: 'play', title: 'Play it back', text: 'Press play for smooth, camera-following playback, or Present to show it full screen to the team.' },
  { icon: 'wand', title: 'Plan for the opponent', text: 'Rate your squad and the opponent, then Optimize formation ranks every shape with a suggested lineup.' },
  { icon: 'shield', title: 'Defenders react', text: 'With auto defense on, the team without the ball shifts, presses and tracks runners every step. Tune it in View options.' },
  { icon: 'flag', title: 'Save set pieces', text: 'Corners, free kicks from any spot, long throws and more, saved once and ready in every game plan.' },
  { icon: 'restart', title: 'Reset any time', text: 'The Reset button puts players back in shape or clears a play. Undo (⌘Z) works for every change.' },
];

function Guide({ onClose }) {
  return html`<${Modal} title="How it works" onClose=${onClose} wide>
    <ol class="guide">
      ${GUIDE.map((g, i) => html`<li style=${`animation-delay:${i * 60}ms`}>
        <span class="guide-num tnum">${i + 1}</span>
        <span class="guide-ic"><${Icon} name=${g.icon} size=${20} /></span>
        <span><strong>${g.title}</strong><span>${g.text}</span></span>
      </li>`)}
    </ol>
    <div class="row end"><button type="button" class="btn btn-primary" onClick=${onClose}>Got it</button></div>
  <//>`;
}

// ---- Present mode ---------------------------------------------------------

const shapeName = (id) => { const f = shapeFor(id); return f ? f.title || f.name : id; };

function PresentOverlay() {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const pb = usePB();
  const [phase, setPhase] = useState('title');
  const go = () => { setPhase('run'); if (play) { setUI({ step: 0 }); startPlay(); } };
  useEffect(() => {
    setPhase('title');
    const t = setTimeout(go, 2300);
    return () => { clearTimeout(t); stopPlayback(); };
  }, [play?.id]);
  const exit = () => { stopPlayback(); setUI({ present: false }); };
  const words = (play ? play.name.replace(/ \(example\)$/, '') : `${plan.teams.home.name} v ${plan.teams.away.name}`).split(/\s+/);
  const lastWord = words.pop();
  const home = plan.teams.home, away = plan.teams.away;
  return html`<div class="present-ui">
    ${phase === 'title' ? html`<div class="title-card" style=${{ '--home': home.primary, '--away': away.primary }} onClick=${go}>
      <div class="tc-wash"></div>
      <div class="tc-inner">
        ${isSetPiece(play) ? html`<span class="tc-eyebrow">Set piece</span>` : null}
        <h1 class="tc-title">
          ${words.map((w, i) => html`<span class="w" style=${`animation-delay:${120 + i * 90}ms`}>${w}</span>`)}
          <span class="w accent" style=${`animation-delay:${120 + words.length * 90}ms`}>${lastWord}</span>
        </h1>
        <span class="tc-sub">
          <i style=${{ background: home.primary, borderColor: home.secondary }}></i>${play ? home.name : shapeName(home.formation)}
          <em>v</em>
          <i style=${{ background: away.primary, borderColor: away.secondary }}></i>${play ? away.name : shapeName(away.formation)}
          ${play ? html`<b>·</b>${play.steps.length} steps` : null}
        </span>
      </div>
    </div>` : null}
    <div class="present-controls">
      ${play ? html`
        <${IconBtn} icon="restart" label="Restart" onClick=${restart} />
        <${IconBtn} icon="prev" label="Previous step" onClick=${() => jump(-1)} />
        <button type="button" class="play-btn on" onClick=${togglePlay} aria-label=${pb.playing ? 'Pause' : 'Play'}><${Icon} name=${pb.playing ? 'pause' : 'play'} size=${22} /></button>
        <${IconBtn} icon="next" label="Next step" onClick=${() => jump(1)} />
        <span class="pc-dots">${play.steps.map((_, i) => html`<i class=${cx(i === pb.step && 'on', i < pb.step && 'done')}></i>`)}</span>` : null}
      <button type="button" class="btn btn-ghost" onClick=${exit}><${Icon} name="x" size=${18} /><span>Exit</span></button>
    </div>
  </div>`;
}

// ---- Root -------------------------------------------------------------------

const GUIDE_KEY = 'stb-guide-seen';

function App() {
  const ready = useStore((s) => s.ready);
  const present = useStore((s) => s.ui.present);
  const drawer = useStore((s) => s.ui.drawer);
  const guide = useStore((s) => s.ui.guide);
  const plansOpen = useStore((s) => s.ui.plansOpen);
  const teamsOpen = useStore((s) => s.ui.teamsOpen);
  const appTheme = useStore((s) => s.prefs.appTheme);

  const sound = useStore((s) => s.prefs.sound);
  const volume = useStore((s) => s.prefs.volume);
  useEffect(() => { configureAudio({ on: sound, vol: volume }); }, [sound, volume]);
  useEffect(() => {
    const root = document.documentElement;
    if (appTheme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', appTheme);
  }, [appTheme]);

  // Show the guide once on a first visit.
  useEffect(() => {
    if (!ready) return;
    try { if (!localStorage.getItem(GUIDE_KEY)) setUI({ guide: true }); } catch { /* storage blocked: skip */ }
  }, [ready]);
  const closeGuide = () => { try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* ignore */ } setUI({ guide: false }); };

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
      const s = getState();
      if (s.ui.guide || s.ui.plansOpen || s.ui.teamsOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.key === ' ') { e.preventDefault(); if (activePlay(s)) togglePlay(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); jump(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-1); return; }
      if (e.key === 'Escape') {
        if (s.ui.present) { stopPlayback(); setUI({ present: false }); return; }
        if (s.ui.sel) { setUI({ sel: null }); return; }
        if (s.ui.drawer) { setUI({ drawer: false }); return; }
        setUI({ tool: 'select' });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); return; }
      if (s.ui.present) return;
      const k = e.key.toLowerCase();
      const tool = ACTIONS.find((a) => a.key.toLowerCase() === k);
      if (tool) { setUI({ tool: tool.id }); return; }
      if (k === 'z') setPrefs({ zones: !s.prefs.zones });
      else if (k === 'g') setPrefs({ ghost: !s.prefs.ghost });
      else if (k === 'f') setPrefs({ flip: !s.prefs.flip });
      else if (k === 'h') setPrefs({ area: s.prefs.area === 'full' ? 'attack' : 'full' });
      else if (k === 'a') setPrefs({ autoDefense: s.prefs.autoDefense === 'off' ? 'both' : 'off' });
      else if (k === 'x') setPrefs({ spaceMap: !s.prefs.spaceMap });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return html`<div class="boot"><span class="boot-dot"></span>Loading your plans</div>`;

  return html`<div class=${cx('app', present && 'presenting')}>
    ${present ? null : html`<${TopBar} />`}
    ${present ? null : html`<${Rail} />`}
    <main class="stage">
      <div class="stage-pitch" onClick=${present ? (e) => { if (!e.target.closest('.present-ui')) togglePlay(); } : null}>
        <${Pitch} presenting=${present} />
        ${present ? null : html`<${ShadesBadge} />`}
        ${present ? null : html`<${BoardHint} />`}
        <${FormationStamp} />
        <${Caption} />
        <${Flood} />
        ${present ? null : html`<${Inspector} />`}
      </div>
      ${present ? null : html`<${StepBar} />`}
      ${present ? html`<${PresentOverlay} />` : null}
    </main>
    ${present ? null : html`<${Panel} />`}
    ${drawer && !present ? html`<div class="scrim" onClick=${() => setUI({ drawer: false })}></div>` : null}
    ${plansOpen ? html`<${Modal} title="Game plans and files" onClose=${() => setUI({ plansOpen: false })}><${PlansPanel} /><//>` : null}
    ${teamsOpen ? html`<${Modal} title="Your teams" onClose=${() => setUI({ teamsOpen: false })}><${TeamsPanel} /><//>` : null}
    ${guide ? html`<${Guide} onClose=${closeGuide} />` : null}
    <${Toast} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
init().catch((e) => { console.error(e); toast('Could not load saved plans. Starting with the examples.', 'risk'); });
