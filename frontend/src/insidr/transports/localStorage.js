/**
 * Local Storage Sink
 * 
 * Stores events in localStorage for offline debugging
 * or when remote connection is unavailable.
 */

class LocalStorageSink {
  constructor(config = {}) {
    this.config = {
      key: config.key || 'insidr_events',
      maxEvents: config.maxEvents || 500,
      ...config
    };

    this.events = this.loadEvents();
  }

  /**
   * Send event to localStorage
   */
  send(event) {
    this.events.push(event);

    // Keep only recent events
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }

    this.saveEvents();
  }

  /**
   * Load events from localStorage
   */
  loadEvents() {
    try {
      const stored = localStorage.getItem(this.config.key);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('[insidr] Failed to load events:', error);
      return [];
    }
  }

  /**
   * Save events to localStorage
   */
  saveEvents() {
    try {
      localStorage.setItem(this.config.key, JSON.stringify(this.events));
    } catch (error) {
      console.error('[insidr] Failed to save events:', error);
    }
  }

  /**
   * Get all stored events
   */
  getEvents() {
    return this.events;
  }

  /**
   * Clear all stored events
   */
  clear() {
    this.events = [];
    localStorage.removeItem(this.config.key);
  }

  /**
   * Export events as JSON
   */
  exportJSON() {
    const dataStr = JSON.stringify(this.events, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `insidr-events-${Date.now()}.json`);
    link.click();
  }
}

export default LocalStorageSink;
