// main.js — boots the renderer, benchmarks the GPU, and drives the RAF loop.
//
// Input: js/input/tracking.js (Tracking) supplies head/hand state, starting
// in fallback mode (pointer/keyboard/touch — see js/input/fallback.js).
// Dev keybind 'c' attempts camera mode; #9's splash screen will own this UX.
//
// Temporary state (until real subsystems land):
//   progress — ping-pongs 0..1 over 60s
//   rays     — one fake ray
//
// Exposes window.__ep = { renderer, state, tracking } for verification.

import { Renderer } from './gl/renderer.js';
import { runBenchmark } from './benchmark.js';
import { Camera } from './camera.js';
import { Tracking } from './input/tracking.js';

const canvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');

const state = {
  progress: 0,
  head: { x: 0, y: 0, z: 0 },
  handL: { x: 0, y: 0, present: 0 },
  handR: { x: 0, y: 0, present: 0 },
  rays: [{ x: 0.4, y: 0.3, taken: 0 }],
  light: 0,
  breathe: 0,
};

const camera = new Camera(0.1);
const tracking = new Tracking();

// Dev keybind: 'c' attempts camera mode. Any failure falls back gracefully
// (tracking.js sets tracking.fallbackReason); replaced by splash UI in #9.
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') {
    tracking.start({ camera: true }).then(() => {
      console.log(
        `tracking mode=${tracking.mode}` +
          (tracking.fallbackReason ? ` fallbackReason=${tracking.fallbackReason}` : '')
      );
    });
  }
});

async function boot() {
  let renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    if (err && err.message === 'webgl2-unavailable') {
      overlay.textContent =
        'Sorry — your browser or device does not support WebGL2, ' +
        'which this experience needs. Try a recent desktop browser.';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '2rem';
      overlay.style.textAlign = 'center';
      return;
    }
    throw err;
  }

  await renderer.load();

  const tier = await runBenchmark(renderer);
  const median = (renderer._median || 0).toFixed(1);
  console.log(`benchmark: ${tier} (${median}ms)`);
  renderer.setQuality(tier);

  await tracking.start({ camera: false });

  window.addEventListener('resize', () => renderer.resize());
  window.__ep = { renderer, state, tracking };
  console.log(`renderer ready tier=${tier}`);

  const PROGRESS_PERIOD = 60; // seconds for a full 0->1->0 ping-pong
  const start = performance.now();

  function loop(now) {
    const t = (now - start) / 1000;

    // Progress ping-pongs 0..1 over PROGRESS_PERIOD seconds.
    const phase = (t % PROGRESS_PERIOD) / PROGRESS_PERIOD;
    state.progress = phase < 0.5 ? phase * 2 : (1 - phase) * 2;

    const sample = tracking.sample();
    camera.setTarget(sample.head.x, sample.head.y, sample.head.z);
    const head = camera.update();
    state.head.x = head.x;
    state.head.y = head.y;
    state.head.z = head.z;
    state.handL = sample.handL;
    state.handR = sample.handR;

    state.breathe = 0.5 + 0.5 * Math.sin(t * 0.4);

    renderer.frame(t, state);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot();
