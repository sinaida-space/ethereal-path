// pause.js — stop -> mantra flow (#24): a rest button + Esc freezes the
// drift, dims the tunnel (CSS, not the shader — see constellation.js note
// and issue #24), and shows a constellation figure with one mantra, offering
// "return to the path" or "surface" (an early, graceful exit through the
// Return act rather than a hard cut to the end screen).
//
// Boundaries: only calls journey.hold()/release() — no other journey.js
// edits. No storage, no new fonts/libraries.

import { initConstellation } from './constellation.js';
import { events } from '../events.js';

const SURFACE_LINEAR_PROGRESS = 0.955;

export function initPause({ journey, splash, tracking, constellation, stations }) {
  const gl = document.getElementById('gl');
  const overlay = document.getElementById('overlay');
  if (!constellation) constellation = initConstellation(tracking);

  let mantras = [];
  let unseenMantras = [];
  let currentMantra = '';
  let paused = false;
  // True only during the direct finish-fade (not the same as `paused` — no
  // mantra/figure/return-or-surface UI is ever shown for this path), so
  // rest/Esc/return/surface can't race a fade already in flight.
  let finishing = false;
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
  // Hidden until the session actually starts — otherwise these show through
  // the translucent splash background before there's anything to rest from.
  const restBtn = document.createElement('button');
  restBtn.className = 'corner-pill rest-btn';
  restBtn.textContent = '◦ rest';
  restBtn.style.display = 'none';
  overlay.appendChild(restBtn);

  // ---- finish button: always available at the top while running, whether
  // paused or not — a direct route to the graceful early exit. ----
  const finishBtn = document.createElement('button');
  finishBtn.className = 'corner-pill finish-btn';
  finishBtn.textContent = '◦ finish here';
  finishBtn.style.display = 'none';
  overlay.appendChild(finishBtn);

  events.on('sessionStart', () => {
    restBtn.style.display = '';
    finishBtn.style.display = '';
  });

  // ---- pause layer ----
  const layer = document.createElement('div');
  layer.className = 'pause-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', 'rest');
  layer.hidden = true;
  layer.innerHTML = `
    <div class="pause-figure"></div>
    <p class="pause-mantra text-plate"></p>
    <div class="pause-buttons">
      <button class="tile pause-return">return to the path</button>
      <button class="tile pause-surface">surface</button>
    </div>
  `;
  document.body.appendChild(layer);

  const figureContainer = layer.querySelector('.pause-figure');
  const mantraEl = layer.querySelector('.pause-mantra');
  const returnBtn = layer.querySelector('.pause-return');
  const surfaceBtn = layer.querySelector('.pause-surface');

  function canPause() {
    return journey.started && !journey.ended && !sessionOver && !finishing;
  }

  // Shared tail for every graceful-exit path: abandon any in-flight
  // exercise station (its ring shouldn't linger over the Return act, and
  // its own hold shouldn't leave the world stuck — see stations.cancel),
  // then jump the clock. jumpToLinear() sets progress directly and clears
  // any remaining hold as a backstop, so the world reflects the jump on
  // the very next frame regardless of what was holding it.
  function releaseAndJump() {
    try { stations?.cancel?.(journey); } catch (err) { /* ignore */ }
    journey.jumpToLinear(SURFACE_LINEAR_PROGRESS);
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
      journey.release(); // matches enterPause()'s hold
      releaseAndJump();
    }, 2000);
  }

  // Finishing from mid-pause is just "surface"; finishing while running goes
  // straight to the black fade without ever showing the mantra/figure/
  // return-or-surface UI — `.exit-only` hides that content so the fade is a
  // clean black screen instead of an empty pause panel with stray buttons.
  function finishNow() {
    if (paused) {
      surface();
      return;
    }
    if (!canPause()) return;
    finishing = true;
    journey.hold();
    gl.classList.add('gl-dim');
    layer.classList.add('exit-only');
    layer.hidden = false;
    layer.classList.add('surfacing');
    setTimeout(() => {
      layer.hidden = true;
      layer.classList.remove('surfacing', 'exit-only');
      gl.classList.remove('gl-dim');
      journey.release(); // matches this function's own hold
      releaseAndJump();
      finishing = false;
    }, 2000);
  }

  restBtn.addEventListener('click', () => {
    if (paused) exitPause();
    else enterPause();
  });

  finishBtn.addEventListener('click', finishNow);

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (paused) exitPause();
    else enterPause();
  });

  returnBtn.addEventListener('click', exitPause);
  surfaceBtn.addEventListener('click', surface);

  events.on('sessionEnd', () => {
    sessionOver = true;
    restBtn.style.display = 'none';
    finishBtn.style.display = 'none';
  });

  return { enterPause, exitPause, surface, finishNow };
}
