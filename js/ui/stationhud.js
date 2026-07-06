// stationhud.js — station legibility (#T3, #30): while a ring is open, a
// small glass panel shows the ghost target figure (dashed — "match me"), the
// live constellation-self over it, the instructional guide line, and a rep
// count. The poetry stays in the cue text; this panel is the *instruction*.

import { events } from '../events.js';

export function initStationHud({ constellation }) {
  const panel = document.createElement('div');
  panel.className = 'station-hud glass';
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  panel.innerHTML = `
    <canvas class="hud-canvas" aria-hidden="true"></canvas>
    <p class="hud-guide"></p>
    <p class="hud-count"></p>
  `;
  document.body.appendChild(panel);

  const canvas = panel.querySelector('.hud-canvas');
  const guideEl = panel.querySelector('.hud-guide');
  const countEl = panel.querySelector('.hud-count');

  let visible = false;
  let raf = null;
  let pose = null;

  function loop() {
    if (!visible) return;
    constellation.drawTo(canvas, { ghostPose: pose, fitScale: 0.30, centerY: 0.42 });
    raf = requestAnimationFrame(loop);
  }

  function show({ guide, pose: p, of }) {
    pose = p;
    guideEl.textContent = guide || '';
    countEl.textContent = of > 1 ? `0 / ${of}` : '';
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('visible'));
    if (!visible) {
      visible = true;
      raf = requestAnimationFrame(loop);
    }
  }

  function hide() {
    visible = false;
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
    panel.classList.remove('visible');
    setTimeout(() => { if (!visible) panel.hidden = true; }, 700);
  }

  events.on('stationEngage', (e) => show(e));
  events.on('stationPhase', (e) => {
    pose = e.pose;
    countEl.textContent = `${e.phase} / ${e.of}`;
  });
  events.on('stationRep', (e) => {
    countEl.textContent = `${e.phase} / ${e.of}`;
  });
  events.on('stationComplete', hide);
  events.on('sessionEnd', hide);

  return { show, hide };
}
