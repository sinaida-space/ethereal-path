// stations.js — exercise stations (#23): the warmup disguised as ritual.
// The drift pauses, a broken ring appears with a cue; verified movement
// draws the arc closed; the ring flares, releases a reflection question,
// and the drift resumes. There are no failure states: every station also
// completes on a gentle timeout ("the ring closes on its own").
//
// Ring state feeds state.rays[0] with v1.1 semantics:
//   { x: lateral offset, y: arc completion 0..1, taken: flare, active: fade }

import { events } from './events.js';
import { Rays } from './rays.js';

const FIRST_GAP_S = 18;    // drift before the first station
const BETWEEN_GAP_S = 12;  // free drift between stations
const TIMEOUT_S = 45;      // auto-complete: the ring closes on its own
const FADE_IN_S = 2.5;
const FLARE_S = 2.0;
const AUTO_CLOSE_S = 2.0;  // arc sweep when a timeout closes the ring

// Signal readers: everything the station table can verify against.
const SIGNALS = {
  yaw:     (s) => s.pose.yaw,
  pitch:   (s) => s.pose.pitch,
  roll:    (s) => s.pose.roll,
  shrug:   (s) => s.pose.shrug,
  handAny: (s) => Math.max(
    s.handL.present > 0.5 ? s.handL.y : -2,
    s.handR.present > 0.5 ? s.handR.y : -2),
};

// The warmup sequence — a real neck/shoulder class, one ring at a time.
// phases: ordered targets; each needs its signal past the threshold for
// `hold` seconds. `rounds` repeats the phase list. fallback:'auto' marks
// stations whose signal has no pointer equivalent (they self-complete in
// fallback mode while the cue guides the user on trust).
const STATIONS = [
  { id: 'settle', cue: 'settle in — breathe with the tunnel',
    type: 'auto', duration: 12 },
  { id: 'neck-turns', cue: 'slowly turn your head to the left … then to the right',
    phases: [
      { sig: 'yaw', below: -0.5, hold: 1.2 },
      { sig: 'yaw', above: -0.15, hold: 0.4 },
      { sig: 'yaw', above: 0.5, hold: 1.2 },
      { sig: 'yaw', below: 0.15, hold: 0.4 },
    ], rounds: 2 },
  { id: 'neck-tilts', cue: 'let one ear sink toward its shoulder … then the other',
    phases: [
      { sig: 'roll', below: -0.4, hold: 1.2 },
      { sig: 'roll', above: -0.1, hold: 0.4 },
      { sig: 'roll', above: 0.4, hold: 1.2 },
      { sig: 'roll', below: 0.1, hold: 0.4 },
    ], rounds: 2, fallback: 'auto' },
  { id: 'look-up', cue: 'look slowly up into the light … then tuck your chin',
    phases: [
      { sig: 'pitch', above: 0.45, hold: 1.2 },
      { sig: 'pitch', below: -0.3, hold: 1.0 },
    ], rounds: 2 },
  { id: 'shrug', cue: 'draw your shoulders up to your ears … and let them fall',
    phases: [
      { sig: 'shrug', above: 0.4, hold: 0.8 },
      { sig: 'shrug', below: 0.1, hold: 0.8 },
    ], rounds: 2, fallback: 'auto' },
  { id: 'arm-left', cue: 'reach your left hand up into the ring',
    phases: [{ sig: 'handAny', above: 0.35, hold: 1.5 }], rounds: 2, lateral: -0.5 },
  { id: 'arm-right', cue: 'now the right hand — reach for the light',
    phases: [{ sig: 'handAny', above: 0.35, hold: 1.5 }], rounds: 2, lateral: 0.5 },
  { id: 'reach-across', cue: 'reach across your body into the ring',
    phases: [{ sig: 'handAny', above: 0.1, hold: 1.2 }], rounds: 2, lateral: 0.7 },
  { id: 'look-behind', cue: 'turn as far as feels kind — first left, then right',
    phases: [
      { sig: 'yaw', below: -0.75, hold: 1.0 },
      { sig: 'yaw', above: 0.0, hold: 0.3 },
      { sig: 'yaw', above: 0.75, hold: 1.0 },
      { sig: 'yaw', below: 0.0, hold: 0.3 },
    ], rounds: 1 },
];

export class Stations {
  constructor() {
    this._deck = new Rays(); // used purely as the question-deck holder
    this.ready = false;

    this._queue = STATIONS.slice();
    this._idle = 0;
    this._gap = FIRST_GAP_S;

    this._st = null;      // active station def
    this._phaseIdx = 0;   // index into phases * rounds
    this._phaseHold = 0;
    this._elapsed = 0;    // time inside the station
    this._mode = 'live';  // 'live' | 'auto' (timeout or fallback-auto)
    this._autoT = 0;

    this._ring = null;    // { x, y, taken, active }
    this._ringState = [];
    this._flareT = 0;
    this._phase = 'idle'; // idle | fadeIn | active | flare
  }

  async load() {
    await this._deck.loadDeck();
    this.ready = true;
  }

  _totalPhases(st) {
    return st.type === 'auto' ? 1 : st.phases.length * st.rounds;
  }

  _engage(journey, mode) {
    const st = this._queue.shift();
    this._st = st;
    this._phaseIdx = 0;
    this._phaseHold = 0;
    this._elapsed = 0;
    this._flareT = 0;
    this._phase = 'fadeIn';
    this._mode =
      st.type === 'auto' || (mode === 'fallback' && st.fallback === 'auto')
        ? 'auto' : 'live';
    this._autoT = 0;
    this._ring = { x: st.lateral || 0, y: 0, taken: 0, active: 0 };
    journey.hold();
    events.emit('raySpawn', { index: st.id });
    events.emit('cue', { text: st.cue });
  }

  _complete(journey) {
    this._phase = 'flare';
    this._flareT = 0;
    const { question, deckIndex } = this._deck._drawQuestion();
    events.emit('rayTaken', { question, deckIndex });
    events.emit('stationComplete', { id: this._st.id });
    journey.addLight(0.12);
  }

  update(dt, sample, journey, mode) {
    if (!this.ready || !journey.started || journey.paused || journey.ended) {
      return this._toState();
    }

    if (this._phase === 'idle') {
      if (this._queue.length > 0) {
        this._idle += dt;
        if (this._idle >= this._gap) this._engage(journey, mode);
      }
      return this._toState();
    }

    const st = this._st;
    const ring = this._ring;
    this._elapsed += dt;

    if (this._phase === 'fadeIn') {
      ring.active = Math.min(1, this._elapsed / FADE_IN_S);
      if (this._elapsed >= FADE_IN_S) this._phase = 'active';
      return this._toState();
    }

    if (this._phase === 'active') {
      ring.active = 1;
      const total = this._totalPhases(st);

      if (this._mode === 'auto') {
        const dur = st.duration || 10;
        ring.y = Math.min(1, (this._elapsed - FADE_IN_S) / dur);
        if (ring.y >= 1) this._complete(journey);
      } else {
        // Timeout mercy: the ring closes on its own, never a failure.
        if (this._elapsed > TIMEOUT_S) {
          this._mode = 'auto';
          st.duration = AUTO_CLOSE_S;
          this._elapsed = FADE_IN_S; // restart the auto sweep from here
          return this._toState();
        }
        const phase = st.phases[this._phaseIdx % st.phases.length];
        const v = SIGNALS[phase.sig](sample);
        const hit =
          (phase.above !== undefined && v > phase.above) ||
          (phase.below !== undefined && v < phase.below);
        this._phaseHold = hit ? this._phaseHold + dt : 0;

        // Arc shows committed phases plus the partial hold underway.
        const partial = phase.hold > 0 ? Math.min(1, this._phaseHold / phase.hold) : 0;
        ring.y = Math.min(1, (this._phaseIdx + partial) / total);

        if (this._phaseHold >= phase.hold) {
          this._phaseIdx += 1;
          this._phaseHold = 0;
          events.emit('stationRep', { id: st.id, phase: this._phaseIdx, of: total });
          if (this._phaseIdx >= total) this._complete(journey);
        }
      }
      return this._toState();
    }

    if (this._phase === 'flare') {
      this._flareT += dt;
      ring.y = 1;
      ring.taken = Math.min(1, this._flareT / FLARE_S);
      if (this._flareT >= FLARE_S + 1.0) {
        ring.active = Math.max(0, 1 - (this._flareT - FLARE_S - 1.0) / 1.5);
      }
      if (this._flareT >= FLARE_S + 2.5) {
        this._ring = null;
        this._phase = 'idle';
        this._idle = 0;
        this._gap = BETWEEN_GAP_S;
        journey.release();
      }
      return this._toState();
    }

    return this._toState();
  }

  _toState() {
    this._ringState.length = 0;
    if (this._ring) this._ringState.push(this._ring);
    return this._ringState;
  }
}
