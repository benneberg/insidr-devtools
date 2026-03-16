import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:9230';

export function useRemoteSession() {
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState([]);
  const [activeDevice, setActiveDevice] = useState(null);
  const [events, setEvents] = useState([]);
  const ws = useRef(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;
      
      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => {
        if (!mounted) { ws.current.close(); return; }
        setConnected(true);
      };

      ws.current.onclose = () => {
        if (!mounted) return;
        setConnected(false);
        setDevices([]);
        setTimeout(connect, 3000);
      };

      ws.current.onerror = () => {
        if (ws.current) ws.current.close();
      };

      ws.current.onmessage = (msg) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(msg.data);
          handleMessage(data);
        } catch (e) {}
      };
    }

    connect();

    return () => {
      mounted = false;
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, []);

  function handleMessage(data) {
    switch (data.type) {
      case 'devices.list':
        setDevices(data.payload);
        break;

      case 'device.connected':
        setDevices(prev => {
          const exists = prev.find(d => d.deviceId === data.payload.deviceId);
          return exists ? prev : [...prev, data.payload];
        });
        break;

      case 'device.disconnected':
        setDevices(prev => prev.filter(d => d.deviceId !== data.payload.deviceId));
        setActiveDevice(prev =>
          prev?.deviceId === data.payload.deviceId ? null : prev
        );
        break;

      case 'device.events':
        // Historical events dump on session start
        setEvents(data.payload.events);
        break;

      default:
        // Live event from active device
        if (data.deviceId) {
          setEvents(prev => {
            const next = [...prev, data];
            return next.length > 2000 ? next.slice(-2000) : next;
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
        type: 'device.request_events',
        deviceId: device.deviceId
      }));
    }
  }, []);

  const sendCommand = useCallback((command, payload = {}) => {
    if (!activeDevice || ws.current?.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({
      type: 'device.send_command',
      deviceId: activeDevice.deviceId,
      command,
      payload
    }));
  }, [activeDevice]);

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
    clearDevice
  };
}