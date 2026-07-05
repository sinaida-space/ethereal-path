// main.js — boots the renderer, benchmarks the GPU, and drives the RAF loop.
//
// Input: js/input/tracking.js (Tracking) supplies head/hand state, starting
// in fallback mode (pointer/keyboard/touch — see js/input/fallback.js).
// Dev keybind 'c' attempts camera mode; #9's splash screen will own this UX.
//
// Session composition (#8): Journey drives the timed arc (progress, act,
// breathe, light, cues); Rays drives the spawn/drift/take lifecycle and
// question deck. Session doesn't auto-start — window.__ep.begin() starts it
// (splash screen will call it; dev keybind 'b' for now).
//
// Exposes window.__ep = { renderer, state, tracking, journey, rays, begin } for verification.

import { Renderer } from './gl/renderer.js';
import { runBenchmark } from './benchmark.js';
import { Camera } from './camera.js';
import { Tracking } from './input/tracking.js';
import { Journey } from './journey.js';
import { Rays } from './rays.js';

const canvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');

const state = {
  progress: 0,
  head: { x: 0, y: 0, z: 0 },
  handL: { x: 0, y: 0, present: 0 },
  handR: { x: 0, y: 0, present: 0 },
  rays: [],
  light: 0,
  breathe: 0,
};

const camera = new Camera(0.1);
const tracking = new Tracking();
const journey = new Journey();
const rays = new Rays();

function begin() {
  if (journey.started) return;
  journey.start();
}

// Dev keybind: 'c' attempts camera mode. Any failure falls back gracefully
// (tracking.js sets tracking.fallbackReason); replaced by splash UI in #9.
// Dev keybind: 'b' begins the session; splash screen (#9) will call this.
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') {
    tracking.start({ camera: true }).then(() => {
      console.log(
        `tracking mode=${tracking.mode}` +
          (tracking.fallbackReason ? ` fallbackReason=${tracking.fallbackReason}` : '')
      );
    });
  }
  if (e.key === 'b' || e.key === 'B') {
    begin();
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
  await rays.loadDeck();

  window.addEventListener('resize', () => renderer.resize());
  window.__ep = { renderer, state, tracking, journey, rays, begin };
  console.log(`renderer ready tier=${tier}`);

  let lastNow = performance.now();

  function loop(now) {
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    const t = now / 1000;

    journey.update(dt);
    state.progress = journey.progress;
    state.breathe = journey.breathe;
    state.light = journey.light;

    const sample = tracking.sample();
    camera.setTarget(sample.head.x, sample.head.y, sample.head.z);
    const head = camera.update();
    state.head.x = head.x;
    state.head.y = head.y;
    state.head.z = head.z;
    state.handL = sample.handL;
    state.handR = sample.handR;

    state.rays = rays.update(dt, sample, journey);

    renderer.frame(t, state);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot();
