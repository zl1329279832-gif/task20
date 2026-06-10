import { eventBus } from './event-bus.js';
import { DEFAULT_STATE } from './constants.js';

class StateManager {
  constructor() {
    this._state = { ...DEFAULT_STATE };
    this._subscribers = new Set();
  }

  getState() {
    return { ...this._state };
  }

  setState(partial) {
    const prev = this._state;
    this._state = { ...this._state, ...partial };
    if (partial.timeRange) {
      this._state.timeRange = { ...prev.timeRange, ...partial.timeRange };
    }
    this._subscribers.forEach(cb => {
      try { cb(this._state, prev); }
      catch (e) { console.error('StateManager subscriber error:', e); }
    });
    eventBus.emit('state:updated', this._state);
  }

  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this._state));
  }

  restoreSnapshot(snapshot) {
    this._state = { ...DEFAULT_STATE, ...snapshot };
    this._subscribers.forEach(cb => cb(this._state, null));
    eventBus.emit('state:updated', this._state);
  }
}

export const stateManager = new StateManager();
