// tracking.js — the Tracking API: on-device head + hand tracking via
// MediaPipe (camera mode), or a pointer/keyboard/touch stand-in
// (fallback mode). One class, one output shape, so #7/#9 never branch on
// which mode is active.
//
// Privacy: video never leaves the device. No frames are stored, no network
// calls are made except the one-time MediaPipe model download from a CDN,
// and only when the caller opts into camera mode.
//
//   const tr = new Tracking();
//   await tr.start({ camera: false });   // fallback, resolves immediately
//   await tr.start({ camera: true });    // camera; on ANY failure, falls
//                                        // back and sets tr.fallbackReason
//   tr.mode                              // 'camera' | 'fallback'
//   tr.sample()                          // latest smoothed reading
//   tr.stop()                            // releases camera + model
//   tr.recalibrate()                     // resets camera-mode baseline

import { FallbackSource } from './fallback.js';

const MEDIAPIPE_VERSION = '0.10.14';
const MEDIAPIPE_ESM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
// Official mediapipe-models GCS bucket, float16 lite pose landmarker.
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const HEAD_ALPHA = 0.15;
const HAND_ALPHA = 0.3;
const BASELINE_SAMPLES = 30;
const STALE_MS = 500; // no detection beyond this -> head.ok = false
const EASE_BACK_MS = 2000; // ease values back to 0 over this window once stale

// MediaPipe Pose landmark indices we need (BlazePose topology).
const LM_NOSE = 0;
const LM_LEFT_SHOULDER = 11;
const LM_RIGHT_SHOULDER = 12;
const LM_LEFT_WRIST = 15;
const LM_RIGHT_WRIST = 16;

export class Tracking {
  constructor() {
    this.mode = 'fallback';
    this.fallbackReason = null;

    this._fallback = null;

    // Camera-mode internals.
    this._video = null;
    this._stream = null;
    this._landmarker = null;
    this._rafHandle = null;
    this._loopActive = false;

    // Smoothed output (camera mode).
    this._head = { x: 0, y: 0, z: 0, ok: false };
    this._handL = { x: 0, y: 0, present: 0 };
    this._handR = { x: 0, y: 0, present: 0 };

    this._lastDetectionTime = 0;
    this._staleSinceTime = 0;

    // Calibration baseline (shoulder width proxy for z=0).
    this._baselineSamples = [];
    this._baselineShoulderWidth = null;
  }

  async start(opts = {}) {
    const wantsCamera = !!opts.camera;

    if (!wantsCamera) {
      this.mode = 'fallback';
      this.fallbackReason = null;
      this._fallback = this._fallback || new FallbackSource();
      await this._fallback.start();
      return;
    }

    try {
      await this._startCamera();
      this.mode = 'camera';
      this.fallbackReason = null;
    } catch (err) {
      this._teardownCamera();
      this.mode = 'fallback';
      this.fallbackReason = (err && err.message) || String(err) || 'unknown-error';
      this._fallback = this._fallback || new FallbackSource();
      await this._fallback.start();
    }
  }

  async _startCamera() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia-unavailable');
    }

    // Lazy-load MediaPipe ESM bundle only on camera opt-in.
    let vision;
    try {
      vision = await import(/* webpackIgnore: true */ MEDIAPIPE_ESM_URL);
    } catch (err) {
      throw new Error('mediapipe-load-failed');
    }

    const { FilesetResolver, PoseLandmarker } = vision;
    if (!FilesetResolver || !PoseLandmarker) {
      throw new Error('mediapipe-load-failed');
    }

    let filesetResolver;
    try {
      filesetResolver = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
      );
    } catch (err) {
      throw new Error('mediapipe-wasm-load-failed');
    }

    let landmarker;
    try {
      landmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    } catch (gpuErr) {
      try {
        landmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch (cpuErr) {
        throw new Error('pose-model-load-failed');
      }
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      // Permission denied, no camera, or already in use.
      try {
        landmarker.close();
      } catch (_) {
        /* ignore */
      }
      throw new Error('camera-permission-denied');
    }

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    video.style.display = 'none';
    document.body.appendChild(video);

    try {
      await video.play();
    } catch (err) {
      this._cleanupStream(stream);
      video.remove();
      try {
        landmarker.close();
      } catch (_) {
        /* ignore */
      }
      throw new Error('video-play-failed');
    }

    this._video = video;
    this._stream = stream;
    this._landmarker = landmarker;
    this._resetBaseline();
    this._lastDetectionTime = performance.now();
    this._startDetectionLoop();
  }

  _startDetectionLoop() {
    this._loopActive = true;
    const step = () => {
      if (!this._loopActive || !this._video || !this._landmarker) return;
      try {
        const nowMs = performance.now();
        const result = this._landmarker.detectForVideo(this._video, nowMs);
        this._handleResult(result, nowMs);
      } catch (err) {
        // Any runtime inference failure: mark stale, keep looping so a
        // transient error doesn't wedge the app; if it becomes catastrophic
        // main.js keeps rendering with eased-back values.
        this._markStale(performance.now());
      }
      if (this._video && typeof this._video.requestVideoFrameCallback === 'function') {
        this._rafHandle = this._video.requestVideoFrameCallback(step);
      } else {
        this._rafHandle = requestAnimationFrame(step);
      }
    };
    if (this._video && typeof this._video.requestVideoFrameCallback === 'function') {
      this._rafHandle = this._video.requestVideoFrameCallback(step);
    } else {
      this._rafHandle = requestAnimationFrame(step);
    }
  }

  _handleResult(result, nowMs) {
    const poses = result && result.landmarks;
    if (!poses || poses.length === 0) {
      this._markStale(nowMs);
      return;
    }

    const lm = poses[0];
    const nose = lm[LM_NOSE];
    const ls = lm[LM_LEFT_SHOULDER];
    const rs = lm[LM_RIGHT_SHOULDER];
    const lw = lm[LM_LEFT_WRIST];
    const rw = lm[LM_RIGHT_WRIST];

    if (!nose || !ls || !rs) {
      this._markStale(nowMs);
      return;
    }

    this._lastDetectionTime = nowMs;
    this._staleSinceTime = 0;

    // MediaPipe image coords: x,y in [0,1], origin top-left, already mirrored
    // for a front camera view (selfie mode) by the browser's getUserMedia
    // default; we still explicitly mirror x below to guarantee "leaning left
    // moves head.x negative on screen" regardless of platform quirks.
    const nx = -(nose.x * 2 - 1);
    const ny = -(nose.y * 2 - 1); // flip so up is positive

    const shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y);
    if (this._baselineShoulderWidth === null) {
      this._baselineSamples.push(shoulderWidth);
      if (this._baselineSamples.length >= BASELINE_SAMPLES) {
        const sum = this._baselineSamples.reduce((a, b) => a + b, 0);
        this._baselineShoulderWidth = sum / this._baselineSamples.length;
      }
    }

    let z = 0;
    if (this._baselineShoulderWidth) {
      // Larger shoulder width than baseline = leaning in (closer) -> z > 0.
      z = clamp((shoulderWidth - this._baselineShoulderWidth) / this._baselineShoulderWidth, -1, 1);
    }

    this._head.x += (nx - this._head.x) * HEAD_ALPHA;
    this._head.y += (ny - this._head.y) * HEAD_ALPHA;
    this._head.z += (z - this._head.z) * HEAD_ALPHA;
    this._head.ok = true;

    this._updateHand(this._handL, lw);
    this._updateHand(this._handR, rw);
  }

  _updateHand(handState, wristLandmark) {
    if (!wristLandmark) {
      handState.present += (0 - handState.present) * HAND_ALPHA;
      return;
    }
    const hx = -(wristLandmark.x * 2 - 1);
    const hy = -(wristLandmark.y * 2 - 1);
    const visibility = typeof wristLandmark.visibility === 'number' ? wristLandmark.visibility : 1;
    handState.x += (hx - handState.x) * HAND_ALPHA;
    handState.y += (hy - handState.y) * HAND_ALPHA;
    handState.present += (visibility - handState.present) * HAND_ALPHA;
  }

  _markStale(nowMs) {
    if (this._staleSinceTime === 0) {
      this._staleSinceTime = this._lastDetectionTime || nowMs;
    }
    const staleFor = nowMs - this._staleSinceTime;
    if (staleFor > STALE_MS) {
      this._head.ok = false;
      const easeT = clamp((staleFor - STALE_MS) / EASE_BACK_MS, 0, 1);
      // Ease remaining values back toward 0 over EASE_BACK_MS.
      this._head.x *= 1 - easeT * 0.05;
      this._head.y *= 1 - easeT * 0.05;
      this._head.z *= 1 - easeT * 0.05;
      this._handL.present *= 1 - easeT * 0.05;
      this._handR.present *= 1 - easeT * 0.05;
    }
  }

  _resetBaseline() {
    this._baselineSamples = [];
    this._baselineShoulderWidth = null;
  }

  recalibrate() {
    if (this.mode === 'camera') {
      this._resetBaseline();
    } else if (this._fallback) {
      this._fallback.recalibrate();
    }
  }

  sample() {
    if (this.mode === 'camera') {
      return {
        head: { x: this._head.x, y: this._head.y, z: this._head.z, ok: this._head.ok },
        handL: { x: this._handL.x, y: this._handL.y, present: this._handL.present },
        handR: { x: this._handR.x, y: this._handR.y, present: this._handR.present },
      };
    }
    if (this._fallback) {
      return this._fallback.sample();
    }
    return {
      head: { x: 0, y: 0, z: 0, ok: false },
      handL: { x: 0, y: 0, present: 0 },
      handR: { x: 0, y: 0, present: 0 },
    };
  }

  stop() {
    this._loopActive = false;
    if (this._video && this._rafHandle != null) {
      if (typeof this._video.cancelVideoFrameCallback === 'function') {
        this._video.cancelVideoFrameCallback(this._rafHandle);
      } else {
        cancelAnimationFrame(this._rafHandle);
      }
    }
    this._rafHandle = null;
    this._teardownCamera();
    if (this._fallback) {
      this._fallback.stop();
    }
  }

  _teardownCamera() {
    if (this._stream) {
      this._cleanupStream(this._stream);
      this._stream = null;
    }
    if (this._video) {
      this._video.remove();
      this._video = null;
    }
    if (this._landmarker) {
      try {
        this._landmarker.close();
      } catch (_) {
        /* ignore */
      }
      this._landmarker = null;
    }
  }

  _cleanupStream(stream) {
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (_) {
      /* ignore */
    }
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
