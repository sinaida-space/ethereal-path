// journey.js — the Journey class: session clock, acts, breathe, light, cues.
//
// Journey owns the timed 5-minute session arc: eased progress, act
// boundaries, a calming breathing signal, an accumulating "light" value fed
// by ray-taking, and one-shot movement cues fired at fixed progress points.
// Emits: actChange, cue, sessionEnd (via js/events.js).

import { events } from './events.js';
import { JOURNEY_DURATION_S } from './config.js';

const BREATHE_CYCLE_S = 6.0; // ~10 breaths/min, calming

const LIGHT_START = 0.15;
const LIGHT_DECAY_TARGET = 0.25;
const LIGHT_DECAY_RATE = 0.005; // per second

const ACT_BOUNDARIES = [
  { progress: 0.25, act: 2 },
  { progress: 0.6, act: 3 },
  { progress: 0.95, act: 'return' },
];

const CUES = [
  { progress: 0.02, text: 'settle in — let the current carry you' },
  { progress: 0.1, text: 'let your shoulders sink away from your ears' },
  { progress: 0.22, text: 'slow circle with your head — horizon to horizon' },
  { progress: 0.3, text: 'the path bends — lean to look around it' },
  { progress: 0.42, text: 'reach for what glows' },
  { progress: 0.55, text: 'roll your shoulders back, once, slowly' },
  { progress: 0.68, text: 'you are far from your desk now' },
  { progress: 0.8, text: 'breathe with the clouds' },
  { progress: 0.93, text: 'begin to come back — long exhale' },
  { progress: 0.985, text: 'surface' },
];

function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

export class Journey {
  constructor() {
    this.started = false;
    this.paused = false;
    this.held = false; // stations (#23) freeze the drift, not the breath
    this.ended = false;

    this.t = 0; // elapsed clock seconds (excludes paused time)
    this._bt = 0; // breathing clock — runs through holds
    this._duration = JOURNEY_DURATION_S; // decks override via setDuration()
    this.progress = 0; // eased 0..1
    this.breathe = 0;
    this.light = LIGHT_START;
    this.act = 1;

    this._firedActs = new Set();
    this._firedCues = new Set();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.paused = false;
    this.held = false;
    this._holds = 0;
    this.ended = false;
    this.t = 0;
    this._bt = 0;
    this.progress = 0;
    this.breathe = 0;
    this.light = LIGHT_START;
    this.act = 1;
    this._firedActs.clear();
    this._firedCues.clear();
  }

  addLight(amount) {
    this.light = Math.min(1.0, this.light + amount);
  }

  // Stations freeze the drift clock while the user exercises; breathing and
  // light continue so the held world stays alive. Refcounted (#30): the pause
  // screen and an open station can hold simultaneously — resuming from pause
  // must not release the station's hold.
  hold() {
    this._holds = (this._holds || 0) + 1;
    this.held = true;
  }
  release() {
    this._holds = Math.max(0, (this._holds || 0) - 1);
    this.held = this._holds > 0;
  }

  // Deck-driven drift length (#T1). Call before start().
  setDuration(seconds) {
    if (Number.isFinite(seconds) && seconds > 0) this._duration = seconds;
  }

  // Jump the clock to a linear-progress point (pause.js 'surface' exit).
  jumpToLinear(p) {
    this.t = Math.max(0, Math.min(1, p)) * this._duration;
  }

  update(dt) {
    if (!this.started || this.paused) return;

    this._bt += dt;
    this.breathe = 0.5 + 0.5 * Math.sin((this._bt * 2 * Math.PI) / BREATHE_CYCLE_S);

    // Light decays toward LIGHT_DECAY_TARGET at LIGHT_DECAY_RATE per second.
    if (this.light > LIGHT_DECAY_TARGET) {
      this.light = Math.max(LIGHT_DECAY_TARGET, this.light - LIGHT_DECAY_RATE * dt);
    } else if (this.light < LIGHT_DECAY_TARGET) {
      this.light = Math.min(LIGHT_DECAY_TARGET, this.light + LIGHT_DECAY_RATE * dt);
    }

    if (this.held || this.ended) return;

    this.t += dt;
    const linear = Math.min(1, this.t / this._duration);
    this.progress = easeInOutSine(linear);

    for (const boundary of ACT_BOUNDARIES) {
      if (!this._firedActs.has(boundary.progress) && linear >= boundary.progress) {
        this._firedActs.add(boundary.progress);
        this.act = boundary.act;
        events.emit('actChange', { act: boundary.act });
      }
    }

    for (const cue of CUES) {
      if (!this._firedCues.has(cue.progress) && linear >= cue.progress) {
        this._firedCues.add(cue.progress);
        events.emit('cue', { text: cue.text });
      }
    }

    if (!this.ended && linear >= 1) {
      this.ended = true;
      events.emit('sessionEnd', {});
    }
  }
}
