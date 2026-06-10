export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) this._listeners.delete(event);
    }
  }

  emit(event, payload) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(cb => {
        try { cb(payload); }
        catch (e) { console.error(`EventBus error in "${event}":`, e); }
      });
    }
  }
}

export const eventBus = new EventBus();
