// audio.js — procedural feedback layer (#9). No assets, no soundtrack:
// a barely-there noise/drone bed plus soft one-shot voices on bus events.
// If the user notices the music, it's too loud — the session's real
// soundtrack is their own breathing.
//
// All synthesis begins only after init(), which must be called from a user
// gesture (the splash "Begin" click) because AudioContext requires one.

import { events } from './events.js';

// Pentatonic set for rayTaken bells — random picks can never clash.
const BELL_HZ = [523.25, 587.33, 659.25, 783.99, 880.0];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._master = null;
    this._bedGain = null;
    this._bedFilter = null;
    this._shimmerIn = null;
    this._act = 1;
  }

  // Idempotent. Creates/resumes the context, builds the graph, subscribes.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const ctx = this.ctx;

    // Master chain: everything -> masterGain -> soft limiter -> destination.
    this._master = ctx.createGain();
    this._master.gain.value = 0.7;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 12;
    this._master.connect(limiter);
    limiter.connect(ctx.destination);

    // Shimmer send: two feedback delays instead of a convolver — no impulse
    // asset, cheaper, warmer for bells.
    this._shimmerIn = ctx.createGain();
    this._shimmerIn.gain.value = 0.25;
    const dA = ctx.createDelay(1.0);
    const dB = ctx.createDelay(1.0);
    dA.delayTime.value = 0.31;
    dB.delayTime.value = 0.47;
    const fbA = ctx.createGain();
    const fbB = ctx.createGain();
    fbA.gain.value = 0.35;
    fbB.gain.value = 0.35;
    this._shimmerIn.connect(dA);
    this._shimmerIn.connect(dB);
    dA.connect(fbA);
    fbA.connect(dA);
    dB.connect(fbB);
    fbB.connect(dB);
    dA.connect(this._master);
    dB.connect(this._master);

    this._buildBed();
    this._subscribe();
  }

  setMuted(m) {
    this.muted = !!m;
    if (this._master && this.ctx) {
      const t = this.ctx.currentTime;
      this._master.gain.cancelScheduledValues(t);
      this._master.gain.setTargetAtTime(this.muted ? 0 : 0.7, t, 0.15);
    }
  }

  stop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._master.gain.setTargetAtTime(0, t, 0.6);
    setTimeout(() => {
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
    }, 2000);
  }

  // ---- bed: pink-ish noise + detuned low drone pair, act-tinted ----
  _buildBed() {
    const ctx = this.ctx;

    // 2s looped noise buffer, lowpassed to a distant wash.
    const len = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // cheap pink-ish: one-pole lowpassed white noise
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
      data[i] = last * 8;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    this._bedFilter = ctx.createBiquadFilter();
    this._bedFilter.type = 'lowpass';
    this._bedFilter.frequency.value = 320;
    this._bedFilter.Q.value = 0.5;

    this._bedGain = ctx.createGain();
    this._bedGain.gain.value = 0.018;

    // Slow amplitude LFO ±30% at 0.09Hz.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.018 * 0.3;
    lfo.connect(lfoGain);
    lfoGain.connect(this._bedGain.gain);

    noise.connect(this._bedFilter);
    this._bedFilter.connect(this._bedGain);
    this._bedGain.connect(this._master);

    // Detuned drone pair at 55Hz for slow beating.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.012;
    for (const cents of [0, 3]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 55;
      osc.detune.value = cents;
      osc.connect(droneGain);
      osc.start();
    }
    droneGain.connect(this._master);

    noise.start();
    lfo.start();
  }

  _bedForAct(act) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const scale = act === 2 ? 0.8 : act === 3 ? 1.1 : act === 'return' ? 1.3 : 1.0;
    this._bedGain.gain.setTargetAtTime(0.018 * scale, t, 2.0);
    this._bedFilter.frequency.setTargetAtTime(act === 'return' ? 600 : 320, t, 2.0);
  }

  // ---- one-shot voices (created per event, disconnected on ended) ----
  _tone(freq, peak, attack, release, dest, type = 'sine') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + attack + release + 0.1);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
    return osc;
  }

  _noiseSwell(centerHz, q, peak, riseS, fallS) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.ceil((riseS + fallS + 0.2) * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = centerHz;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + riseS);
    g.gain.exponentialRampToValueAtTime(0.0001, t + riseS + fallS);
    src.connect(bp);
    bp.connect(g);
    g.connect(this._master);
    src.start(t);
    src.stop(t + riseS + fallS + 0.1);
    src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); };
  }

  _bell() {
    const f = BELL_HZ[Math.floor(Math.random() * BELL_HZ.length)];
    // fundamental + inharmonic partials, long release, through the shimmer.
    const mix = this.ctx.createGain();
    mix.gain.value = 1.0;
    mix.connect(this._master);
    mix.connect(this._shimmerIn);
    this._tone(f, 0.12, 0.008, 4.0, mix);
    this._tone(f * 2.76, 0.12 * 0.25, 0.008, 3.2, mix);
    this._tone(f * 5.4, 0.12 * 0.08, 0.008, 2.0, mix);
    setTimeout(() => mix.disconnect(), 6000);
  }

  _subscribe() {
    events.on('rayTaken', () => { if (!this.muted) this._bell(); });
    events.on('raySpawn', () => {
      if (!this.muted) this._noiseSwell(1800, 2, 0.03, 1.0, 1.5);
    });
    // rayFaded: silence — no failure sounds, ever.
    events.on('actChange', ({ act }) => {
      this._act = act;
      this._bedForAct(act);
      if (this.muted) return;
      // Low swell: 110Hz gliding down to 82.4Hz.
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.linearRampToValueAtTime(82.4, t + 3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 2.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5.0);
      osc.connect(g);
      g.connect(this._master);
      osc.start(t);
      osc.stop(t + 5.2);
      osc.onended = () => { osc.disconnect(); g.disconnect(); };
    });
    events.on('cue', () => {
      if (!this.muted) this._tone(1046, 0.02, 0.005, 0.06, this._master);
    });
    events.on('sessionEnd', () => {
      if (this.muted) return;
      // Resolving triad, staggered entries, long release.
      [261.63, 329.63, 392.0].forEach((hz, i) => {
        setTimeout(() => {
          if (this.ctx) this._tone(hz, 0.06, 0.05, 6.0, this._master);
        }, i * 300);
      });
    });
  }
}

export const audio = new AudioEngine();
