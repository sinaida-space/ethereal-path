// fallback.js — pointer/keyboard/touch input source used when no camera is
// available (or the user hasn't opted in). Produces the exact same output
// shape as tracking.js's camera mode so main.js (and #7/#9 consumers) never
// need to branch on mode:
//
//   sample() -> { head: {x,y,z,ok}, handL: {x,y,present}, handR: {x,y,present} }
//
// All values normalized [-1,1], y up. No network, no storage, no DOM beyond
// listeners on window/document.

const HEAD_ALPHA = 0.15;
const HAND_ALPHA = 0.3;
const REACH_CENTER = { x: 0, y: 0 };

export class FallbackSource {
  constructor() {
    // Raw targets driven by input events.
    this._targetHead = { x: 0, y: 0, z: 0 };
    this._pointerActive = false;
    this._pointerPos = { x: 0, y: 0 };
    this._keyReach = false; // Space key reach at screen center

    // Smoothed (EMA) output values.
    this._head = { x: 0, y: 0, z: 0, ok: true };
    this._handL = { x: 0, y: 0, present: 0 };
    this._handR = { x: 0, y: 0, present: 0 };

    // Keyboard nudge state (WASD / arrows), accumulated into target head.
    this._keys = Object.create(null);

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
  }

  start() {
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('touchstart', this._onTouchStart, { passive: true });
    window.addEventListener('touchmove', this._onTouchMove, { passive: true });
    window.addEventListener('touchend', this._onTouchEnd, { passive: true });
    return Promise.resolve();
  }

  stop() {
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('touchend', this._onTouchEnd);
  }

  recalibrate() {
    this._targetHead.x = 0;
    this._targetHead.y = 0;
    this._targetHead.z = 0;
  }

  _normFromClient(clientX, clientY) {
    const x = (clientX / window.innerWidth) * 2 - 1;
    const y = -((clientY / window.innerHeight) * 2 - 1);
    return { x, y };
  }

  _onPointerMove(e) {
    const { x, y } = this._normFromClient(e.clientX, e.clientY);
    this._pointerPos.x = x;
    this._pointerPos.y = y;
    this._targetHead.x = x;
    this._targetHead.y = y;
  }

  _onPointerDown(e) {
    const { x, y } = this._normFromClient(e.clientX, e.clientY);
    this._pointerPos.x = x;
    this._pointerPos.y = y;
    this._pointerActive = true;
  }

  _onPointerUp() {
    this._pointerActive = false;
  }

  _onWheel(e) {
    // Positive deltaY (scroll down / pinch out) -> lean out (z negative).
    const delta = Math.sign(e.deltaY) * 0.05;
    this._targetHead.z = clamp(this._targetHead.z - delta, -1, 1);
  }

  _onKeyDown(e) {
    this._keys[e.key] = true;
    if (e.key === ' ' || e.code === 'Space') {
      this._keyReach = true;
    }
  }

  _onKeyUp(e) {
    this._keys[e.key] = false;
    if (e.key === ' ' || e.code === 'Space') {
      this._keyReach = false;
    }
  }

  _onTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    const { x, y } = this._normFromClient(t.clientX, t.clientY);
    this._pointerPos.x = x;
    this._pointerPos.y = y;
    this._targetHead.x = x;
    this._targetHead.y = y;
    this._pointerActive = true;
  }

  _onTouchMove(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    const { x, y } = this._normFromClient(t.clientX, t.clientY);
    this._pointerPos.x = x;
    this._pointerPos.y = y;
    this._targetHead.x = x;
    this._targetHead.y = y;
  }

  _onTouchEnd() {
    this._pointerActive = false;
  }

  _applyKeyNudges(dt) {
    const speed = 0.9; // units/sec
    const keys = this._keys;
    let dx = 0;
    let dy = 0;
    if (keys.ArrowLeft || keys.a || keys.A) dx -= 1;
    if (keys.ArrowRight || keys.d || keys.D) dx += 1;
    if (keys.ArrowUp || keys.w || keys.W) dy += 1;
    if (keys.ArrowDown || keys.s || keys.S) dy -= 1;
    if (dx !== 0 || dy !== 0) {
      this._targetHead.x = clamp(this._targetHead.x + dx * speed * dt, -1, 1);
      this._targetHead.y = clamp(this._targetHead.y + dy * speed * dt, -1, 1);
    }
  }

  // Called once per rAF by main.js. dt in seconds, used only for keyboard
  // nudge integration; smoothing itself uses fixed EMA alphas per spec.
  sample(dt = 1 / 60) {
    this._applyKeyNudges(dt);

    this._head.x += (this._targetHead.x - this._head.x) * HEAD_ALPHA;
    this._head.y += (this._targetHead.y - this._head.y) * HEAD_ALPHA;
    this._head.z += (this._targetHead.z - this._head.z) * HEAD_ALPHA;
    this._head.ok = true; // pointer/keyboard input is always "detected"

    // Virtual right hand: pointer-down / touch-hold / Space reach.
    const reaching = this._pointerActive || this._keyReach;
    const reachX = this._keyReach && !this._pointerActive ? REACH_CENTER.x : this._pointerPos.x;
    const reachY = this._keyReach && !this._pointerActive ? REACH_CENTER.y : this._pointerPos.y;
    const targetPresent = reaching ? 1 : 0;

    this._handR.x += (reachX - this._handR.x) * HAND_ALPHA;
    this._handR.y += (reachY - this._handR.y) * HAND_ALPHA;
    this._handR.present += (targetPresent - this._handR.present) * HAND_ALPHA;

    // No left-hand input source in fallback mode; keeps shape stable.
    this._handL.present += (0 - this._handL.present) * HAND_ALPHA;

    return {
      head: { x: this._head.x, y: this._head.y, z: this._head.z, ok: this._head.ok },
      handL: { x: this._handL.x, y: this._handL.y, present: this._handL.present },
      handR: { x: this._handR.x, y: this._handR.y, present: this._handR.present },
    };
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
