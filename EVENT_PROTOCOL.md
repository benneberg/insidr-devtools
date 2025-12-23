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

---

### Performance Events

#### `performance.metrics`
Emitted periodically (every 5s) with performance metrics

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
    }
  }
}
```

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
  "payload": {
    "online": false
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

---

## Transport Authentication

### Device Authentication

Devices authenticate when connecting:

```json
{
  "type": "_auth",
  "payload": {
    "deviceId": "device_1234567890_abc123",
    "authToken": "optional_auth_token",
    "userAgent": "Mozilla/5.0...",
    "url": "https://signage.example.com"
  }
}
```

### Server Response

No explicit response - connection accepted if auth succeeds.

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

**Current Version**: 1.0.0

Version is included in `agent.started` event:

```json
{
  "type": "agent.started",
  "payload": {
    "version": "1.0.0"
  }
}
```
