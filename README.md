# insidr

**Remote observability and debugging for digital signage and kiosk applications.**

> We are not building a debugger. We are building observability for an industry that never had it.

insidr is a platform-independent remote debugging agent for web-based signage players. It streams console logs, network requests, errors, performance telemetry, and device lifecycle events from any Chromium-based device to a web dashboard — no ADB, no SDB, no developer mode, no same-network requirement.

---

## The Problem

Debugging a signage player traditionally means:
- Enabling developer mode differently on every platform (LG WebOS, Samsung Tizen, BrightSign, Android, etc.)
- Being physically present or on the same network
- Using ADB or SDB which are vendor-specific and fragile
- Losing all logs the moment the browser crashes or the screen turns off

insidr solves all of this with a single `<script>` tag injected into your app.

---

## How It Works

```
[Signage Device]                         [Your Laptop / Server]
 HTML app + insidr agent  ──WSS──►        debug_server.py
  captures everything                      stores all events in SQLite
  console, network, errors                       ↕
  performance, lifecycle                   insidr dashboard
  device info, battery                     (React web UI — any browser)
```

The agent runs inside your app and pushes structured events to the server over WebSocket. The server stores every event in SQLite immediately on arrival. The dashboard connects to the server and shows everything in real time — or the full history after a crash.

---

## Quick Start

### 1. Start the backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux
pip install -r requirements.txt

# Local dev — no auth required
python debug_server.py --no-auth
```

You'll see:
```
Auth DISABLED (--no-auth). Do not use on shared networks.
Device WebSocket:     ws://0.0.0.0:9229
Subscriber WebSocket: ws://0.0.0.0:9230
HTTP API:             http://0.0.0.0:9231
Event persistence:    insidr_events.db
```

For production or shared networks, omit `--no-auth`. The server will print an enrollment token that devices must present to connect.

### 2. Start the dashboard

```bash
cd frontend
yarn install
yarn start
```

Open `http://localhost:3000`. You'll see the device list (empty for now).

### 3. Add the agent to your app

Add this as the **first script** in your signage app's `<head>`. Point `url` at your machine's IP.

```html
<script src="path/to/insidr/transports/websocket.js"></script>
<script src="path/to/insidr/agent.js"></script>
<script>
  insidr.init(new WebSocketSink({
    url: 'ws://YOUR_SERVER_IP:9229',
    // enrollmentToken: 'your-token'  // required when not using --no-auth
  }));
</script>
```

The device appears in the dashboard within seconds of connecting.

---

## Features

### Dashboard tabs (per device)

| Tab | What you see |
|-----|-------------|
| **Console** | All `console.log/warn/error/info/debug` output. Inline eval bar to run JS on the device. ↑↓ command history. |
| **Network** | Every `fetch` and `XHR` request reconstructed with request/response headers, body, status, duration. Filter by fetch / xhr / failed. |
| **Errors** | JS errors, unhandled rejections, and media element errors with full stack traces. |
| **Monitor** | FPS chart, JS heap chart, page load timing. Metrics arrive every 5 seconds from the agent. |
| **Storage** | Fetch localStorage / sessionStorage / cookies from the device on demand. Delete keys or clear all. |
| **Application** | Check service workers, cache storage, app manifest. Clear caches or unregister SWs remotely. |
| **System Info** | Auto-populated from `device.info` event. Fetch full GPU, memory, connection, orientation info on demand. |
| **Quick Actions** | Clear Everything, Stop Media, Reset Videos, Force GC, Check Resources, Toggle Fullscreen, Auto-Refresh scheduler, debug report export. |
| **Script Runner** | 9 built-in snippets (video status, memory, localStorage, breakpoint installer, variable watcher, etc). Save/load custom scripts. |
| **Blackbox** | Every event received, searchable and filterable by type. Crash forensics view. |

### Agent capabilities

- Console capture — all levels, with stack traces
- Network interception — fetch, XHR, and `navigator.sendBeacon`
- Error capture — JS errors, unhandled promise rejections, media element errors
- Performance metrics — FPS via rAF, JS heap via `performance.memory`, page load timing
- Page lifecycle — `visibilitychange`, `pagehide`, `pageshow`, `freeze`, `resume`
- Device info — userAgent, platform, screen resolution, viewport, CPU cores, device memory
- Battery status — level and charging state via Battery API (where available)
- Degradation modes — OFFLINE (buffer only, FPS stopped), LOW_POWER (metrics throttled to 30s), MAINTENANCE
- IndexedDB buffer — 50MB circular buffer survives page reloads and browser crashes
- Event batching — 50 events or 5 seconds, whichever comes first
- PII redaction — Authorization, Cookie, Set-Cookie, x-api-key headers stripped automatically
- Rate limiting — per-category caps; errors are never dropped
- Durable device identity — survives `localStorage.clear()` via fallback chain
- Replay on reconnect — last 500 buffered events replayed after server restart

### Server capabilities

- SQLite persistence — every event written on arrival; history survives server restarts
- Historical devices — offline devices still appear in the list with full event history
- Watchdog — marks devices as suspect if silent for 90 seconds
- Enrollment token auth — timing-safe comparison, auto-generated and persisted on first run
- Gap detection via sequence numbers

---

## Authentication

### Local development

```bash
python debug_server.py --no-auth
```

Leave `REACT_APP_WS_TOKEN` blank in `frontend/.env`.

### Shared or production networks

Start without `--no-auth`. The server prints a token:

```
Enrollment token: abc123xyz...
```

Configure the agent:
```js
insidr.init(new WebSocketSink({
  url: 'ws://YOUR_IP:9229',
  enrollmentToken: 'abc123xyz...'
}));
```

Configure the dashboard (`frontend/.env`):
```
REACT_APP_WS_TOKEN=abc123xyz...
```

Set a fixed token:
```bash
python debug_server.py --token my-secret-token
# or set environment variable:
INSIDR_ENROLLMENT_TOKEN=my-secret-token python debug_server.py
```

---

## Backend flags

```
python debug_server.py [options]

  --no-auth              Disable token auth (local dev only — never use on shared networks)
  --token <value>        Set enrollment token explicitly
  --ws-port <n>          Device WebSocket port (default 9229)
  --http-port <n>        HTTP API port (default 9231)
  --no-db                Memory-only mode, no SQLite persistence
  --db-path <path>       Custom SQLite file path (default insidr_events.db)
```

---

## Architecture

```
frontend/
  src/
    App.js                       # Fleet dashboard + 10-tab device view
    App.css
    hooks/
      useRemoteSession.js        # WebSocket connection to server port 9230
    insidr/
      agent.js                   # Agent core — EventBus + instrumentation classes
      transports/
        websocket.js             # WebSocket sink — IDB buffer, batching, auth, PII redaction
        localStorage.js          # LocalStorage sink (offline / embedded use)

backend/
  debug_server.py                # WebSocket relay + SQLite store + HTTP API
  requirements.txt
```

### Ports

| Port | Purpose |
|------|---------|
| `9229` | Devices connect (WebSocket) |
| `9230` | Dashboard connects (WebSocket subscriber) |
| `9231` | HTTP REST API |

---

## Crash log persistence (the Heisenbug feature)

All events are written to SQLite the moment they arrive. A device that crashes at 3am has its full event history visible when you open the dashboard in the morning — including the error that caused the crash. History survives server restarts. Historical (offline) devices appear in the device list with a grey dot and all their events intact.

Disable persistence (memory-only):
```bash
python debug_server.py --no-db
```

---

## Testing locally

The fastest way to simulate a device without real hardware:

1. Start the backend: `python debug_server.py --no-auth`
2. Start the dashboard: `yarn start`
3. Open a second browser tab and paste into its console:

```js
// Simulates a device connecting — paste into any browser tab console
fetch('https://jsonplaceholder.typicode.com/todos/1'); // generate a network event
console.log('hello from test device');
console.error('test error');
```

Then open `http://localhost:3000`, the device appears immediately.

---

## What you can and can't debug remotely

| Capability | insidr | Native DevTools |
|-----------|--------|----------------|
| Console logs (all levels) | ✅ | ✅ |
| Network requests + responses | ✅ | ✅ |
| JS errors + stack traces | ✅ | ✅ |
| Performance metrics + memory | ✅ | ✅ |
| Page lifecycle events | ✅ | ✅ |
| Battery status | ✅ | ❌ |
| Remote script execution | ✅ | ✅ |
| Crash log persistence | ✅ | ❌ |
| Works without developer mode | ✅ | ❌ |
| Platform independent | ✅ | ❌ |
| Survives offline / screen-off | ✅ | ❌ |
| Pause execution / breakpoints | ❌ | ✅ |
| Step through code | ❌ | ✅ |
| Edit live source files | ❌ | ✅ |

---

## Browser API compatibility

| Feature | Chrome | Edge | Firefox | Safari | WebOS Chromium |
|---------|--------|------|---------|--------|----------------|
| Console capture | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fetch interception | ✅ | ✅ | ✅ | ✅ | ✅ |
| XHR interception | ✅ | ✅ | ✅ | ✅ | ✅ |
| sendBeacon | ✅ | ✅ | ✅ | ✅ | ✅ |
| performance.memory | ✅ | ✅ | ❌ | ❌ | ❌ |
| Battery API | ✅ | ✅ | ✅ | ❌ | varies |
| IndexedDB buffer | ✅ | ✅ | ✅ | ✅ | ✅ |
| Page Lifecycle API | ✅ | ✅ | partial | partial | partial |

All missing APIs are handled gracefully.

---

## Supported platforms

- LG WebOS (via signageOS or direct)
- Samsung Tizen (via signageOS)
- BrightSign
- Android TV / Android WebView
- Raspberry Pi (Chromium)
- Windows / Mac / Linux (for development and testing)

---

## License

MIT — built by a signage developer, for signage developers.
