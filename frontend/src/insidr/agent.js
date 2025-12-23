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
      enabled: true,
      captureConsole: true,
      captureNetwork: true,
      captureErrors: true,
      capturePerformance: true,
      maxEventQueueSize: 1000,
      ...config
    };

    this.eventBus = new EventBus();
    this.instrumentations = [];
    this.isInitialized = false;
  }

  /**
   * Initialize the agent and start capturing
   */
  init() {
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

    // Start all instrumentations
    this.instrumentations.forEach(inst => inst.start());

    this.isInitialized = true;

    // Emit agent started event
    this.eventBus.emit({
      type: 'agent.started',
      payload: {
        config: this.config,
        userAgent: navigator.userAgent,
        url: window.location.href
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
            body: responseBody,
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
        
        self.eventBus.emit({
          type: 'network.request',
          payload: { requestId, url, method }
        });
        
        return originalOpen.apply(this, arguments);
      };

      xhr.addEventListener('load', function() {
        self.eventBus.emit({
          type: 'network.response',
          payload: {
            requestId,
            status: xhr.status,
            statusText: xhr.statusText,
            body: xhr.responseText,
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
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);

    this.handlers = [errorHandler, unhandledRejectionHandler];
    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;

    window.removeEventListener('error', this.handlers[0]);
    window.removeEventListener('unhandledrejection', this.handlers[1]);

    this.isActive = false;
  }
}

// Performance Instrumentation
class PerformanceInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.intervals = [];
    this.isActive = false;
  }

  start() {
    if (this.isActive) return;

    // Emit performance metrics periodically
    const metricsInterval = setInterval(() => {
      const metrics = {
        memory: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        } : null,
        timing: performance.timing ? {
          loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
          domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart
        } : null
      };

      this.eventBus.emit({
        type: 'performance.metrics',
        payload: metrics
      });
    }, 5000);

    this.intervals.push(metricsInterval);
    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;

    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    this.isActive = false;
  }
}

// Device Instrumentation
class DeviceInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.intervals = [];
    this.isActive = false;
  }

  start() {
    if (this.isActive) return;

    // Emit device info once
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
    window.addEventListener('online', () => {
      this.eventBus.emit({
        type: 'device.online',
        payload: { online: true }
      });
    });

    window.addEventListener('offline', () => {
      this.eventBus.emit({
        type: 'device.offline',
        payload: { online: false }
      });
    });

    this.isActive = true;
  }

  stop() {
    this.isActive = false;
  }
}

// Export as singleton
const insidr = new InsidrAgent();

if (typeof window !== 'undefined') {
  window.insidr = insidr;
}

export default insidr;
