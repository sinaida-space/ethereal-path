// events.js — tiny event bus singleton consumed by #audio and #ui.
//
// Emitted event types (payload shapes are the contract; do not rename):
//   raySpawn   { index }
//   rayTaken   { question, deckIndex }
//   rayFaded   { index }
//   actChange  { act: 1|2|3|'return' }
//   cue        { text }
//   sessionEnd {}

class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(type, fn) {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(fn);
  }

  off(type, fn) {
    const set = this._listeners.get(type);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) this._listeners.delete(type);
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    // Copy to array so a listener removing itself mid-emit is safe.
    for (const fn of Array.from(set)) {
      fn(payload);
    }
  }
}

export const events = new EventBus();
