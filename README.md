# insidr

**Remote observability for digital signage and kiosk applications.**

![Version](https://img.shields.io/badge/version-1.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Python](https://img.shields.io/badge/python-3.10+-blue)
![React](https://img.shields.io/badge/react-18-blue)

insidr is a platform-independent remote debugging agent for web-based signage players. It streams console logs, network requests, errors, and performance telemetry from any Chromium-based device to a web dashboard — no ADB, no SDB, no developer mode, no same-network requirement.

> We are not building a debugger. We are building observability for an industry that never had it.

---

## The Problem

Debugging a signage player traditionally means:
- Enabling developer mode differently on every platform (LG WebOS, Samsung Tizen, BrightSign, Android, etc.)
- Being physically present or on the same network
- Using ADB or SDB which are vendor-specific and fragile
- Losing all logs the moment the browser crashes

insidr solves all of this with a single `<script>` tag.

---

## How It Works

```
[Signage Device]                    [Your Laptop / Server]
 HTML app + insidr agent  ──WS──►   debug_server.py
  captures everything                stores all events
  console, network, errors                ↕
  performance, device info          insidr dashboard
                                    (React web UI)
```

The agent runs inside your app and pushes structured events to the server over WebSocket. The server stores every event in SQLite. You open the dashboard in any browser and see everything in real time — or review the full history after a crash.

---

## Key Features

**Remote debugging without native tooling**
No ADB, SDB, Chrome DevTools Protocol, or developer mode required. Works on any device that runs a Chromium-based browser.

**Crash log persistence**
Every event is written to SQLite the moment it arrives. If the device browser crashes at 3am, the full event history — including the error that caused the crash — is still there when you open the dashboard in the morning. This is the "Heisenbug" feature: bugs that are caused by the act of observing them are no longer invisible.

**Remote script execution**
Run arbitrary JavaScript on the device from the dashboard. Useful for inspecting live state, manipulating the DOM, or injecting debug helpers.

**Soft breakpoints**
Inject `window.__insidrBreakpoint(label, data)` via remote script execution. Call it from your app to stream named state snapshots to the dashboard — similar to a breakpoint, but non-blocking and production-safe.

**Variable watchpoints**
Inject a watcher via `Object.defineProperty` to stream a notification every time a variable changes value.

**Platform independent**
Works on LG WebOS, Samsung Tizen, BrightSign, Android, Raspberry Pi, and any other platform running Chromium — including standard desktop browsers for development.

---

## Quick Start

### 1. Start the backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate  # Mac/Linux
pip install -r requirements.txt
python debug_server.py
```

You'll see:
```
Device WebSocket:     ws://0.0.0.0:9229
Subscriber WebSocket: ws://0.0.0.0:9230
HTTP API:             http://0.0.0.0:9231
Event persistence enabled: insidr_events.db
```

### 2. Start the dashboard

```bash
cd frontend
yarn install
yarn start
```

Open `http://localhost:3000` — you'll see the device list (empty for now).

### 3. Add the agent to your app

Add this as the **first script** in your signage app's `<head>`. Change the IP to your server's address.

```html
<script>
(function(config) {
  var SERVER_URL = config.serverUrl;
  var DEVICE_ID = (function() {
    try {
      var id = localStorage.getItem('__insidr_device_id');
      if (!id) { id = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2,8); localStorage.setItem('__insidr_device_id', id); }
      return id;
    } catch(e) { return 'device_' + Date.now(); }
  })();

  var ws, queue = [], connected = false, SESSION_ID = 'sess_' + Date.now();

  function emit(type, payload) {
    var e = { type: type, payload: payload, timestamp: Date.now(), sessionId: SESSION_ID, deviceId: DEVICE_ID };
    connected && ws && ws.readyState === 1 ? ws.send(JSON.stringify(e)) : queue.length < 200 && queue.push(e);
  }

  function connect() {
    try { ws = new WebSocket(SERVER_URL); } catch(e) { setTimeout(connect, 3000); return; }
    ws.onopen = function() {
      connected = true;
      ws.send(JSON.stringify({ type: '_auth', payload: { deviceId: DEVICE_ID, userAgent: navigator.userAgent, url: window.location.href } }));
      while(queue.length) ws.send(JSON.stringify(queue.shift()));
    };
    ws.onmessage = function(m) {
      try { var d = JSON.parse(m.data); if(d.type==='command') handleCommand(d.command, d.payload); } catch(e) {}
    };
    ws.onclose = function() { connected = false; setTimeout(connect, 3000); };
    ws.onerror = function() {};
  }

  function handleCommand(cmd, payload) {
    if(cmd==='agent.reload') window.location.reload();
    if(cmd==='script.execute' && payload && payload.code) {
      try { var r = eval(payload.code); emit('script.result', { success:true, result:String(r) }); }
      catch(e) { emit('script.result', { success:false, error:e.message }); }
    }
  }

  // Console
  ['log','warn','error','info','debug'].forEach(function(l) {
    var o = console[l]; console[l] = function() {
      var args = Array.prototype.slice.call(arguments);
      emit('console', { level:l, args:args.map(function(a){ return typeof a==='object'?JSON.stringify(a):String(a); }) });
      o.apply(console, arguments);
    };
  });

  // Errors
  window.addEventListener('error', function(e) { emit('error', { message:e.message, filename:e.filename, lineno:e.lineno, colno:e.colno }); });
  window.addEventListener('unhandledrejection', function(e) { emit('error.unhandled_rejection', { reason:String(e.reason) }); });

  // Network
  if(window.fetch) { var of=window.fetch; window.fetch=function() { var a=arguments,id='req_'+Date.now(),url=typeof a[0]==='string'?a[0]:(a[0]&&a[0].url)||'',m=(a[1]&&a[1].method)||'GET',t=performance.now(); emit('network.request',{requestId:id,url:url,method:m}); return of.apply(window,a).then(function(r){var c=r.clone();c.text().then(function(b){emit('network.response',{requestId:id,status:r.status,duration:Math.round(performance.now()-t),body:b.substr(0,4000)});});return r;}).catch(function(e){emit('network.error',{requestId:id,error:e.message});throw e;}); }; }

  // Device info
  emit('device.info', { userAgent:navigator.userAgent, platform:navigator.platform, screenResolution:screen.width+'x'+screen.height, viewport:window.innerWidth+'x'+window.innerHeight, language:navigator.language });

  connect();

})({ serverUrl: 'ws://192.168.1.x:9229' });  // ← replace with your server IP
</script>
```

The device will appear in the dashboard within seconds.

---

## Dashboard

### Device list
Shows all devices that have ever connected (including historical devices with stored event logs). Click any device to open its session.

### Session view
- **All / Console / Network / Errors / Performance** tabs filter the live event stream
- Click any event to expand the full payload
- Events are shown newest-first

### Script Runner
A collapsible panel at the bottom of every session. Write JavaScript and run it on the device with Ctrl+Enter. Built-in snippets include:

| Snippet | What it does |
|---------|-------------|
| Video status | Reads `readyState`, `networkState`, `error` from the first `<video>` |
| All videos | Lists all video elements and their state |
| Memory | Reports JS heap usage |
| localStorage | Dumps all localStorage keys and values |
| Install breakpt | Injects `window.__insidrBreakpoint(label, data)` into the running app |
| Watch variable | Installs an `Object.defineProperty` watcher that streams change notifications |
| Outline elements | Adds a red outline to every DOM element (useful for layout debugging) |
| Clear outlines | Removes outlines |

### Remote commands
- **Enable / Disable** — toggles event collection without reloading
- **Reload** — triggers `window.location.reload()` on the device

---

## Event Persistence (Heisenbug Feature)

All events are written to `insidr_events.db` (SQLite) in the backend directory the moment they arrive. This means:

- A device that crashes at 3am has its full event history available in the morning
- The last error before `agent.shutdown` is preserved
- Device history survives server restarts
- Historical devices appear in the device list with a `historical` flag

To disable persistence and use memory-only mode:
```bash
python debug_server.py --no-db
```

To use a custom database path:
```bash
python debug_server.py --db-path /var/log/insidr/events.db
```

---

## Architecture

```
frontend/
  src/
    App.js                  # Remote dashboard UI
    hooks/
      useRemoteSession.js   # WebSocket connection to server port 9230
    insidr/
      agent.js              # Embedded agent (used in local/embedded mode)
      transports/
        websocket.js        # WebSocket transport sink
        localStorage.js     # Local storage sink

backend/
  debug_server.py           # WebSocket relay + SQLite event store
  requirements.txt
```

**Ports:**
- `9229` — devices connect here (WebSocket)
- `9230` — dashboard connects here (WebSocket subscriber)
- `9231` — HTTP REST API (`/api/devices`, `/api/device/:id/events`)

---

## What You Can and Can't Debug Remotely

| Capability | insidr | Native DevTools |
|-----------|--------|----------------|
| Console logs (all levels) | ✅ | ✅ |
| Network requests + responses | ✅ | ✅ |
| JavaScript errors + stack traces | ✅ | ✅ |
| Performance metrics + memory | ✅ | ✅ |
| Device info + screen resolution | ✅ | ✅ |
| Remote script execution | ✅ | ✅ |
| Crash log persistence | ✅ | ❌ |
| Works without developer mode | ✅ | ❌ |
| Platform independent | ✅ | ❌ |
| Pause execution / breakpoints | ❌ | ✅ |
| Step through code | ❌ | ✅ |
| Edit live source files | ❌ | ✅ |

---

## Supported Platforms

Any device running a Chromium-based browser, including:

- LG WebOS (signageOS)
- Samsung Tizen (signageOS)
- BrightSign
- Android (Chrome, WebView)
- Raspberry Pi (Chromium)
- Windows / Mac / Linux (all browsers for development)

---

## Browser Compatibility

| Browser | Console | Network | Errors | Memory API |
|---------|---------|---------|--------|------------|
| Chrome 90+ | ✅ | ✅ | ✅ | ✅ |
| Edge 90+ | ✅ | ✅ | ✅ | ✅ |
| Firefox 88+ | ✅ | ✅ | ✅ | ❌ |
| Safari 14+ | ✅ | ✅ | ✅ | ❌ |
| LG WebOS (Chromium) | ✅ | ✅ | ✅ | ❌ |

---

## Roadmap

- [ ] Persist device info to SQLite (currently reconstructed from events)
- [ ] Export full session as JSON from dashboard
- [ ] Auth token support for multi-team deployments
- [ ] Docker image for easy server deployment
- [ ] Cloud-hosted relay option (for debugging devices not on local network)
- [ ] signageOS SDK integration

---

## License

MIT License

---

**insidr** — built by a signage developer, for signage developers.
