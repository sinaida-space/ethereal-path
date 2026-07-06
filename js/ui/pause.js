// pause.js — stop -> mantra flow (#24): a rest button + Esc freezes the
// drift, dims the tunnel (CSS, not the shader — see constellation.js note
// and issue #24), and shows a constellation figure with one mantra, offering
// "return to the path" or "surface" (an early, graceful exit through the
// Return act rather than a hard cut to the end screen).
//
// Boundaries: only calls journey.hold()/release() — no other journey.js
// edits. No storage, no new fonts/libraries.

import { initConstellation } from './constellation.js';

const SURFACE_LINEAR_PROGRESS = 0.955;

export function initPause({ journey, splash, tracking, constellation }) {
  const gl = document.getElementById('gl');
  const overlay = document.getElementById('overlay');
  if (!constellation) constellation = initConstellation(tracking);

  let mantras = [];
  let unseenMantras = [];
  let currentMantra = '';
  let paused = false;
  let sessionOver = false;

  fetch('data/mantras.json')
    .then((r) => r.json())
    .then((data) => {
      mantras = Array.isArray(data.mantras) ? data.mantras.slice() : [];
      unseenMantras = mantras.slice();
    })
    .catch(() => {
      mantras = [];
      unseenMantras = [];
    });

  function pickMantra() {
    if (mantras.length === 0) return '';
    if (unseenMantras.length === 0) unseenMantras = mantras.slice();
    const i = Math.floor(Math.random() * unseenMantras.length);
    const [chosen] = unseenMantras.splice(i, 1);
    return chosen;
  }

  // ---- rest button (mirrors .mute-btn styling) ----
  const restBtn = document.createElement('button');
  restBtn.className = 'rest-btn';
  restBtn.textContent = '◦ rest';
  overlay.appendChild(restBtn);

  // ---- pause layer ----
  const layer = document.createElement('div');
  layer.className = 'pause-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', 'rest');
  layer.hidden = true;
  layer.innerHTML = `
    <div class="pause-figure"></div>
    <p class="pause-mantra"></p>
    <div class="pause-buttons">
      <button class="btn pause-return">return to the path</button>
      <button class="btn pause-surface">surface</button>
    </div>
  `;
  document.body.appendChild(layer);

  const figureContainer = layer.querySelector('.pause-figure');
  const mantraEl = layer.querySelector('.pause-mantra');
  const returnBtn = layer.querySelector('.pause-return');
  const surfaceBtn = layer.querySelector('.pause-surface');

  function canPause() {
    return journey.started && !journey.ended && !sessionOver;
  }

  function enterPause() {
    if (!canPause() || paused) return;
    paused = true;
    journey.hold();
    gl.classList.add('gl-dim');
    currentMantra = pickMantra();
    mantraEl.textContent = currentMantra;
    layer.hidden = false;
    requestAnimationFrame(() => layer.classList.add('visible'));
    try { constellation.showFigure(figureContainer); } catch (err) { /* ignore */ }
  }

  function exitPause() {
    if (!paused) return;
    paused = false;
    layer.classList.remove('visible');
    gl.classList.remove('gl-dim');
    journey.release();
    setTimeout(() => {
      if (!paused) {
        layer.hidden = true;
        constellation.hideFigure();
      }
    }, 1000);
  }

  function surface() {
    if (!paused) return;
    paused = false;
    layer.classList.add('surfacing');
    layer.classList.remove('visible');
    setTimeout(() => {
      layer.hidden = true;
      layer.classList.remove('surfacing');
      constellation.hideFigure();
      gl.classList.remove('gl-dim');
      // Jump the journey's clock to the Return act's linear progress, then
      // let it play its exhale and end normally (sessionEnd -> end screen).
      journey.jumpToLinear(SURFACE_LINEAR_PROGRESS);
      journey.release();
    }, 2000);
  }

  restBtn.addEventListener('click', () => {
    if (paused) exitPause();
    else enterPause();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (paused) exitPause();
    else enterPause();
  });

  returnBtn.addEventListener('click', exitPause);
  surfaceBtn.addEventListener('click', surface);

  journey._events?.on?.('sessionEnd', () => { sessionOver = true; });

  return { enterPause, exitPause, surface };
}
