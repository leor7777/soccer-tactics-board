// Step list and playback transport under the pitch.
import { html, useState, useRef } from './lib.js';
import { useStore, activePlay, setUI, addStep, duplicateStep, deleteStep, moveStep, updateStep, newPlay, setStep } from './store.js';
import { usePB, toggle, restart, jump, stop, seek } from './player.js';
import { Icon } from './icons.js';
import { IconBtn, Seg, TextInput, cx } from './ui.js';

export function StepBar() {
  const play = useStore(activePlay);
  const ui = useStore((s) => s.ui);
  const pb = usePB();
  const [menu, setMenu] = useState(false);
  const dragFrom = useRef(null);

  if (!play) {
    return html`<div class="stepbar empty-bar">
      <div class="stepbar-hint">
        <${Icon} name="pen" size=${18} />
        <span><strong>Board mode.</strong> Set up your shape, then pick a tool and drag from a player to start a play.</span>
      </div>
      <button type="button" class="btn btn-primary" onClick=${() => newPlay()}><${Icon} name="plus" size=${18} /><span>New play</span></button>
    </div>`;
  }

  const k = pb.active ? pb.step : ui.step;
  const st = play.steps[ui.step];

  const onChipDown = (e, i) => { dragFrom.current = { i, x: e.clientX }; };
  const onChipUp = (e, i) => {
    const d = dragFrom.current;
    dragFrom.current = null;
    if (!d) return;
    if (d.i !== i) { moveStep(d.i, i); return; }
    if (pb.active) stop();
    setStep(i);
  };

  return html`<div class="stepbar">
    <div class="transport" role="group" aria-label="Playback">
      <${IconBtn} icon="restart" label="Restart" onClick=${restart} />
      <${IconBtn} icon="prev" label="Previous step" kbd="←" onClick=${() => jump(-1)} />
      <button type="button" class=${cx('play-btn', pb.playing && 'on')} onClick=${toggle} aria-label=${pb.playing ? 'Pause' : 'Play'} data-tip=${pb.playing ? 'Pause (Space)' : 'Play (Space)'}>
        <${Icon} name=${pb.playing ? 'pause' : 'play'} size=${20} />
      </button>
      <${IconBtn} icon="next" label="Next step" kbd="→" onClick=${() => jump(1)} />
      <${Seg} size="sm" label="Speed" value=${ui.speed} onChange=${(v) => setUI({ speed: v })}
        options=${[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]} />
    </div>

    <div class="steps" role="tablist" aria-label="Steps">
      ${play.steps.map((s, i) => {
        const fill = pb.active ? (i < k ? 1 : i === k ? pb.t : 0) : 0;
        return html`<button type="button" role="tab" aria-selected=${String(i === k)} class=${cx('step-chip', i === k && 'on', !s.actions.length && 'blank')}
          onPointerDown=${(e) => onChipDown(e, i)} onPointerUp=${(e) => onChipUp(e, i)} title=${s.caption || `Step ${i + 1}`}>
          <span class="step-num tnum">${i + 1}</span>
          <span class="step-meta">${s.actions.length ? `${s.actions.length} action${s.actions.length > 1 ? 's' : ''}` : 'Empty'}</span>
          <span class="step-progress" style=${`transform:scaleX(${fill})`}></span>
        </button>`;
      })}
      <button type="button" class="step-add" onClick=${addStep} aria-label="Add step" data-tip="Add step after this one"><${Icon} name="plus" size=${18} /></button>
    </div>

    <div class="step-tools">
      <div class="caption-field">
        <label class="sr" for="cap-input">Step ${ui.step + 1} caption</label>
        <${TextInput} id="cap-input" value=${st?.caption || ''} placeholder=${`Caption for step ${ui.step + 1}`} maxLength=${90}
          onCommit=${(v) => updateStep(ui.step, { caption: v })} />
      </div>
      <div class="menu-anchor">
        <${IconBtn} icon="sliders" label="Step options" active=${menu} onClick=${() => setMenu(!menu)} />
        ${menu ? html`<div class="pop step-menu" onPointerLeave=${() => setMenu(false)}>
          <div class="pop-row">
            <span>Length</span>
            <${Seg} size="sm" label="Step length" value=${st?.duration || 2} onChange=${(v) => updateStep(ui.step, { duration: v })}
              options=${[1.2, 2, 2.8, 4].map((v) => ({ value: v, label: v + 's' }))} />
          </div>
          <button type="button" class="pop-item" onClick=${() => { duplicateStep(); setMenu(false); }}><${Icon} name="copy" size=${16} />Duplicate step</button>
          <button type="button" class="pop-item" disabled=${ui.step === 0} onClick=${() => moveStep(ui.step, ui.step - 1)}><${Icon} name="chevronLeft" size=${16} />Move earlier</button>
          <button type="button" class="pop-item" disabled=${ui.step >= play.steps.length - 1} onClick=${() => moveStep(ui.step, ui.step + 1)}><${Icon} name="chevronRight" size=${16} />Move later</button>
          <button type="button" class="pop-item danger" onClick=${() => { deleteStep(); setMenu(false); }}><${Icon} name="trash" size=${16} />${play.steps.length > 1 ? 'Delete step' : 'Clear step'}</button>
        </div>` : null}
      </div>
    </div>
  </div>`;
}
