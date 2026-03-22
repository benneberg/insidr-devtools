import { SnapshotInstrumentation } from './snapshot.js';

/**
 * insidr Core Agent
 * 
 * Event-driven debugging agent that captures all debugging signals
 * and emits them as structured events through the Event Bus.
 * 
 * Architecture:
 * - Instrumentation: Captures console, network, errors, performance
 * - Event Bus: Central pub/sub for all events
 * - Transport Sinks: Pluggable outputs (WebSocket, localStorage, etc.)
 * - UI-agnostic: Frontend consumes events, never collects them
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.sinks = [];
  }

  /**
   * Subscribe to specific event types
   */
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(callback);
    
    return () => this.off(eventType, callback);
  }

  /**
   * Unsubscribe from event type
   */
  off(eventType, callback) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to all listeners and sinks
   */
  emit(event) {
    // Add metadata
    const enrichedEvent = {
      ...event,
      timestamp: Date.now(),
      sessionId: this.getSessionId()
    };

    // Notify type-specific listeners
    const callbacks = this.listeners.get(event.type);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(enrichedEvent);
        } catch (error) {
          console.error('Event listener error:', error);
        }
      });
    }

    // Send to all sinks
    this.sinks.forEach(sink => {
      try {
        sink.send(enrichedEvent);
      } catch (error) {
        console.error('Sink error:', error);
      }
    });
  }

  /**
   * Register a transport sink
   */
  addSink(sink) {
    this.sinks.push(sink);
  }

  /**
   * Remove a transport sink
   */
  removeSink(sink) {
    const index = this.sinks.indexOf(sink);
    if (index > -1) {
      this.sinks.splice(index, 1);
    }
  }

  /**
   * Get or create session ID
   */
  getSessionId() {
    let sessionId = sessionStorage.getItem('insidr_session_id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('insidr_session_id', sessionId);
    }
    return sessionId;
  }
}

class InsidrAgent {
  constructor(config = {}) {
    this.config = {
      enabled:          true,
      captureConsole:   true,
      captureNetwork:   true,
      captureErrors:    true,
      capturePerformance: true,
      captureSnapshots: true,   // canvas snapshot instrumentation
      snapshotQuality:  0.65,
      snapshotScheduleMinutes: 0,   // 0 = disabled
      maxEventQueueSize: 1000,
      ...config
    };

    this.eventBus = new EventBus();
    this.instrumentations = [];
    this.isInitialized = false;
  }

  /**
   * Initialize the agent and start capturing.
   * Pass a pre-created WebSocketSink instance as `sink`.
   */
  init(sink = null) {
    if (this.isInitialized) return;

    if (this.config.captureConsole) {
      this.instrumentations.push(new ConsoleInstrumentation(this.eventBus));
    }
    if (this.config.captureNetwork) {
      this.instrumentations.push(new NetworkInstrumentation(this.eventBus));
    }
    if (this.config.captureErrors) {
      this.instrumentations.push(new ErrorInstrumentation(this.eventBus));
    }
    if (this.config.capturePerformance) {
      this.instrumentations.push(new PerformanceInstrumentation(this.eventBus));
    }
    this.instrumentations.push(new DeviceInstrumentation(this.eventBus));
    this.instrumentations.push(new PageLifecycleInstrumentation(this.eventBus));

    // Degradation manager — adjusts behaviour based on network/battery state
    this.degradationManager = new DegradationManager(this.eventBus);
    this.degradationManager.start();

    if (this.config.captureSnapshots) {
      this.snapshotInst = new SnapshotInstrumentation(this.eventBus, {
        quality:         this.config.snapshotQuality,
        scheduleMinutes: this.config.snapshotScheduleMinutes,
      });
      this.instrumentations.push(this.snapshotInst);
    }

    // Wire transport sink
    if (sink) {
      this.sink = sink;
      this.eventBus.addSink(sink);

      // Standard remote command handlers
      sink.onCommand('agent.reload',   () => window.location.reload());
      sink.onCommand('agent.enable',   () => this.setEnabled(true));
      sink.onCommand('agent.disable',  () => this.setEnabled(false));
      sink.onCommand('agent.maintenance', (payload) => {
        if (this.degradationManager) {
          this.degradationManager.setMaintenance(payload?.active !== false);
        }
      });
      sink.onCommand('snapshot.take', () => {
        if (this.snapshotInst) this.snapshotInst.capture('command');
      });
      sink.onCommand('snapshot.schedule', (payload) => {
        if (this.snapshotInst && payload && payload.minutes !== undefined) {
          this.snapshotInst.setSchedule(payload.minutes);
        }
      });
      sink.onCommand('script.execute', (payload) => {
        if (!payload || !payload.code) return;
        try {
          const result = eval(payload.code); // eslint-disable-line no-eval
          const emit = (r) => this.eventBus.emit({
            type: 'script.result',
            payload: { success: true, result: String(r) }
          });
          (result && typeof result.then === 'function') ? result.then(emit) : emit(result);
        } catch (err) {
          this.eventBus.emit({
            type: 'script.result',
            payload: { success: false, error: err.message }
          });
        }
      });
    }

    this.instrumentations.forEach(inst => inst.start());
    this.isInitialized = true;

    this.eventBus.emit({
      type: 'agent.started',
      payload: {
        config:    this.config,
        userAgent: navigator.userAgent,
        url:       window.location.href,
      }
    });
  }

  /**
   * Enable/disable debugging dynamically
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    
    if (enabled) {
      this.instrumentations.forEach(inst => inst.start());
    } else {
      this.instrumentations.forEach(inst => inst.stop());
    }

    this.eventBus.emit({
      type: 'agent.config_changed',
      payload: { enabled }
    });
  }

  /**
   * Get the event bus for subscribing
   */
  getEventBus() {
    return this.eventBus;
  }

  /**
   * Shutdown the agent
   */
  shutdown() {
    this.instrumentations.forEach(inst => inst.stop());
    if (this.degradationManager) this.degradationManager.stop();
    this.eventBus.emit({
      type: 'agent.shutdown',
      payload: {}
    });
    this.isInitialized = false;
  }
}

// Console Instrumentation
class ConsoleInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.originalMethods = {};
    this.isActive = false;
  }

  start() {
    if (this.isActive) return;

    ['log', 'warn', 'error', 'info', 'debug'].forEach(method => {
      this.originalMethods[method] = console[method];
      
      console[method] = (...args) => {
        this.eventBus.emit({
          type: 'console',
          payload: {
            level: method,
            args: args.map(arg => 
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ),
            stack: new Error().stack
          }
        });

        this.originalMethods[method].apply(console, args);
      };
    });

    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;

    Object.keys(this.originalMethods).forEach(method => {
      console[method] = this.originalMethods[method];
    });

    this.isActive = false;
  }
}

// Network Instrumentation
class NetworkInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.originalFetch = null;
    this.originalXHR = null;
    this.isActive = false;
  }

  start() {
    if (this.isActive) return;

    // Intercept fetch
    this.originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const startTime = performance.now();
      
      const url = typeof args[0] === 'string' ? args[0] : args[0].url;
      const method = args[1]?.method || 'GET';

      this.eventBus.emit({
        type: 'network.request',
        payload: {
          requestId,
          url,
          method,
          headers: args[1]?.headers || {},
          body: args[1]?.body || null
        }
      });

      try {
        const response = await this.originalFetch.apply(window, args);
        const duration = performance.now() - startTime;

        const clonedResponse = response.clone();
        const responseBody = await clonedResponse.text();

        this.eventBus.emit({
          type: 'network.response',
          payload: {
            requestId,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            responseBody,
            body: responseBody,   // alias — both fields present
            duration,
            size: new Blob([responseBody]).size
          }
        });

        return response;
      } catch (error) {
        this.eventBus.emit({
          type: 'network.error',
          payload: {
            requestId,
            error: error.message,
            duration: performance.now() - startTime
          }
        });
        throw error;
      }
    };

    // Intercept XMLHttpRequest
    const self = this;
    this.originalXHR = window.XMLHttpRequest;
    
    window.XMLHttpRequest = function() {
      const xhr = new self.originalXHR();
      const requestId = `xhr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let startTime;

      const originalOpen = xhr.open;
      xhr.open = function(method, url) {
        startTime = performance.now();
        xhr._insidrUrl = url;
        xhr._insidrMethod = method;
        
        self.eventBus.emit({
          type: 'network.request',
          payload: { requestId, url, method }
        });
        
        return originalOpen.apply(this, arguments);
      };

      xhr.addEventListener('load', function() {
        const responseBody = xhr.responseText || '';
        self.eventBus.emit({
          type: 'network.response',
          payload: {
            requestId,
            url: xhr._insidrUrl,
            status: xhr.status,
            statusText: xhr.statusText,
            responseBody,
            body: responseBody,    // alias for detail panel
            size: new Blob([responseBody]).size,
            duration: performance.now() - startTime
          }
        });
      });

      xhr.addEventListener('error', function() {
        self.eventBus.emit({
          type: 'network.error',
          payload: {
            requestId,
            error: 'Network error',
            duration: performance.now() - startTime
          }
        });
      });

      return xhr;
    };

    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;

    if (this.originalFetch) {
      window.fetch = this.originalFetch;
    }

    if (this.originalXHR) {
      window.XMLHttpRequest = this.originalXHR;
    }

    this.isActive = false;
  }
}

// Error Instrumentation
class ErrorInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.handlers = [];
    this.isActive = false;
  }

  start() {
    if (this.isActive) return;

    const errorHandler = (event) => {
      this.eventBus.emit({
        type: 'error',
        payload: {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error ? {
            name: event.error.name,
            message: event.error.message,
            stack: event.error.stack
          } : null
        }
      });
    };

    const unhandledRejectionHandler = (event) => {
      this.eventBus.emit({
        type: 'error.unhandled_rejection',
        payload: {
          reason: event.reason,
          promise: String(event.promise)
        }
      });
    };

    window.addEventListener('error', errorHandler);
    const mediaErrorHandler = (e) => {
      const el = e.target;

      if (!el || !el.tagName) return;

      if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
        this.eventBus.emit({
          type: 'media.error',
          payload: {
            tag: el.tagName,
            src: el.currentSrc || el.src,
            networkState: el.networkState,
            readyState: el.readyState,
            error: el.error ? {
              code: el.error.code,
              message: el.error.message
            } : null
          }
        });
      }
    };

    document.addEventListener("error", mediaErrorHandler, true);    
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);
    this.handlers = [errorHandler, unhandledRejectionHandler, mediaErrorHandler];
    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;

    window.removeEventListener('error', this.handlers[0]);
    window.removeEventListener('unhandledrejection', this.handlers[1]);
    document.removeEventListener('error', this.handlers[2], true);

    this.isActive = false;
  }
}

// Performance Instrumentation
// Reacts to DegradationManager mode changes:
//   OFFLINE     → stop FPS rAF (no point tracking FPS when buffering only)
//                 keep metrics interval so memory pressure is still visible
//   LOW_POWER   → throttle metrics interval from 5s → 30s, stop FPS rAF
//   NORMAL      → restore defaults
//   MAINTENANCE → stop everything (admin flag)
class PerformanceInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.intervals = [];
    this.isActive = false;
    this._modeHandler = null;
    this._currentMode = 'NORMAL';
  }

  start() {
    if (this.isActive) return;

    this._startFps();
    this._startMetrics(5000);

    // Listen for degradation mode changes and adjust capture accordingly
    this._modeHandler = this.eventBus.on('agent.mode_changed', (event) => {
      const mode = event.payload?.mode;
      this._currentMode = mode;

      if (mode === 'OFFLINE' || mode === 'LOW_POWER') {
        // Stop rAF — no value tracking FPS when offline or battery-constrained
        this._stopFps();
        // Throttle metrics to 30s in LOW_POWER, stop entirely in MAINTENANCE
        this._stopMetrics();
        if (mode === 'LOW_POWER') this._startMetrics(30000);
        // OFFLINE: keep metrics running at normal rate so memory pressure visible
        if (mode === 'OFFLINE') this._startMetrics(5000);
      } else if (mode === 'MAINTENANCE') {
        this._stopFps();
        this._stopMetrics();
      } else {
        // NORMAL — restore full capture
        this._stopFps();
        this._stopMetrics();
        this._startFps();
        this._startMetrics(5000);
      }
    });

    this.isActive = true;
  }

  _startFps() {
    if (this.rafId) return;
    let frameCount = 0;
    let lastFpsTime = performance.now();
    const countFrame = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        const fps = Math.round(frameCount * 1000 / (now - lastFpsTime));
        this.eventBus.emit({ type: 'performance.fps', payload: { fps } });
        frameCount = 0;
        lastFpsTime = now;
      }
      this.rafId = requestAnimationFrame(countFrame);
    };
    this.rafId = requestAnimationFrame(countFrame);
  }

  _stopFps() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _startMetrics(intervalMs) {
    if (this._metricsInterval) return;
    this._metricsInterval = setInterval(() => {
      const memory = performance.memory ? {
        usedJSHeapSize:  performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      } : null;

      const timing = performance.timing ? {
        loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
        domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
      } : null;

      this.eventBus.emit({ type: 'performance.metrics', payload: { memory, timing, mode: this._currentMode } });

      if (memory) {
        this.eventBus.emit({ type: 'performance.memory', payload: memory });
      }
    }, intervalMs);
    this.intervals.push(this._metricsInterval);
  }

  _stopMetrics() {
    if (this._metricsInterval) {
      clearInterval(this._metricsInterval);
      this.intervals = this.intervals.filter(i => i !== this._metricsInterval);
      this._metricsInterval = null;
    }
  }

  stop() {
    if (!this.isActive) return;

    this._stopFps();
    this._stopMetrics();
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    if (this._modeHandler) { this._modeHandler(); this._modeHandler = null; }
    this.isActive = false;
  }
}

// Device Instrumentation
class DeviceInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.intervals = [];
    this.isActive = false;
    this._handlers = {};
  }

  start() {
    if (this.isActive) return;

    // Emit device info once on connect
    this.eventBus.emit({
      type: 'device.info',
      payload: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        onLine: navigator.onLine,
        cookieEnabled: navigator.cookieEnabled,
        screenResolution: `${screen.width}x${screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        deviceMemory: navigator.deviceMemory,
        hardwareConcurrency: navigator.hardwareConcurrency
      }
    });

    // Monitor online/offline
    this._handlers.online = () => {
      this.eventBus.emit({ type: 'device.online', payload: { online: true } });
    };
    this._handlers.offline = () => {
      this.eventBus.emit({ type: 'device.offline', payload: { online: false } });
    };
    window.addEventListener('online',  this._handlers.online);
    window.addEventListener('offline', this._handlers.offline);

    this.isActive = true;
  }

  stop() {
    window.removeEventListener('online',  this._handlers.online);
    window.removeEventListener('offline', this._handlers.offline);
    this.isActive = false;
  }
}

// ── Page Lifecycle Instrumentation ───────────────────────────────────────────
// Captures visibility changes, page hide/show, and battery state.
// Critical for signage: devices may be backgrounded, screens turned off,
// or the OS may suspend the page — all invisible to other instrumentation.

class PageLifecycleInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.isActive = false;
    this._handlers = {};
  }

  start() {
    if (this.isActive) return;

    // visibilitychange — fires when screen turns off or app is backgrounded
    this._handlers.visibilitychange = () => {
      this.eventBus.emit({
        type: 'page.visibility',
        payload: {
          visibilityState: document.visibilityState,
          hidden: document.hidden,
        },
      });
    };

    // pagehide — fires before unload / navigation / OS suspend
    this._handlers.pagehide = (e) => {
      this.eventBus.emit({
        type: 'page.hide',
        payload: {
          persisted: e.persisted,   // true = bfcache, false = being discarded
        },
      });
    };

    // pageshow — fires on initial load AND bfcache restore
    this._handlers.pageshow = (e) => {
      this.eventBus.emit({
        type: 'page.show',
        payload: {
          persisted: e.persisted,   // true = restored from bfcache
        },
      });
    };

    // freeze / resume — Page Lifecycle API (Chrome 68+, some WebOS versions)
    this._handlers.freeze = () => {
      this.eventBus.emit({ type: 'page.freeze', payload: {} });
    };
    this._handlers.resume = () => {
      this.eventBus.emit({ type: 'page.resume', payload: {} });
    };

    document.addEventListener('visibilitychange', this._handlers.visibilitychange);
    window.addEventListener('pagehide',  this._handlers.pagehide);
    window.addEventListener('pageshow',  this._handlers.pageshow);
    window.addEventListener('freeze',    this._handlers.freeze);
    window.addEventListener('resume',    this._handlers.resume);

    // Battery API — useful for knowing if signage device is on UPS/battery
    // Not universally available but gracefully absent
    if (navigator.getBattery) {
      navigator.getBattery().then((battery) => {
        const emitBattery = () => {
          this.eventBus.emit({
            type: 'device.battery',
            payload: {
              level:      Math.round(battery.level * 100),
              charging:   battery.charging,
              chargingTime: battery.chargingTime,
              dischargingTime: battery.dischargingTime,
            },
          });
        };
        emitBattery();   // emit current state immediately
        battery.addEventListener('levelchange',    emitBattery);
        battery.addEventListener('chargingchange', emitBattery);
        this._battery = battery;
        this._emitBattery = emitBattery;
      }).catch(() => {});   // not available — ignore
    }

    this.isActive = true;
  }

  stop() {
    document.removeEventListener('visibilitychange', this._handlers.visibilitychange);
    window.removeEventListener('pagehide',  this._handlers.pagehide);
    window.removeEventListener('pageshow',  this._handlers.pageshow);
    window.removeEventListener('freeze',    this._handlers.freeze);
    window.removeEventListener('resume',    this._handlers.resume);

    if (this._battery && this._emitBattery) {
      this._battery.removeEventListener('levelchange',    this._emitBattery);
      this._battery.removeEventListener('chargingchange', this._emitBattery);
    }

    this.isActive = false;
  }
}

// ── Graceful Degradation Mode Manager ────────────────────────────────────────
// Tracks operating mode and adjusts agent behaviour accordingly.
// Modes:
//   NORMAL      — full telemetry, default
//   OFFLINE     — no network; buffer locally, suspend non-critical captures
//   LOW_POWER   — slow network or low battery; throttle to keep bandwidth low
//   MAINTENANCE — set by server command; restrict remote actions
//
// The mode manager does NOT directly change transport settings — it emits
// a 'agent.mode_changed' event that the sink and instrumentation can react to.
// Currently: OFFLINE suspends performance.fps (rAF-heavy), LOW_POWER is noted.

class DegradationManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.mode = 'NORMAL';
    this._handlers = {};
  }

  start() {
    // React to network status
    this._handlers.offline = () => this._setMode('OFFLINE');
    this._handlers.online  = () => this._evaluateMode();

    window.addEventListener('offline', this._handlers.offline);
    window.addEventListener('online',  this._handlers.online);

    // React to connection quality if available
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      this._handlers.connchange = () => this._evaluateMode();
      conn.addEventListener('change', this._handlers.connchange);
      this._conn = conn;
    }

    this._evaluateMode();
  }

  stop() {
    window.removeEventListener('offline', this._handlers.offline);
    window.removeEventListener('online',  this._handlers.online);
    if (this._conn && this._handlers.connchange) {
      this._conn.removeEventListener('change', this._handlers.connchange);
    }
  }

  setMaintenance(active) {
    this._setMode(active ? 'MAINTENANCE' : 'NORMAL');
  }

  _evaluateMode() {
    if (!navigator.onLine) { this._setMode('OFFLINE'); return; }

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      const slowTypes = new Set(['slow-2g', '2g']);
      if (slowTypes.has(conn.effectiveType)) { this._setMode('LOW_POWER'); return; }
    }

    // Check battery
    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        if (!b.charging && b.level < 0.2) {
          this._setMode('LOW_POWER');
        } else {
          this._setMode('NORMAL');
        }
      }).catch(() => this._setMode('NORMAL'));
    } else {
      this._setMode('NORMAL');
    }
  }

  _setMode(newMode) {
    if (this.mode === newMode) return;
    const previous = this.mode;
    this.mode = newMode;
    this.eventBus.emit({
      type: 'agent.mode_changed',
      payload: { mode: newMode, previous },
    });
  }
}

// Export as singleton
const insidr = new InsidrAgent();

if (typeof window !== 'undefined') {
  window.insidr = insidr;
}

export default insidr;
