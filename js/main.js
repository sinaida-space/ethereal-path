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
import { Stations } from './stations.js';
import { audio } from './audio.js';
import { initSplash } from './ui/splash.js';
import { initOverlay } from './ui/overlay.js';
import { initPause } from './ui/pause.js';
import { initConstellation } from './ui/constellation.js';
import { initStationHud } from './ui/stationhud.js';

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
  surface: 1, // Act-0: 1 at the splash surface, eases to 0 on begin (the dive)
};

const camera = new Camera(0.1);
const tracking = new Tracking();
const journey = new Journey();
const stations = new Stations();

function begin(opts = {}) {
  if (journey.started) return;
  if (opts.deckId) stations.setDeck(opts.deckId);
  if (stations.driftSeconds) journey.setDuration(stations.driftSeconds);
  // audio.init() needs a user gesture; begin() is always click/key-triggered.
  audio.init();
  audio.dive();
  journey.start();
}

// First splash gesture starts the underwater bed (AudioContext gesture rule).
window.addEventListener('pointerdown', () => {
  if (!journey.started) audio.initSurface();
}, { once: true });

// The splash screen owns session start and camera choice; 'm' toggles mute.
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    audio.setMuted(!audio.muted);
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

  // Splash first: the benchmark runs behind it while the intro is read.
  const splash = initSplash({ renderer, tracking, begin });
  initOverlay({ audio, splash });
  // One shared constellation instance: pause + HUD (two would double the
  // stationComplete echo listener).
  const constellation = initConstellation(tracking);
  initPause({ journey, splash, tracking, constellation, stations });
  initStationHud({ constellation });

  const tier = await runBenchmark(renderer);
  const median = (renderer._median || 0).toFixed(1);
  console.log(`benchmark: ${tier} (${median}ms)`);
  renderer.setQuality(tier);
  splash.setBenchmark(tier, median);

  await tracking.start({ camera: false });
  await stations.load();

  window.addEventListener('resize', () => renderer.resize());
  window.__ep = { renderer, state, tracking, journey, stations, begin, audio, splash };
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
    // The dive: surface eases out over ~3s once the journey starts.
    const surfTarget = journey.started ? 0 : 1;
    state.surface += (surfTarget - state.surface) * Math.min(1, dt * 0.6);

    const sample = tracking.sample();
    camera.setTarget(sample.head.x, sample.head.y, sample.head.z);
    const head = camera.update();
    state.head.x = head.x;
    state.head.y = head.y;
    state.head.z = head.z;
    state.handL = sample.handL;
    state.handR = sample.handR;

    state.rays = stations.update(dt, sample, journey, tracking.mode);

    renderer.frame(t, state);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot();
