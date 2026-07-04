// benchmark.js — startup GPU probe. Renders the real placeholder scene at
// 'full' tier for a warm-up burst plus a timed burst, takes the median frame
// time, and maps it to a quality tier. Must finish in well under 3s.
//
//   <12ms -> 'full'    <24ms -> 'light'    else -> 'potato'

const WARMUP = 30;
const TIMED = 60;

function neutralState(progress) {
  return {
    progress,
    head: { x: 0, y: 0, z: 0 },
    handL: { x: 0, y: 0, present: 0 },
    handR: { x: 0, y: 0, present: 0 },
    rays: [{ x: 0.4, y: 0.3, taken: 0 }],
    light: 0,
    breathe: 0,
  };
}

export async function runBenchmark(renderer) {
  const gl = renderer.gl;
  const prev = renderer.tier;
  renderer.setQuality('full');
  // gl.finish() doesn't actually block in Chrome/ANGLE; a 1px readback is the
  // only reliable way to wait for the GPU before timestamping.
  const px = new Uint8Array(4);
  const gpuSync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

  // Warm up: let the driver compile/upload and reach steady state.
  for (let i = 0; i < WARMUP; i++) {
    renderer.frame(i / 60, neutralState((i / WARMUP) * 0.5));
  }
  gpuSync();

  const times = [];
  for (let i = 0; i < TIMED; i++) {
    const t0 = performance.now();
    renderer.frame((WARMUP + i) / 60, neutralState(0.5));
    gpuSync();
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];

  let tier;
  if (median < 12) tier = 'full';
  else if (median < 24) tier = 'light';
  else tier = 'potato';

  renderer.setQuality(prev);
  renderer._median = median;   // stash for main.js logging
  return tier;
}
