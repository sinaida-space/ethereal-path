// constellation.js — the constellation-self (#24): landmarks drawn as a
// breathing star-figure, shown on calibration and the pause screen, with a
// fullscreen shimmer echo on station completions.
//
// Consumes only public APIs: tracking.landmarks (raw, or null in fallback)
// and tracking.sample().pose (smoothed yaw/pitch/roll/shoulders). Canvas 2D
// only — this overlays UI screens, not the world; no shader/WebGL here.

import { events } from '../events.js';

const BREATHE_CYCLE_S = 6.0;

// Fallback idealized figure — normalized [-1,1] space, mirrors the shape of
// tracking's own fallback pose defaults (see js/input/tracking.js sample()).
const FALLBACK_POINTS = {
  nose: { x: 0, y: 0.62 },
  earL: { x: -0.09, y: 0.58 },
  earR: { x: 0.09, y: 0.58 },
  shoulderL: { x: -0.35, y: -0.55 },
  shoulderR: { x: 0.35, y: -0.55 },
  elbowL: { x: -0.5, y: -1.0 },
  elbowR: { x: 0.5, y: -1.0 },
  wristL: { x: -0.55, y: -1.4 },
  wristR: { x: 0.55, y: -1.4 },
};

// MediaPipe pose landmark indices we draw (nose/ears/shoulders/elbows/wrists).
const LM_NOSE = 0;
const LM_LEFT_EAR = 7;
const LM_RIGHT_EAR = 8;
const LM_LEFT_SHOULDER = 11;
const LM_RIGHT_SHOULDER = 12;
const LM_LEFT_ELBOW = 13;
const LM_RIGHT_ELBOW = 14;
const LM_LEFT_WRIST = 15;
const LM_RIGHT_WRIST = 16;

function mirrorX(v) { return -(v * 2 - 1); }
function mirrorY(v) { return -(v * 2 - 1); }

export function initConstellation(tracking) {
  let echoT0 = null;

  // Build the current 9-point figure in normalized [-1,1] space (x right,
  // y up), centered roughly on the torso. Returns { points, connections, fallback }.
  function currentFigure() {
    const lm = tracking && tracking.landmarks;
    if (!lm) {
      return { points: FALLBACK_POINTS, fallback: true };
    }
    const pick = (i) => lm[i];
    const nose = pick(LM_NOSE);
    const earL = pick(LM_LEFT_EAR);
    const earR = pick(LM_RIGHT_EAR);
    const shoulderL = pick(LM_LEFT_SHOULDER);
    const shoulderR = pick(LM_RIGHT_SHOULDER);
    const elbowL = pick(LM_LEFT_ELBOW);
    const elbowR = pick(LM_RIGHT_ELBOW);
    const wristL = pick(LM_LEFT_WRIST);
    const wristR = pick(LM_RIGHT_WRIST);
    if (!nose || !earL || !earR || !shoulderL || !shoulderR) {
      return { points: FALLBACK_POINTS, fallback: true };
    }
    const toPt = (p) => p ? { x: mirrorX(p.x), y: mirrorY(p.y), v: typeof p.visibility === 'number' ? p.visibility : 1 } : null;
    return {
      fallback: false,
      points: {
        nose: toPt(nose),
        earL: toPt(earL),
        earR: toPt(earR),
        shoulderL: toPt(shoulderL),
        shoulderR: toPt(shoulderR),
        elbowL: toPt(elbowL),
        elbowR: toPt(elbowR),
        wristL: toPt(wristL),
        wristR: toPt(wristR),
      },
    };
  }

  function connections(points) {
    const pairs = [
      ['earL', 'earR'],
      ['earL', 'nose'],
      ['earR', 'nose'],
      ['shoulderL', 'shoulderR'],
      ['shoulderL', 'elbowL'],
      ['elbowL', 'wristL'],
      ['shoulderR', 'elbowR'],
      ['elbowR', 'wristR'],
    ];
    return pairs
      .map(([a, b]) => [points[a], points[b]])
      .filter(([a, b]) => a && b);
  }

  // Draws the figure into `ctx` sized (w,h), fit into the canvas with a
  // breathing scale/alpha modulation. `alphaMul` scales overall opacity
  // (used by the echo effect); `swayDeg` used for the fallback's gentle sway.
  function draw(ctx, w, h, tNow, opts = {}) {
    const alphaMul = opts.alphaMul != null ? opts.alphaMul : 1;
    const fig = currentFigure();
    const breatheT = tNow / 1000;
    const breathe = Math.sin((breatheT * 2 * Math.PI) / BREATHE_CYCLE_S);
    const scale = 1 + 0.02 * breathe;
    const haloAlpha = 0.75 + 0.25 * breathe;

    let sway = 0;
    if (fig.fallback) {
      sway = (Math.PI / 180) * Math.sin((breatheT * 2 * Math.PI) / BREATHE_CYCLE_S) * 1;
    }

    const cx = w / 2;
    const cy = h * 0.58;
    const fit = Math.min(w, h) * 0.42 * scale;

    const cos = Math.cos(sway);
    const sin = Math.sin(sway);
    const project = (p) => {
      // rotate (sway) then scale/fit, then place at (cx, cy); y flips (up positive -> screen down).
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;
      return { x: cx + rx * fit, y: cy - ry * fit };
    };

    const pts = fig.points;
    const screenPts = {};
    for (const k of Object.keys(pts)) {
      const p = pts[k];
      if (!p) continue;
      screenPts[k] = { ...project(p), v: p.v != null ? p.v : 1 };
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Asterism lines, 8% overshoot gap at each endpoint.
    ctx.strokeStyle = `rgba(160,210,255,${0.18 * alphaMul})`;
    ctx.lineWidth = 1;
    for (const [a, b] of connections(screenPts)) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const gap = 0.08;
      const sx = a.x + dx * gap;
      const sy = a.y + dy * gap;
      const ex = b.x - dx * gap;
      const ey = b.y - dy * gap;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    // Stars: soft radial-gradient dots.
    for (const k of Object.keys(screenPts)) {
      const p = screenPts[k];
      const brightness = Math.max(0.25, Math.min(1, p.v));
      const haloR = 12;
      const coreR = 2 + 2 * brightness;
      const a = haloAlpha * brightness * alphaMul;

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
      grad.addColorStop(0, `rgba(160,210,255,${0.9 * a})`);
      grad.addColorStop(0.3, `rgba(160,210,255,${0.35 * a})`);
      grad.addColorStop(1, 'rgba(160,210,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(210,235,255,${Math.min(1, a + 0.3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawTo(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, performance.now(), opts);
  }

  // ---- persistent figure mount (calibration / pause) ----
  let mountCanvas = null;
  let mountRaf = null;

  function showFigure(container) {
    try {
      hideFigure();
      const canvas = document.createElement('canvas');
      canvas.className = 'constellation-figure';
      container.appendChild(canvas);
      mountCanvas = canvas;
      const step = () => {
        if (!mountCanvas) return;
        drawTo(mountCanvas);
        mountRaf = requestAnimationFrame(step);
      };
      mountRaf = requestAnimationFrame(step);
    } catch (err) {
      // Splash DOM changes must never break calibration.
      /* ignore */
    }
  }

  function hideFigure() {
    try {
      if (mountRaf != null) cancelAnimationFrame(mountRaf);
      mountRaf = null;
      if (mountCanvas && mountCanvas.parentNode) {
        mountCanvas.parentNode.removeChild(mountCanvas);
      }
      mountCanvas = null;
    } catch (err) {
      /* ignore */
    }
  }

  // ---- echo effect on stationComplete ----
  function startEcho() {
    const canvas = document.createElement('canvas');
    canvas.className = 'constellation-echo';
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    document.body.appendChild(canvas);

    const duration = 1500;
    const start = performance.now();
    let raf = null;

    function frame(now) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // 0 -> 0.5 -> 0 triangular alpha envelope.
      const alphaMul = t < 0.5 ? (t / 0.5) : (1 - t) / 0.5;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h, now, { alphaMul: alphaMul * 0.5 });

      if (elapsed < duration) {
        raf = requestAnimationFrame(frame);
      } else {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  events.on('stationComplete', () => {
    try { startEcho(); } catch (err) { /* ignore */ }
  });

  return { drawTo, startEcho, showFigure, hideFigure };
}
