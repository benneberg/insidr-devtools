import { useState } from 'react';
import { useRemoteSession } from './hooks/useRemoteSession';
import './App.css';

const EVENT_TABS = [
  { id: 'all',         label: 'All' },
  { id: 'console',     label: 'Console' },
  { id: 'network',     label: 'Network' },
  { id: 'error',       label: 'Errors' },
  { id: 'performance', label: 'Performance' },
];

// Built-in script snippets for common signage debugging tasks
const SCRIPT_SNIPPETS = [
  { label: 'Video status',    code: `var v = document.querySelector('video');\nv ? JSON.stringify({src:v.src,readyState:v.readyState,networkState:v.networkState,paused:v.paused,currentTime:v.currentTime,duration:v.duration,error:v.error}) : 'No video element found'` },
  { label: 'All videos',      code: `JSON.stringify(Array.from(document.querySelectorAll('video')).map((v,i)=>({index:i,src:v.src,readyState:v.readyState,paused:v.paused,error:v.error?.message})))` },
  { label: 'Memory',          code: `performance.memory ? JSON.stringify({used:Math.round(performance.memory.usedJSHeapSize/1048576)+'MB',total:Math.round(performance.memory.totalJSHeapSize/1048576)+'MB',limit:Math.round(performance.memory.jsHeapSizeLimit/1048576)+'MB'}) : 'Memory API not available'` },
  { label: 'localStorage',    code: `JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))` },
  { label: 'Install breakpt', code: `window.__insidrBreakpoint = function(label, data) {\n  console.log('[BREAKPOINT]', label, typeof data === 'object' ? JSON.stringify(data) : data);\n};\n'Breakpoint helper installed — call window.__insidrBreakpoint(label, data) in your app'` },
  { label: 'Watch variable',  code: `// Replace 'window.myVar' with the object and property you want to watch\n(function(){\n  var obj = window, prop = 'myVar', val = obj[prop];\n  Object.defineProperty(obj, prop, {\n    get: function(){ return val; },\n    set: function(v){ console.log('[WATCH] myVar changed:', val, '->', v); val = v; }\n  });\n  return 'Watching window.myVar';\n})()` },
  { label: 'Outline elements', code: `document.querySelectorAll('*').forEach(function(el){ el.style.outline='1px solid rgba(255,0,102,0.3)'; });\n'Outlines added to all elements'` },
  { label: 'Clear outlines',  code: `document.querySelectorAll('*').forEach(function(el){ el.style.outline=''; });\n'Outlines cleared'` },
];

function filterEvents(events, tab) {
  if (tab === 'all') return events;
  return events.filter(e => e.type?.startsWith(tab));
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false);

  const typeColor = {
    console: '#00FF66', network: '#0099FF', error: '#FF0066',
    performance: '#FFA500', agent: '#888', device: '#888', script: '#CC88FF',
  };
  const prefix = event.type?.split('.')[0];
  const color = typeColor[prefix] || '#ccc';
  const levelColor = { error: '#FF0066', warn: '#FFA500', info: '#0099FF', log: '#ccc', debug: '#888' };
  const level = event.payload?.level;

  return (
    <div className="event-row" onClick={() => setExpanded(!expanded)} style={{ borderLeft: `3px solid ${color}` }}>
      <span className="event-time">{formatTime(event.timestamp)}</span>
      <span className="event-type" style={{ color }}>{event.type}</span>

      {event.type === 'console' && (
        <span className="event-summary" style={{ color: levelColor[level] || '#ccc' }}>
          [{level}] {event.payload?.args?.join(' ')}
        </span>
      )}
      {event.type === 'network.request' && (
        <span className="event-summary">{event.payload?.method} {event.payload?.url}</span>
      )}
      {event.type === 'network.response' && (
        <span className="event-summary" style={{ color: event.payload?.status >= 400 ? '#FF0066' : '#00FF66' }}>
          {event.payload?.status} · {event.payload?.duration?.toFixed(0)}ms · {event.payload?.url}
        </span>
      )}
      {event.type === 'network.error' && (
        <span className="event-summary" style={{ color: '#FF0066' }}>{event.payload?.error}</span>
      )}
      {event.type === 'error' && (
        <span className="event-summary" style={{ color: '#FF0066' }}>
          {event.payload?.message} {event.payload?.filename ? `(${event.payload.filename}:${event.payload.lineno})` : ''}
        </span>
      )}
      {event.type === 'error.unhandled_rejection' && (
        <span className="event-summary" style={{ color: '#FF0066' }}>Unhandled rejection: {event.payload?.reason}</span>
      )}
      {event.type === 'performance.metrics' && (
        <span className="event-summary">
          heap: {event.payload?.memory ? `${(event.payload.memory.usedJSHeapSize / 1048576).toFixed(1)}MB / ${(event.payload.memory.totalJSHeapSize / 1048576).toFixed(1)}MB` : 'n/a'}
        </span>
      )}
      {event.type === 'script.result' && (
        <span className="event-summary" style={{ color: event.payload?.success ? '#00FF66' : '#FF0066' }}>
          {event.payload?.success ? event.payload?.result : event.payload?.error}
        </span>
      )}
      {event.type === 'agent.started' && (
        <span className="event-summary" style={{ color: '#888' }}>v{event.payload?.version} · {event.payload?.url}</span>
      )}
      {event.type === 'device.info' && (
        <span className="event-summary" style={{ color: '#888' }}>{event.payload?.userAgent?.split(')')[0].split('(')[1]}</span>
      )}

      {expanded && (
        <pre className="event-detail">{JSON.stringify(event.payload, null, 2)}</pre>
      )}
    </div>
  );
}

// ── Script Runner Panel ──────────────────────────────────────────────────────
function ScriptRunner({ sendCommand }) {
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(false);

  function run() {
    if (!code.trim()) return;
    sendCommand('script.execute', { code });
  }

  function loadSnippet(snippet) {
    setCode(snippet.code);
  }

  return (
    <div className="script-runner">
      <button className="script-runner-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▼' : '▶'} Script Runner
      </button>
      {open && (
        <div className="script-runner-body">
          <div className="snippet-bar">
            {SCRIPT_SNIPPETS.map(s => (
              <button key={s.label} className="snippet-btn" onClick={() => loadSnippet(s)}>{s.label}</button>
            ))}
          </div>
          <textarea
            className="script-input"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Enter JavaScript to execute on the device..."
            rows={5}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); }}
          />
          <div className="script-actions">
            <span className="script-hint">Ctrl+Enter to run · Results appear in the event stream above</span>
            <button className="cmd-btn run" onClick={run}>▶ Run</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Device Session ───────────────────────────────────────────────────────────
function DeviceSession({ device, events, sendCommand, onBack }) {
  const [activeTab, setActiveTab] = useState('all');
  const filtered = filterEvents(events, activeTab);

  return (
    <div className="session-view">
      <div className="session-header">
        <button className="back-btn" onClick={onBack}>← Devices</button>
        <div className="session-device-info">
          <span className="session-device-id">{device.deviceId}</span>
          <span className="session-device-url">{device.url}</span>
        </div>
        <div className="session-actions">
          <button className="cmd-btn" onClick={() => sendCommand('agent.enable')}>Enable</button>
          <button className="cmd-btn" onClick={() => sendCommand('agent.disable')}>Disable</button>
          <button className="cmd-btn danger" onClick={() => { if (window.confirm('Reload device?')) sendCommand('agent.reload'); }}>Reload</button>
        </div>
      </div>

      <div className="event-tabs">
        {EVENT_TABS.map(tab => (
          <button
            key={tab.id}
            className={`event-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="tab-count">{filterEvents(events, tab.id).length}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="event-tab"
          style={{ color: '#FF0066' }}
          onClick={() => { if (window.confirm('Clear event history for this session?')) {} }}
          title="Event count"
        >
          {events.length} events
        </button>
      </div>

      <div className="event-list">
        {filtered.length === 0 ? (
          <div className="empty-state">No {activeTab === 'all' ? '' : activeTab + ' '}events yet</div>
        ) : (
          [...filtered].reverse().map((event, i) => <EventRow key={i} event={event} />)
        )}
      </div>

      <ScriptRunner sendCommand={sendCommand} />
    </div>
  );
}

// ── Device List ──────────────────────────────────────────────────────────────
function DeviceList({ devices, onSelect }) {
  return (
    <div className="device-list">
      <h2 className="device-list-title">Connected Devices</h2>
      {devices.length === 0 ? (
        <div className="empty-state">
          No devices connected.<br />
          <span className="empty-hint">Add the insidr agent script to your app and point it at ws://YOUR_IP:9229</span>
        </div>
      ) : (
        devices.map(device => (
          <div key={device.deviceId} className="device-card" onClick={() => onSelect(device)}>
            <div className="device-card-header">
              <span className="device-dot" />
              <span className="device-card-id">{device.deviceId}</span>
            </div>
            <div className="device-card-url">{device.url}</div>
            <div className="device-card-meta">
              Connected: {new Date(device.connectedAt).toLocaleTimeString()}
              &nbsp;·&nbsp;
              Last seen: {new Date(device.lastSeen).toLocaleTimeString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const { connected, devices, activeDevice, events, selectDevice, sendCommand, clearDevice } = useRemoteSession();

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-logo">insidr</div>
        <div className="dashboard-header-right">
          {activeDevice && (
            <span className="device-badge">
              <span className="device-dot" /> {activeDevice.deviceId}
            </span>
          )}
          <div className={`server-status ${connected ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            {connected ? 'Server connected' : 'Connecting to server...'}
          </div>
        </div>
      </div>

      <div className="dashboard-body">
        {activeDevice ? (
          <DeviceSession device={activeDevice} events={events} sendCommand={sendCommand} onBack={clearDevice} />
        ) : (
          <DeviceList devices={devices} onSelect={selectDevice} />
        )}
      </div>
    </div>
  );
}
