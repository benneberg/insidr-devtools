# insidr Event Protocol Specification

## Overview

insidr uses a **structured event protocol** for all debugging signals. Events flow from instrumentation → event bus → transport sinks → remote server → UI clients.

---

## Event Structure

All events follow this structure:

```typescript
interface Event {
  type: string;              // Event type (dot-separated namespace)
  payload: any;              // Event-specific data
  timestamp: number;         // Unix timestamp (ms)
  sessionId: string;         // Session identifier
  deviceId?: string;         // Device identifier (added by server)
}
```

---

## Event Types

### Agent Events

#### `agent.started`
Emitted when agent initializes

```json
{
  "type": "agent.started",
  "payload": {
    "config": {
      "enabled": true,
      "captureConsole": true,
      "captureNetwork": true
    },
    "userAgent": "Mozilla/5.0...",
    "url": "https://example.com"
  }
}
```

#### `agent.config_changed`
Emitted when agent configuration changes

```json
{
  "type": "agent.config_changed",
  "payload": {
    "enabled": false
  }
}
```

#### `agent.shutdown`
Emitted when agent shuts down

```json
{
  "type": "agent.shutdown",
  "payload": {}
}
```

#### `agent.mode_changed`
Emitted when the DegradationManager changes operating mode

```json
{
  "type": "agent.mode_changed",
  "payload": {
    "mode": "OFFLINE",
    "previous": "NORMAL"
  }
}
```

Modes: `NORMAL` (full telemetry), `OFFLINE` (buffer only, FPS stopped), `LOW_POWER` (metrics throttled to 30s), `MAINTENANCE` (all capture stopped).

#### `agent.rate_limited`
Emitted when events were dropped due to per-category rate limiting

```json
{
  "type": "agent.rate_limited",
  "payload": {
    "dropped": { "console": 12, "network.response": 3 }
  }
}
```

---

### Console Events

#### `console`
Emitted on console.log/warn/error/info/debug

```json
{
  "type": "console",
  "payload": {
    "level": "log" | "warn" | "error" | "info" | "debug",
    "args": ["Hello", "World"],
    "stack": "Error stack trace"
  }
}
```

---

### Network Events

#### `network.request`
Emitted when HTTP request starts

```json
{
  "type": "network.request",
  "payload": {
    "requestId": "req_1234567890_abc123",
    "url": "https://api.example.com/data",
    "method": "GET",
    "headers": {},
    "body": null
  }
}
```

#### `network.response`
Emitted when HTTP response received

```json
{
  "type": "network.response",
  "payload": {
    "requestId": "req_1234567890_abc123",
    "status": 200,
    "statusText": "OK",
    "headers": {},
    "body": "{\"data\":\"value\"}",
    "duration": 123,
    "size": 456
  }
}
```

#### `network.error`
Emitted when HTTP request fails

```json
{
  "type": "network.error",
  "payload": {
    "requestId": "req_1234567890_abc123",
    "error": "Network error",
    "duration": 100
  }
}
```

#### `network.beacon`
Emitted when `navigator.sendBeacon` is called

```json
{
  "type": "network.beacon",
  "payload": {
    "url": "https://analytics.example.com/collect",
    "size": 128
  }
}
```

---

### Error Events

#### `error`
Emitted on JavaScript errors

```json
{
  "type": "error",
  "payload": {
    "message": "Uncaught TypeError: Cannot read property 'x' of undefined",
    "filename": "app.js",
    "lineno": 42,
    "colno": 10,
    "error": {
      "name": "TypeError",
      "message": "Cannot read property 'x' of undefined",
      "stack": "TypeError: Cannot read property 'x' of undefined\n    at..."
    }
  }
}
```

#### `error.unhandled_rejection`
Emitted on unhandled promise rejections

```json
{
  "type": "error.unhandled_rejection",
  "payload": {
    "reason": "Error reason",
    "promise": "[object Promise]"
  }
}
```

#### `media.error`
Emitted when a `<video>` or `<audio>` element fails to load

```json
{
  "type": "media.error",
  "payload": {
    "tag": "VIDEO",
    "src": "https://example.com/video.mp4",
    "networkState": 3,
    "readyState": 0,
    "error": { "code": 4, "message": "MEDIA_ELEMENT_ERROR: Format error" }
  }
}
```

---

### Page Lifecycle Events

#### `page.visibility`
Emitted on `visibilitychange` — screen turned off or app backgrounded

```json
{
  "type": "page.visibility",
  "payload": { "visibilityState": "hidden", "hidden": true }
}
```

#### `page.hide`
Emitted on `pagehide` — before unload or OS suspend

```json
{
  "type": "page.hide",
  "payload": { "persisted": false }
}
```

`persisted: true` means the page entered the bfcache (will be restored without reload).

#### `page.show`
Emitted on `pageshow` — initial load or bfcache restore

```json
{
  "type": "page.show",
  "payload": { "persisted": false }
}
```

#### `page.freeze`
Emitted when the OS freezes the page (Page Lifecycle API, Chrome 68+)

```json
{ "type": "page.freeze", "payload": {} }
```

#### `page.resume`
Emitted when the OS resumes a frozen page

```json
{ "type": "page.resume", "payload": {} }
```

---

### Device Events

#### `performance.fps`
Emitted every second via requestAnimationFrame

```json
{
  "type": "performance.fps",
  "payload": { "fps": 60 }
}
```

Not emitted in OFFLINE or LOW_POWER or MAINTENANCE mode.

#### `performance.metrics`
Emitted periodically (every 5s in NORMAL/OFFLINE, every 30s in LOW_POWER)

```json
{
  "type": "performance.metrics",
  "payload": {
    "memory": {
      "usedJSHeapSize": 12345678,
      "totalJSHeapSize": 23456789,
      "jsHeapSizeLimit": 2147483648
    },
    "timing": {
      "loadTime": 1234,
      "domReady": 567
    },
    "mode": "NORMAL"
  }
}
```

`memory` is `null` on Firefox, Safari, and most WebOS devices.

---

### Device Events

#### `device.info`
Emitted once on agent start with device information

```json
{
  "type": "device.info",
  "payload": {
    "userAgent": "Mozilla/5.0...",
    "platform": "Linux x86_64",
    "language": "en-US",
    "onLine": true,
    "cookieEnabled": true,
    "screenResolution": "1920x1080",
    "viewport": "1920x969",
    "deviceMemory": 8,
    "hardwareConcurrency": 4
  }
}
```

#### `device.online`
Emitted when device goes online

```json
{
  "type": "device.online",
  "payload": {
    "online": true
  }
}
```

#### `device.offline`
Emitted when device goes offline

```json
{
  "type": "device.offline",
  "payload": { "online": false }
}
```

#### `device.battery`
Emitted on connect and on battery level/charging change (Battery API where available)

```json
{
  "type": "device.battery",
  "payload": {
    "level": 85,
    "charging": true,
    "chargingTime": 1800,
    "dischargingTime": null
  }
}
```

---

## Command Protocol

Commands flow from UI → server → device. Devices receive commands via WebSocket.

### Command Structure

```typescript
interface Command {
  type: 'command';           // Always 'command'
  command: string;           // Command name
  payload: any;              // Command-specific data
}
```

### Available Commands

#### `agent.enable`
Enable debugging on device

```json
{
  "type": "command",
  "command": "agent.enable",
  "payload": {}
}
```

#### `agent.disable`
Disable debugging on device

```json
{
  "type": "command",
  "command": "agent.disable",
  "payload": {}
}
```

#### `agent.reload`
Reload the page

```json
{
  "type": "command",
  "command": "agent.reload",
  "payload": {}
}
```

#### `script.execute`
Execute JavaScript on device

```json
{
  "type": "command",
  "command": "script.execute",
  "payload": {
    "code": "console.log('Hello from remote!')"
  }
}
```

#### `agent.maintenance`
Enable or disable maintenance mode (stops all telemetry collection)

```json
{
  "type": "command",
  "command": "agent.maintenance",
  "payload": { "active": true }
}
```

#### `snapshot.take`
Trigger a canvas snapshot (if snapshot instrumentation is enabled)

```json
{
  "type": "command",
  "command": "snapshot.take",
  "payload": {}
}
```

---

## Transport Authentication

### Device authentication (`_auth`)

Sent by the device as the **first message** after WebSocket connect.

```json
{
  "type": "_auth",
  "payload": {
    "deviceId": "device_1234567890_abc123",
    "enrollmentToken": "your-token-here",
    "userAgent": "Mozilla/5.0...",
    "url": "https://signage.example.com",
    "sessionId": "sess_..."
  }
}
```

`enrollmentToken` is required when the server is running without `--no-auth`. The server closes the connection with code 4401 if the token is missing or wrong.

### Dashboard authentication (`_dashboard_auth`)

Sent by the dashboard as the **first message** after connecting to port 9230.

```json
{
  "type": "_dashboard_auth",
  "token": "your-token-here"
}
```

Same token as devices. If auth is disabled (`--no-auth`), this message is optional and the server skips the check entirely.

### Server ACK

After successful `_auth`, the server sends:

```json
{
  "type": "_ack",
  "lastSeq": 1234
}
```

The agent uses `lastSeq` to skip replaying events the server already has.

---

## Event Flow

```
[Device]
   |
   | 1. Instrumentation captures signal
   |
   v
[Event Bus]
   |
   | 2. Event emitted to all subscribers
   |
   +---> [Local UI] (embedded DevTools)
   |
   +---> [WebSocket Sink]
         |
         | 3. Event sent to server
         |
         v
      [Debug Server]
         |
         | 4. Event broadcast to subscribers
         |
         v
      [Remote UI] (web dashboard)
```

---

## Best Practices

### Event Size
- Keep payloads under 1MB
- Truncate large response bodies
- Sample high-frequency events

### Event Types
- Use dot-separated namespaces (e.g., `network.request`)
- Be specific (not just `event`)
- Use consistent naming

### Timestamps
- Always use Unix timestamps in milliseconds
- Include timezone in device.info if needed

### Error Handling
- Always include stack traces for errors
- Include context (filename, line number)
- Don't expose sensitive data in errors

---

## Extending the Protocol

To add new event types:

1. Create new instrumentation class
2. Register with agent
3. Emit events via eventBus
4. Update this documentation
5. Update UI to handle new events

### Example: Custom Instrumentation

```javascript
class CustomInstrumentation {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  start() {
    // Your instrumentation logic
    this.eventBus.emit({
      type: 'custom.event',
      payload: { /* your data */ }
    });
  }

  stop() {
    // Cleanup
  }
}
```

---

## Versioning

**Current Version**: 2.0

The agent does not currently embed a version field in `agent.started` (the `config` object contains agent settings, not a version string). Version is tracked via the server and dashboard.
