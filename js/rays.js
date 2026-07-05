// rays.js — the Rays class: spawn/drift/hit/take lifecycle + question deck.
//
// One active ray at a time. Deck of questions is fetched from
// data/questions.json, Fisher-Yates shuffled once per session, and drawn
// sequentially. Emits: raySpawn, rayTaken, rayFaded (via js/events.js).

import { events } from './events.js';

const FIRST_SPAWN_S = 35;
const SPAWN_GAP_MIN_S = 28;
const SPAWN_GAP_MAX_S = 42;

const FADE_IN_S = 3;
const ACTIVE_S = 14;
const FADE_OUT_S = 4;

const DRIFT_TOTAL = 0.1; // total drift toward center over the active phase

const HAND_TAKE_DIST = 0.18;
const HAND_TAKE_MS = 600;
const HEAD_TAKE_DIST = 0.25;
const HEAD_TAKE_MS = 1000;
const HEAD_SCALE = 1.5;

const TAKEN_ANIM_S = 2;

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export class Rays {
  constructor() {
    this.deck = [];
    this.deckIndex = 0;
    this.ready = false;

    this._nextSpawnAt = FIRST_SPAWN_S;
    this._spawnIndex = 0;
    this._consecutiveFades = 0;
    this._headFallbackEnabled = false;

    // Current ray (or null). Shape kept minimal — matches state.rays[i].
    this._ray = null; // { x, y, spawnX, spawnY, phase, phaseT, index, taken, takenT, holdMs, headHoldMs }
  }

  async loadDeck() {
    const res = await fetch('data/questions.json');
    const data = await res.json();
    this.deck = shuffle(data.questions.slice());
    this.deckIndex = 0;
    this.ready = true;
  }

  _drawQuestion() {
    if (this.deckIndex >= this.deck.length) {
      // Deck exhausted (54 rays max per spec) — reshuffle as a safety net.
      this.deck = shuffle(this.deck.slice());
      this.deckIndex = 0;
    }
    const question = this.deck[this.deckIndex];
    const idx = this.deckIndex;
    this.deckIndex += 1;
    return { question, deckIndex: idx };
  }

  _spawn(journeyT) {
    const side = this._spawnIndex % 2 === 0 ? 1 : -1;
    const x = side * (0.35 + Math.random() * 0.25);
    const y = 0.25 + Math.random() * 0.45;

    this._ray = {
      x,
      y,
      spawnX: x,
      spawnY: y,
      phase: 'fadeIn',
      phaseT: 0,
      index: this._spawnIndex,
      taken: 0,
      takenT: 0,
      holdMs: 0,
      headHoldMs: 0,
    };
    this._spawnIndex += 1;

    events.emit('raySpawn', { index: this._ray.index });
  }

  _scheduleNextSpawn(journeyT) {
    const gap = SPAWN_GAP_MIN_S + Math.random() * (SPAWN_GAP_MAX_S - SPAWN_GAP_MIN_S);
    this._nextSpawnAt = journeyT + gap;
  }

  update(dt, sample, journey) {
    if (!this.ready || !journey || !journey.started || journey.paused) {
      return this._toState();
    }

    const t = journey.t;

    if (!this._ray) {
      if (t >= this._nextSpawnAt) {
        this._spawn(t);
      }
      return this._toState();
    }

    const ray = this._ray;

    if (ray.phase === 'fadeIn') {
      ray.phaseT += dt;
      if (ray.phaseT >= FADE_IN_S) {
        ray.phase = 'active';
        ray.phaseT = 0;
      }
    } else if (ray.phase === 'active') {
      ray.phaseT += dt;

      // Drift slowly toward center (~DRIFT_TOTAL total distance) over the active phase.
      const driftFrac = Math.min(1, ray.phaseT / ACTIVE_S);
      const side = ray.spawnX < 0 ? -1 : 1;
      ray.x = ray.spawnX - side * DRIFT_TOTAL * driftFrac;
      ray.y = ray.spawnY;

      this._checkTake(dt, sample, ray, journey);

      if (ray.taken > 0) {
        // Taking animation in progress; handled below regardless of phaseT.
      } else if (ray.phaseT >= ACTIVE_S) {
        ray.phase = 'fadeOut';
        ray.phaseT = 0;
      }
    } else if (ray.phase === 'fadeOut') {
      ray.phaseT += dt;
      if (ray.phaseT >= FADE_OUT_S) {
        events.emit('rayFaded', { index: ray.index });
        this._consecutiveFades += 1;
        if (this._consecutiveFades >= 2) {
          this._headFallbackEnabled = true;
        }
        this._ray = null;
        this._scheduleNextSpawn(t);
        return this._toState();
      }
    } else if (ray.phase === 'taken') {
      ray.takenT += dt;
      ray.taken = Math.min(1, ray.takenT / TAKEN_ANIM_S);
      if (ray.takenT >= TAKEN_ANIM_S) {
        this._ray = null;
        this._scheduleNextSpawn(t);
        return this._toState();
      }
    }

    return this._toState();
  }

  _checkTake(dt, sample, ray, journey) {
    if (!sample) return;
    const handL = sample.handL;
    const handR = sample.handR;

    let handHit = false;
    if (handL && handL.present > 0.5 && dist(handL.x, handL.y, ray.x, ray.y) < HAND_TAKE_DIST) {
      handHit = true;
    }
    if (handR && handR.present > 0.5 && dist(handR.x, handR.y, ray.x, ray.y) < HAND_TAKE_DIST) {
      handHit = true;
    }

    if (handHit) {
      ray.holdMs += dt * 1000;
    } else {
      ray.holdMs = 0;
    }

    let headHit = false;
    if (this._headFallbackEnabled && sample.head) {
      const head = sample.head;
      if (dist(head.x * HEAD_SCALE, head.y * HEAD_SCALE, ray.x, ray.y) < HEAD_TAKE_DIST) {
        headHit = true;
      }
    }
    if (headHit) {
      ray.headHoldMs += dt * 1000;
    } else {
      ray.headHoldMs = 0;
    }

    if (ray.holdMs >= HAND_TAKE_MS || ray.headHoldMs >= HEAD_TAKE_MS) {
      this._takeRay(ray, journey);
    }
  }

  _takeRay(ray, journey) {
    ray.phase = 'taken';
    ray.phaseT = 0;
    ray.takenT = 0;
    ray.taken = 0;
    this._consecutiveFades = 0;

    const { question, deckIndex } = this._drawQuestion();
    events.emit('rayTaken', { question, deckIndex });
    if (journey) journey.addLight(0.15);
  }

  _toState() {
    if (!this._ray) return [];
    const ray = this._ray;
    let alpha = 1;
    if (ray.phase === 'fadeIn') alpha = ray.phaseT / FADE_IN_S;
    else if (ray.phase === 'fadeOut') alpha = 1 - ray.phaseT / FADE_OUT_S;

    return [
      {
        x: ray.x,
        y: ray.y,
        taken: ray.taken,
        active: Math.max(0, Math.min(1, alpha)),
      },
    ];
  }
}

// Fisher-Yates shuffle, returns a new array.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
