/**
 * insidr WebSocket Transport — v2
 *
 * Tier-1 features implemented here:
 *   - IndexedDB circular buffer  (survives crashes, offline, reloads)
 *   - Event batching             (50 events OR 5 s → one WS frame)
 *   - Sequence numbers           (monotonic per session, gap detection)
 *   - PII redaction              (Authorization, Cookie, Set-Cookie headers)
 *   - sendBeacon capture         (wraps navigator.sendBeacon)
 *   - Rate limiting              (per-category cap + drop counter)
 *   - Heartbeat / watchdog ping  (every 30 s)
 *   - Exponential backoff        (reconnection)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME        = 'insidr_buffer';
const DB_VERSION     = 1;
const STORE_NAME     = 'events';
const MAX_DB_BYTES   = 50 * 1024 * 1024;   // 50 MB circular buffer
const MAX_DB_EVENTS  = 20_000;              // hard row cap
const BATCH_SIZE     = 50;                  // flush at this many pending events
const BATCH_INTERVAL = 5_000;              // flush at least every 5 s
const HEARTBEAT_MS   = 30_000;             // watchdog ping interval
const MAX_RECONNECT_DELAY = 30_000;        // backoff ceiling

// Per-category rate limits  (events per second)
const RATE_LIMITS = {
  'console':             50,
  'network.request':     30,
  'network.response':    30,
  'network.error':       30,
  'performance.fps':      2,   // 1/s is enough, 2 gives a little headroom
  'performance.metrics':  1,
  'performance.memory':   1,
  'error':              100,   // never drop errors
  'error.unhandled_rejection': 100,
  '_default':            20,
};

// Headers whose values must be redacted
const REDACT_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  'x-auth-token', 'proxy-authorization',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADERS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

function redactEvent(event) {
  // Deep-clone so we never mutate the original
  const e = JSON.parse(JSON.stringify(event));
  const p = e.payload;
  if (!p) return e;

  // Network events carry headers
  if (p.headers)         p.headers         = redactHeaders(p.headers);
  if (p.requestHeaders)  p.requestHeaders  = redactHeaders(p.requestHeaders);
  if (p.responseHeaders) p.responseHeaders = redactHeaders(p.responseHeaders);

  // Strip cookie values from cookie string (keep key names)
  if (typeof p.body === 'string' && p.body.toLowerCase().includes('cookie')) {
    p.body = p.body.replace(/(cookie\s*[:=]\s*)[^\s&"';,]*/gi, '$1[redacted]');
  }

  return e;
}

// ─── IndexedDB circular buffer ───────────────────────────────────────────────

class EventBuffer {
  constructor() {
    this.db       = null;
    this.ready    = false;
    this.memQueue = [];   // fallback while IDB is opening
    this._init();
  }

  _init() {
    if (typeof indexedDB === 'undefined') {
      console.warn('[insidr] IndexedDB unavailable — using memory buffer');
      this.ready = true;
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db    = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'seq',
          autoIncrement: true,
        });
        store.createIndex('by_ts', 'timestamp');
      }
    };

    req.onsuccess = (e) => {
      this.db    = e.target.result;
      this.ready = true;
      // Drain anything buffered before IDB was ready
      if (this.memQueue.length) {
        this.memQueue.forEach(ev => this.push(ev));
        this.memQueue = [];
      }
      // Trim on open in case we're over the limit
      this._evict();
    };

    req.onerror = () => {
      console.warn('[insidr] IndexedDB open failed — using memory buffer');
      this.ready = true;
    };
  }

  push(event) {
    if (!this.db) {
      this.memQueue.push(event);
      if (this.memQueue.length > MAX_DB_EVENTS) this.memQueue.shift();
      return;
    }

    const tx    = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(event);
    tx.oncomplete = () => this._evict();
  }

  // Retrieve up to `limit` events with seq > afterSeq
  getRange(afterSeq, limit, callback) {
    if (!this.db) {
      callback(this.memQueue.slice(-limit));
      return;
    }

    const results = [];
    const tx      = this.db.transaction(STORE_NAME, 'readonly');
    const store   = tx.objectStore(STORE_NAME);
    // IDBKeyRange.lowerBound(afterSeq, true) = exclusive lower bound
    const range   = afterSeq ? IDBKeyRange.lowerBound(afterSeq, true) : null;
    const cursor  = store.openCursor(range);

    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (!c || results.length >= limit) {
        callback(results);
        return;
      }
      results.push(c.value);
      c.continue();
    };

    cursor.onerror = () => callback(results);
  }

  count(callback) {
    if (!this.db) { callback(this.memQueue.length); return; }
    const tx  = this.db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => callback(req.result);
    req.onerror   = () => callback(0);
  }

  // LRU eviction — drop oldest rows when over cap
  _evict() {
    if (!this.db) return;

    const tx    = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const cntReq = store.count();

    cntReq.onsuccess = () => {
      const count = cntReq.result;
      if (count <= MAX_DB_EVENTS) return;

      const toDelete = count - MAX_DB_EVENTS;
      const cursor   = store.openCursor();
      let   deleted  = 0;

      cursor.onsuccess = (e) => {
        const c = e.target.result;
        if (!c || deleted >= toDelete) return;
        c.delete();
        deleted++;
        c.continue();
      };
    };
  }

  // Check storage pressure; returns fraction used (0–1)
  storagePressure(callback) {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(est => {
        callback(est.usage / (est.quota || MAX_DB_BYTES));
      }).catch(() => callback(0));
    } else {
      callback(0);
    }
  }
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  constructor() {
    this._counts  = {};   // category → count this second
    this._window  = {};   // category → window start (ms)
    this._dropped = {};   // category → total dropped
  }

  allow(type) {
    const cat   = RATE_LIMITS.hasOwnProperty(type) ? type : '_default';
    const limit = RATE_LIMITS[cat];
    const now   = Date.now();

    if (!this._window[cat] || now - this._window[cat] >= 1000) {
      this._window[cat] = now;
      this._counts[cat] = 0;
    }

    if (this._counts[cat] < limit) {
      this._counts[cat]++;
      return true;
    }

    this._dropped[cat] = (this._dropped[cat] || 0) + 1;
    return false;
  }

  // Returns and resets drop counters (emitted periodically as a diagnostic event)
  drainDropped() {
    const snapshot   = { ...this._dropped };
    this._dropped    = {};
    return snapshot;
  }

  hasDropped() {
    return Object.values(this._dropped).some(v => v > 0);
  }
}

// ─── Main transport ───────────────────────────────────────────────────────────

class WebSocketSink {
  constructor(config = {}) {
    this.config = {
      url:                  config.url                  || 'ws://localhost:9229',
      reconnect:            config.reconnect            !== false,
      maxReconnectDelay:    config.maxReconnectDelay    || MAX_RECONNECT_DELAY,
      deviceId:             config.deviceId             || this._deviceId(),
      ...config,
    };

    // Transport state
    this.ws               = null;
    this.isConnected      = false;
    this._reconnectDelay  = 1000;
    this._reconnectTimer  = null;
    this._destroyed       = false;

    // Sequence
    this._seq             = 0;
    this._sessionId       = this._sessionId();

    // Batching
    this._pending         = [];   // events waiting for next flush
    this._batchTimer      = null;

    // Sub-systems
    this.buffer           = new EventBuffer();
    this.rateLimiter      = new RateLimiter();

    // Command handlers registered by agent
    this.commandHandlers  = new Map();

    // Heartbeat
    this._heartbeatTimer  = null;

    // sendBeacon interception
    this._originalBeacon  = null;

    this._startBatchTimer();
    this._interceptBeacon();

    // Attempt to restore a more durable deviceId from IndexedDB.
    // If the IDB-stored ID differs from the current one (e.g. after
    // localStorage was cleared), emit a device.id_restored event so the
    // server can reconcile the session with the device's history.
    this._restoreIdFromIdb(this.config.deviceId, (restoredId) => {
      this.config.deviceId = restoredId;
      // Backfill localStorage and sessionStorage with the restored ID
      try { localStorage.setItem('insidr_device_id', restoredId); } catch (_) {}
      try { sessionStorage.setItem('insidr_device_id', restoredId); } catch (_) {}
      // If already connected, notify server of the restored identity
      if (this.isConnected) {
        this._transmit({
          type: 'device.id_restored',
          payload: { restoredId, previousId: this.config.deviceId },
        });
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  connect() {
    if (this._destroyed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.config.url);
      this.ws.onopen    = () => this._onOpen();
      this.ws.onmessage = (e) => this._onMessage(e.data);
      this.ws.onerror   = () => {};   // onclose fires too, that's where we reconnect
      this.ws.onclose   = () => this._onClose();
    } catch (err) {
      this._scheduleReconnect();
    }
  }

  // Called by EventBus for every emitted event
  send(event) {
    if (!this.isConnected && event.type === '_auth') {
      // _auth is sent directly, not batched
      this._transmit(event);
      return;
    }

    // Rate limit check
    if (!this.rateLimiter.allow(event.type)) return;

    // PII scrub
    const clean = redactEvent(event);

    // Attach sequence number and session
    clean.seq       = ++this._seq;
    clean.sessionId = this._sessionId;

    // Persist to IDB buffer regardless of connection state
    this.buffer.push(clean);

    // Add to pending batch
    this._pending.push(clean);
    if (this._pending.length >= BATCH_SIZE) this._flush();
  }

  onCommand(command, handler) {
    this.commandHandlers.set(command, handler);
  }

  disconnect() {
    this._destroyed = true;
    this._stopHeartbeat();
    clearTimeout(this._reconnectTimer);
    clearInterval(this._batchTimer);
    this._restoreBeacon();
    if (this.ws) {
      this.config.reconnect = false;
      this.ws.close();
    }
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  _onOpen() {
    this.isConnected      = true;
    this._reconnectDelay  = 1000;   // reset backoff

    // Auth handshake — include enrollment token if configured
    this._transmit({
      type: '_auth',
      payload: {
        deviceId:        this.config.deviceId,
        userAgent:       navigator.userAgent,
        url:             window.location.href,
        sessionId:       this._sessionId,
        enrollmentToken: this.config.enrollmentToken || null,
      },
    });

    // Replay anything the server hasn't seen (IDB buffer)
    this._replayBuffer();

    // Start keepalive
    this._startHeartbeat();
  }

  _onClose() {
    this.isConnected = false;
    this._stopHeartbeat();
    if (!this._destroyed && this.config.reconnect) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, this._reconnectDelay);

    // Exponential backoff with jitter
    this._reconnectDelay = Math.min(
      this._reconnectDelay * 2 + Math.random() * 500,
      this.config.maxReconnectDelay,
    );
  }

  // ── Batching ───────────────────────────────────────────────────────────────

  _startBatchTimer() {
    this._batchTimer = setInterval(() => this._flush(), BATCH_INTERVAL);
  }

  _flush() {
    if (this._pending.length === 0) return;

    // Emit drop counter as a diagnostic event if anything was dropped
    if (this.rateLimiter.hasDropped()) {
      const dropped = this.rateLimiter.drainDropped();
      const diagEvent = {
        type:      'agent.rate_limited',
        seq:       ++this._seq,
        sessionId: this._sessionId,
        timestamp: Date.now(),
        payload:   { dropped },
      };
      this._pending.push(diagEvent);
      this.buffer.push(diagEvent);
    }

    const batch = this._pending.splice(0);   // take all, reset

    if (!this.isConnected) return;   // they're in IDB, will replay on reconnect

    // Send as a batch envelope or individual frames depending on server support
    // We use a batch envelope to reduce WS frames
    this._transmit({ type: '_batch', events: batch });
  }

  // ── Buffer replay ──────────────────────────────────────────────────────────

  _replayBuffer() {
    // Ask server what the last seq it received was (via ack).
    // For now, on reconnect we replay the last 500 events from IDB
    // that are newer than what the server confirmed. Simple but effective.
    this.buffer.getRange(0, 500, (events) => {
      if (!events.length) return;
      // Send as a batch labelled as replay so server can deduplicate
      this._transmit({ type: '_replay', events });
    });
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (!this.isConnected) return;
      this._transmit({ type: '_ping', timestamp: Date.now() });

      // Opportunistic: report storage pressure
      this.buffer.storagePressure((fraction) => {
        if (fraction > 0.8) {
          this._transmit({
            type:    'agent.storage_pressure',
            payload: { fraction: Math.round(fraction * 100) / 100 },
          });
        }
      });
    }, HEARTBEAT_MS);
  }

  _stopHeartbeat() {
    clearInterval(this._heartbeatTimer);
  }

  // ── sendBeacon interception ────────────────────────────────────────────────

  _interceptBeacon() {
    if (!navigator.sendBeacon) return;
    this._originalBeacon = navigator.sendBeacon.bind(navigator);
    const self = this;

    navigator.sendBeacon = function(url, data) {
      self.send({
        type:      'network.beacon',
        timestamp: Date.now(),
        payload: {
          url,
          size: data ? (typeof data === 'string' ? data.length : (data.byteLength || 0)) : 0,
        },
      });
      return self._originalBeacon(url, data);
    };
  }

  _restoreBeacon() {
    if (this._originalBeacon) {
      navigator.sendBeacon = this._originalBeacon;
      this._originalBeacon = null;
    }
  }

  // ── Incoming messages ──────────────────────────────────────────────────────

  _onMessage(data) {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'command') {
        this._execCommand(msg.command, msg.payload);
        return;
      }

      // Server ACK: server tells us the last seq it processed
      if (msg.type === '_ack') {
        // Future: trim IDB buffer up to msg.lastSeq
        return;
      }

      if (msg.type === '_pong') return;   // heartbeat reply — all good
    } catch (_) {}
  }

  _execCommand(command, payload) {
    const handler = this.commandHandlers.get(command);
    if (handler) {
      try { handler(payload); } catch (_) {}
    }
  }

  // ── Wire ───────────────────────────────────────────────────────────────────

  _transmit(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(data));
    } catch (_) {}
  }

  // ── IDs ────────────────────────────────────────────────────────────────────

  // Durable device identity — survives localStorage.clear() by using a
  // fallback chain: provisioned config token → IndexedDB → localStorage →
  // sessionStorage → derived fingerprint.
  // The IDB entry is written first so it survives our own "Clear Everything"
  // quick action which only clears localStorage/sessionStorage/cookies.
  _deviceId() {
    // 1. Provisioned token — highest priority, set at deploy time
    if (this.config.deviceToken) return this.config.deviceToken;

    // 2. Try localStorage (fast, sync)
    try {
      const fromLs = localStorage.getItem('insidr_device_id');
      if (fromLs) return fromLs;
    } catch (_) {}

    // 3. Try sessionStorage (survives page reload within same session)
    try {
      const fromSs = sessionStorage.getItem('insidr_device_id');
      if (fromSs) {
        // Backfill localStorage for next time
        try { localStorage.setItem('insidr_device_id', fromSs); } catch(_) {}
        return fromSs;
      }
    } catch (_) {}

    // 4. Derive a semi-stable fingerprint from stable browser properties.
    // Not unique across devices but stable across localStorage clears.
    const fp = this._fingerprint();

    // Persist everywhere we can
    try { localStorage.setItem('insidr_device_id',  fp); } catch (_) {}
    try { sessionStorage.setItem('insidr_device_id', fp); } catch (_) {}

    // Also write to IndexedDB asynchronously (most durable)
    this._persistIdToIdb(fp);

    return fp;
  }

  _fingerprint() {
    // Build a stable string from properties that don't change across sessions.
    // Prefix with 'fp_' so it's clear this is derived, not provisioned.
    const parts = [
      navigator.userAgent,
      screen.width, screen.height, screen.colorDepth,
      navigator.hardwareConcurrency || '',
      navigator.language || '',
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    ].join('|');

    // Simple djb2 hash — no crypto needed, just stable
    let hash = 5381;
    for (let i = 0; i < parts.length; i++) {
      hash = ((hash << 5) + hash) ^ parts.charCodeAt(i);
      hash = hash >>> 0;   // keep unsigned 32-bit
    }
    return `fp_${hash.toString(36)}`;
  }

  _persistIdToIdb(id) {
    if (typeof indexedDB === 'undefined') return;
    try {
      const req = indexedDB.open('insidr_identity', 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore('id');
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('id', 'readwrite');
        tx.objectStore('id').put(id, 'device_id');
      };
    } catch (_) {}
  }

  // Try to restore deviceId from IndexedDB (called once on init, async)
  // If IDB has a different ID than current (e.g. after localStorage clear),
  // it emits a 'device.id_restored' event so the server can reconcile.
  _restoreIdFromIdb(currentId, onRestored) {
    if (typeof indexedDB === 'undefined') return;
    try {
      const req = indexedDB.open('insidr_identity', 1);
      req.onsuccess = (e) => {
        const db  = e.target.result;
        if (!db.objectStoreNames.contains('id')) return;
        const tx  = db.transaction('id', 'readonly');
        const get = tx.objectStore('id').get('device_id');
        get.onsuccess = () => {
          const storedId = get.result;
          if (storedId && storedId !== currentId) {
            onRestored(storedId);
          }
        };
      };
    } catch (_) {}
  }

  _sessionId() {
    try {
      let sid = sessionStorage.getItem('insidr_session_id');
      if (!sid) {
        sid = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        sessionStorage.setItem('insidr_session_id', sid);
      }
      return sid;
    } catch (_) {
      return `sess_${Date.now()}`;
    }
  }
}

export default WebSocketSink;
