import { html, useState } from './lib.js';
import { useStore, activePlan, activePlay, newPlay, selectPlay, renamePlay, duplicatePlay, deletePlay, setUI, setStep } from './store.js';
import { stop } from './player.js';
import { ACTIONS } from './data.js';
import { Icon } from './icons.js';
import { Section, Btn, ConfirmBtn, TextInput, Empty, cx } from './ui.js';

export function PlaysPanel() {
  const plan = useStore(activePlan);
  const play = useStore(activePlay);
  const ui = useStore((s) => s.ui);

  return html`<div class="panel-body">
    <${Section} title="Plays" aside=${html`<${Btn} size="sm" variant="primary" icon="plus" onClick=${() => newPlay()}>New play<//>`}>
      <button type="button" class=${cx('board-row', !play && 'on')} onClick=${() => { stop(); setUI({ playId: null, step: 0, sel: null }); }}>
        <${Icon} name="layers" size=${18} />
        <span><strong>Board</strong><small>Base shape, no movement</small></span>
      </button>
      ${plan.plays.length ? html`<ul class="play-list">
        ${plan.plays.map((p) => html`<li class=${cx('play-row', play?.id === p.id && 'on')}>
          <button type="button" class="play-hit" onClick=${() => { stop(); selectPlay(p.id); }}>
            <span class="play-steps tnum">${p.steps.length}</span>
            <span class="play-name"><strong>${p.name}</strong><small>${p.steps.length} step${p.steps.length === 1 ? '' : 's'} · ${p.steps.reduce((n, s) => n + s.actions.length, 0)} actions</small></span>
          </button>
        </li>`)}
      </ul>` : html`<${Empty} icon="pen" title="No plays yet">Pick a tool on the left and drag from a player, or start a blank play.<//>`}
    <//>

    ${play ? html`<${Section} title="This play">
      <div class="field">
        <label class="field-label" for="play-name">Name</label>
        <${TextInput} id="play-name" value=${play.name} onCommit=${(v) => renamePlay(play.id, v || 'Untitled play')} />
      </div>
      <ol class="step-outline">
        ${play.steps.map((s, i) => html`<li class=${cx(i === ui.step && 'on')}>
          <button type="button" onClick=${() => { stop(); setStep(i); }}>
            <span class="tnum">${i + 1}</span>
            <span>${s.caption || html`<em class="muted">No caption</em>`}</span>
            <span class="step-icons">${s.actions.slice(0, 6).map((a) => html`<${Icon} name=${a.type} size=${14} />`)}</span>
          </button>
        </li>`)}
      </ol>
      <div class="row gap-s wrap">
        <${Btn} size="sm" icon="copy" onClick=${() => duplicatePlay(play.id)}>Duplicate<//>
        <${ConfirmBtn} label="Delete play" onConfirm=${() => deletePlay(play.id)} />
      </div>
    <//>` : null}

    <${Section} title="Line styles">
      <ul class="legend">
        ${ACTIONS.filter((a) => a.id !== 'select').map((a) => html`<li>
          <span class=${'legend-ic line-' + a.id}><${Icon} name=${a.id} size=${22} /></span>
          <span><strong>${a.name} <kbd>${a.key}</kbd></strong><small>${a.hint}</small></span>
        </li>`)}
      </ul>
      <p class="muted small">Each step's actions happen at the same time. Only the player on the ball can pass, dribble or shoot; a pass into space is collected by whoever runs onto it.</p>
    <//>
  </div>`;
}
