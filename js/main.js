// main.js — boots the renderer, benchmarks the GPU, and drives the RAF loop.
//
// Temporary state (until real subsystems land):
//   head     — follows mouse (normalized, lerped) as a stand-in for #5 tracking
//   progress — ping-pongs 0..1 over 60s
//   rays     — one fake ray
//
// Exposes window.__ep = { renderer, state } for verification.

import { Renderer } from './gl/renderer.js';
import { runBenchmark } from './benchmark.js';
import { Camera } from './camera.js';

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

// Mouse stand-in for head tracking: map cursor to normalized [-1,1].
window.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth) * 2 - 1;
  const y = -((e.clientY / window.innerHeight) * 2 - 1);
  camera.setTarget(x, y, 0);
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

  window.addEventListener('resize', () => renderer.resize());
  window.__ep = { renderer, state };
  console.log(`renderer ready tier=${tier}`);

  const PROGRESS_PERIOD = 60; // seconds for a full 0->1->0 ping-pong
  const start = performance.now();

  function loop(now) {
    const t = (now - start) / 1000;

    // Progress ping-pongs 0..1 over PROGRESS_PERIOD seconds.
    const phase = (t % PROGRESS_PERIOD) / PROGRESS_PERIOD;
    state.progress = phase < 0.5 ? phase * 2 : (1 - phase) * 2;

    const head = camera.update();
    state.head.x = head.x;
    state.head.y = head.y;
    state.head.z = head.z;

    state.breathe = 0.5 + 0.5 * Math.sin(t * 0.4);

    renderer.frame(t, state);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot();
