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

// ---- ghost target poses (#T3) --------------------------------------------
// Each keyword maps the idealized figure onto the position the exercise asks
// for. The station HUD draws this dashed behind the live figure: "match me."
function clonePts(src) {
  const out = {};
  for (const k of Object.keys(src)) out[k] = { x: src[k].x, y: src[k].y };
  return out;
}
function headShift(p, dx, dy) {
  for (const k of ['nose', 'earL', 'earR']) { p[k].x += dx; p[k].y += dy; }
  return p;
}
function headRotate(p, deg) {
  // Rotate the head cluster around the neck (midpoint of the shoulders).
  const cx = (p.shoulderL.x + p.shoulderR.x) / 2;
  const cy = (p.shoulderL.y + p.shoulderR.y) / 2 + 0.35;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a); const sin = Math.sin(a);
  for (const k of ['nose', 'earL', 'earR']) {
    const dx = p[k].x - cx; const dy = p[k].y - cy;
    p[k].x = cx + dx * cos - dy * sin;
    p[k].y = cy + dx * sin + dy * cos;
  }
  return p;
}
function leanAll(p, deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a); const sin = Math.sin(a);
  const cy = -1.4; // pivot at the base of the figure
  for (const k of Object.keys(p)) {
    const dx = p[k].x; const dy = p[k].y - cy;
    p[k].x = dx * cos - dy * sin;
    p[k].y = cy + dx * sin + dy * cos;
  }
  return p;
}
function setArm(p, side, elbow, wrist) {
  p['elbow' + side].x = elbow.x; p['elbow' + side].y = elbow.y;
  p['wrist' + side].x = wrist.x; p['wrist' + side].y = wrist.y;
  return p;
}
function shrugBy(p, dy) {
  for (const k of ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR']) p[k].y += dy;
  return p;
}
function shiftAll(p, dx, dy) {
  for (const k of Object.keys(p)) { p[k].x += dx; p[k].y += dy; }
  return p;
}

const POSES = {
  'breathe':        (p) => p,
  'center':         (p) => p,
  'sway':           (p) => p,
  'yaw-left':       (p) => headShift(p, -0.15, 0),
  'yaw-right':      (p) => headShift(p, 0.15, 0),
  'twist-left':     (p) => { headShift(p, -0.15, 0); p.shoulderL.x += 0.10; p.shoulderR.x -= 0.14; return p; },
  'twist-right':    (p) => { headShift(p, 0.15, 0); p.shoulderL.x += 0.14; p.shoulderR.x -= 0.10; return p; },
  'tilt-left':      (p) => headRotate(p, 22),
  'tilt-right':     (p) => headRotate(p, -22),
  'side-left':      (p) => leanAll(p, 14),
  'side-right':     (p) => leanAll(p, -14),
  'look-up':        (p) => headShift(p, 0, 0.11),
  'chin-tuck':      (p) => headShift(p, 0, -0.10),
  'shrug-up':       (p) => shrugBy(p, 0.14),
  'release':        (p) => shrugBy(p, -0.02),
  'stand':          (p) => shiftAll(p, 0, 0.14),
  'rise-up':        (p) => shiftAll(p, 0, 0.10),
  'rise-down':      (p) => p,
  'reach-up-left':  (p) => setArm(p, 'L', { x: -0.48, y: 0.05 }, { x: -0.42, y: 0.85 }),
  'reach-up-right': (p) => setArm(p, 'R', { x: 0.48, y: 0.05 }, { x: 0.42, y: 0.85 }),
  'reach-up-both':  (p) => setArm(setArm(p, 'L', { x: -0.48, y: 0.05 }, { x: -0.42, y: 0.85 }),
                                  'R', { x: 0.48, y: 0.05 }, { x: 0.42, y: 0.85 }),
  'reach-across':   (p) => setArm(p, 'R', { x: -0.10, y: -0.45 }, { x: -0.72, y: 0.05 }),
};

export function targetPose(keyword) {
  const fn = POSES[keyword];
  const base = clonePts(FALLBACK_POINTS);
  return fn ? fn(base) : base;
}

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
    const cy = h * (opts.centerY != null ? opts.centerY : 0.58);
    const fit = Math.min(w, h) * (opts.fitScale != null ? opts.fitScale : 0.42) * scale;

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

    // Ghost target figure (#T3): dashed, dimmer, drawn beneath the live one.
    if (opts.ghostPose) {
      const ghost = targetPose(opts.ghostPose);
      const gPts = {};
      for (const k of Object.keys(ghost)) gPts[k] = project(ghost[k]);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = `rgba(220,245,255,${0.30 * alphaMul})`;
      ctx.lineWidth = 1;
      for (const [a, b] of connections(gPts)) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(220,245,255,${0.40 * alphaMul})`;
      for (const k of Object.keys(gPts)) {
        ctx.beginPath();
        ctx.arc(gPts[k].x, gPts[k].y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

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
