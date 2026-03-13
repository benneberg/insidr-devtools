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
    'console': '#00FF66',
    'network': '#0099FF',
    'error':   '#FF0066',
    'performance': '#FFA500',
    'agent':   '#888',
    'device':  '#888',
  };

  const prefix = event.type?.split('.')[0];
  const color = typeColor[prefix] || '#ccc';

  const level = event.payload?.level;
  const levelColor = {
    error: '#FF0066', warn: '#FFA500', info: '#0099FF', log: '#ccc', debug: '#888'
  };

  return (
    <div
      className="event-row"
      onClick={() => setExpanded(!expanded)}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <span className="event-time">{formatTime(event.timestamp)}</span>
      <span className="event-type" style={{ color }}>{event.type}</span>

      {event.type === 'console' && (
        <span className="event-summary" style={{ color: levelColor[level] || '#ccc' }}>
          [{level}] {event.payload?.args?.join(' ')}
        </span>
      )}

      {event.type === 'network.request' && (
        <span className="event-summary">
          {event.payload?.method} {event.payload?.url}
        </span>
      )}

      {event.type === 'network.response' && (
        <span className="event-summary" style={{ color: event.payload?.status >= 400 ? '#FF0066' : '#00FF66' }}>
          {event.payload?.status} · {event.payload?.duration?.toFixed(0)}ms
        </span>
      )}

      {event.type === 'error' && (
        <span className="event-summary" style={{ color: '#FF0066' }}>
          {event.payload?.message}
        </span>
      )}

      {event.type === 'performance.metrics' && (
        <span className="event-summary">
          heap: {event.payload?.memory
            ? `${(event.payload.memory.usedJSHeapSize / 1048576).toFixed(1)}MB`
            : 'n/a'}
        </span>
      )}

      {expanded && (
        <pre className="event-detail">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

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
          <button className="cmd-btn danger" onClick={() => sendCommand('agent.reload')}>Reload</button>
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
            <span className="tab-count">
              {filterEvents(events, tab.id).length}
            </span>
          </button>
        ))}
      </div>

      <div className="event-list">
        {filtered.length === 0 ? (
          <div className="empty-state">No events yet</div>
        ) : (
          [...filtered].reverse().map((event, i) => (
            <EventRow key={i} event={event} />
          ))
        )}
      </div>
    </div>
  );
}

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
          <div
            key={device.deviceId}
            className="device-card"
            onClick={() => onSelect(device)}
          >
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

export default function App() {
  const { connected, devices, activeDevice, events, selectDevice, sendCommand, clearDevice } = useRemoteSession();

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-logo">insidr</div>
        <div className={`server-status ${connected ? 'online' : 'offline'}`}>
          <span className="status-dot" />
          {connected ? 'Server connected' : 'Connecting to server...'}
        </div>
      </div>

      <div className="dashboard-body">
        {activeDevice ? (
          <DeviceSession
            device={activeDevice}
            events={events}
            sendCommand={sendCommand}
            onBack={clearDevice}
          />
        ) : (
          <DeviceList devices={devices} onSelect={selectDevice} />
        )}
      </div>
    </div>
  );
}