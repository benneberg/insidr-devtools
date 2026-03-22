import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL   = process.env.REACT_APP_WS_URL   || 'ws://localhost:9230';
const WS_TOKEN = process.env.REACT_APP_WS_TOKEN  || null;  // set in .env when auth is enabled

const MAX_EVENTS = 5000;   // keep last 5k events in memory per session

export function useRemoteSession() {
  const [connected,    setConnected]    = useState(false);
  const [devices,      setDevices]      = useState([]);
  const [activeDevice, setActiveDevice] = useState(null);
  const [events,       setEvents]       = useState([]);

  const ws            = useRef(null);
  const pingRef       = useRef(null);
  const activeRef     = useRef(null);   // mirror of activeDevice for use inside onmessage

  // Keep activeRef in sync
  useEffect(() => { activeRef.current = activeDevice; }, [activeDevice]);

  useEffect(() => {
    let mounted = true;

    function startPing() {
      pingRef.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20_000);
    }

    function stopPing() {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }

    function connect() {
      if (!mounted) return;
      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => {
        if (!mounted) { ws.current.close(); return; }
        // If token auth is enabled on the server, we must send _dashboard_auth
        // as the very first message before the server will send devices.list.
        if (WS_TOKEN) {
          ws.current.send(JSON.stringify({ type: '_dashboard_auth', token: WS_TOKEN }));
        }
        setConnected(true);
        startPing();
      };

      ws.current.onclose = () => {
        stopPing();
        if (!mounted) return;
        setConnected(false);
        setTimeout(connect, 3000);
      };

      ws.current.onerror = () => {
        if (ws.current) ws.current.close();
      };

      ws.current.onmessage = (msg) => {
        if (!mounted) return;
        try {
          handleMessage(JSON.parse(msg.data));
        } catch (_) {}
      };
    }

    connect();

    return () => {
      mounted = false;
      stopPing();
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMessage(data) {
    switch (data.type) {

      case 'devices.list':
        setDevices(data.payload);
        break;

      case 'device.connected':
        setDevices(prev => {
          const exists = prev.some(d => d.deviceId === data.payload.deviceId);
          // Update in-place if already listed (e.g. historical → live)
          if (exists) {
            return prev.map(d =>
              d.deviceId === data.payload.deviceId ? data.payload : d
            );
          }
          return [...prev, data.payload];
        });
        break;

      case 'device.disconnected':
        setDevices(prev => prev.map(d =>
          d.deviceId === data.payload.deviceId
            ? { ...d, historical: true }
            : d
        ));
        break;

      case 'device.suspect':
        // Watchdog fired — flag device in list with a visual indicator
        setDevices(prev => prev.map(d =>
          d.deviceId === data.payload.deviceId
            ? { ...d, suspect: true, silentSeconds: data.payload.silentSeconds }
            : d
        ));
        break;

      case 'device.events':
        // Historical event load (response to device.request_events)
        if (data.payload.deviceId === activeRef.current?.deviceId) {
          setEvents(data.payload.events);
        }
        break;

      default:
        // Live event from a device — only add to state if it belongs to active session
        if (data.deviceId && data.deviceId === activeRef.current?.deviceId) {
          // Skip internal transport frames that leak through
          if (data.type === '_ping' || data.type === '_pong' ||
              data.type === '_ack' || data.type === '_batch' ||
              data.type === '_replay') break;

          setEvents(prev => {
            const next = [...prev, data];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        }
        break;
    }
  }

  const selectDevice = useCallback((device) => {
    setActiveDevice(device);
    setEvents([]);
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type:     'device.request_events',
        deviceId: device.deviceId,
      }));
    }
  }, []);

  const sendCommand = useCallback((command, payload = {}) => {
    const dev = activeRef.current;
    if (!dev || ws.current?.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({
      type:     'device.send_command',
      deviceId: dev.deviceId,
      command,
      payload,
    }));
  }, []);

  const clearDevice = useCallback(() => {
    setActiveDevice(null);
    setEvents([]);
  }, []);

  return {
    connected,
    devices,
    activeDevice,
    events,
    selectDevice,
    sendCommand,
    clearDevice,
  };
}
