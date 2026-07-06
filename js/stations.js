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

// Signal readers: everything a deck's station table can verify against.
const SIGNALS = {
  yaw:      (s) => s.pose.yaw,
  pitch:    (s) => s.pose.pitch,
  roll:     (s) => s.pose.roll,
  shrug:    (s) => s.pose.shrug,
  standing: (s) => s.pose.standing,
  rise:     (s) => s.pose.rise,
  handAny:  (s) => Math.max(
    s.handL.present > 0.5 ? s.handL.y : -2,
    s.handR.present > 0.5 ? s.handR.y : -2),
};

// The warmup choreography lives in data/decks.json (#T1): each deck is an
// ordered station list. phases: ordered targets; each needs its signal past
// the threshold for `hold` seconds. `rounds` repeats the phase list.
// fallback:'auto' marks stations whose signal has no pointer equivalent
// (they self-complete in fallback mode while the cue guides on trust).
// Optional per-phase `pose` keywords drive the ghost target figure (#T3).

export class Stations {
  constructor() {
    this._deck = new Rays(); // used purely as the question-deck holder
    this.ready = false;

    this.decks = [];      // [{id,title,subtitle,driftSeconds}] for the picker
    this._deckDefs = {};  // id -> full deck definition
    this._active = null;  // chosen deck def

    this._queue = [];
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
    const [, decksRes] = await Promise.all([
      this._deck.loadDeck(),
      fetch('data/decks.json'),
    ]);
    const data = await decksRes.json();
    for (const d of data.decks) {
      this._deckDefs[d.id] = d;
      this.decks.push({
        id: d.id, title: d.title, subtitle: d.subtitle,
        driftSeconds: d.driftSeconds,
      });
    }
    this.setDeck(data.decks[0].id);
    this.ready = true;
  }

  // Select a deck by id (splash picker). Stations are deep-cloned because the
  // engine mutates station objects (timeout mercy rewrites `duration`).
  setDeck(id) {
    const def = this._deckDefs[id];
    if (!def) return;
    this._active = def;
    this._queue = JSON.parse(JSON.stringify(def.stations));
    this._idle = 0;
    this._gap = FIRST_GAP_S;
  }

  get deckId() { return this._active ? this._active.id : null; }
  get driftSeconds() { return this._active ? this._active.driftSeconds : null; }

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
    // Legibility HUD (#T3): who engages, how to do it, target pose, rep total.
    events.emit('stationEngage', {
      id: st.id,
      guide: st.guide || '',
      pose: this._currentPose(),
      of: this._totalPhases(st),
    });
  }

  _currentPose() {
    const st = this._st;
    if (!st) return null;
    if (st.type === 'auto' || this._mode === 'auto') return st.pose || null;
    const phase = st.phases[this._phaseIdx % st.phases.length];
    return (phase && phase.pose) || st.pose || null;
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
          if (this._phaseIdx >= total) {
            this._complete(journey);
          } else {
            events.emit('stationPhase', {
              id: st.id, pose: this._currentPose(),
              phase: this._phaseIdx, of: total,
            });
          }
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
