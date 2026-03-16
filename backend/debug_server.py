#!/usr/bin/env python3
"""
insidr Debug Server

WebSocket server that receives debugging events from remote devices
and serves a web UI for viewing them.

Events are persisted to SQLite so crash logs survive server restarts.
This is the "Heisenbug" feature — if the device browser crashes at 3am,
the full event history is still here in the morning.

Usage:
    python debug_server.py [--ws-port 9229] [--http-port 9231]
    python debug_server.py --no-db   # disable persistence, memory-only
"""

import asyncio
import json
import logging
import socket
import sqlite3
import os
from datetime import datetime
from collections import defaultdict
from typing import Dict, Set
import websockets
from aiohttp import web
import argparse

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('insidr')


def find_free_port(port: int) -> int:
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                port += 1


# ── SQLite persistence ────────────────────────────────────────────────────────

class EventStore:
    """
    Persists events to SQLite. Falls back to memory-only if disabled.
    This is what makes crash debugging possible — events survive server restarts.
    """

    def __init__(self, db_path: str = None):
        self.enabled = db_path is not None
        self.db_path = db_path
        self._memory: Dict[str, list] = defaultdict(list)

        if self.enabled:
            self._init_db()
            logger.info(f"Event persistence enabled: {db_path}")
        else:
            logger.info("Event persistence disabled (memory only)")

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_device ON events(device_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_type ON events(event_type)")
        conn.commit()
        conn.close()

    def append(self, device_id: str, event: dict):
        """Store an event. Trims to last 2000 per device."""
        if self.enabled:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.execute(
                    "INSERT INTO events (device_id, event_type, timestamp, payload) VALUES (?, ?, ?, ?)",
                    (device_id, event.get('type', ''), event.get('timestamp', 0), json.dumps(event))
                )
                conn.commit()
                # Trim to last 2000 events per device
                conn.execute("""
                    DELETE FROM events WHERE device_id = ? AND id NOT IN (
                        SELECT id FROM events WHERE device_id = ? ORDER BY id DESC LIMIT 2000
                    )
                """, (device_id, device_id))
                conn.commit()
            finally:
                conn.close()
        else:
            self._memory[device_id].append(event)
            if len(self._memory[device_id]) > 2000:
                self._memory[device_id] = self._memory[device_id][-2000:]

    def get(self, device_id: str, limit: int = 1000) -> list:
        """Retrieve events for a device, most recent first then re-ordered oldest first."""
        if self.enabled:
            conn = sqlite3.connect(self.db_path)
            try:
                rows = conn.execute(
                    "SELECT payload FROM events WHERE device_id = ? ORDER BY id DESC LIMIT ?",
                    (device_id, limit)
                ).fetchall()
                events = [json.loads(r[0]) for r in reversed(rows)]
                return events
            finally:
                conn.close()
        else:
            return list(self._memory.get(device_id, []))[-limit:]

    def get_device_ids(self) -> list:
        """Get all device IDs that have stored events (useful for showing history of crashed devices)."""
        if self.enabled:
            conn = sqlite3.connect(self.db_path)
            try:
                rows = conn.execute("SELECT DISTINCT device_id FROM events").fetchall()
                return [r[0] for r in rows]
            finally:
                conn.close()
        else:
            return list(self._memory.keys())

    def clear_device(self, device_id: str):
        if self.enabled:
            conn = sqlite3.connect(self.db_path)
            conn.execute("DELETE FROM events WHERE device_id = ?", (device_id,))
            conn.commit()
            conn.close()
        else:
            self._memory.pop(device_id, None)


# ── Debug Server ──────────────────────────────────────────────────────────────

class DebugServer:

    def __init__(self, host='0.0.0.0', ws_port=9229, http_port=9231, db_path='insidr_events.db'):
        self.host = host
        self.device_port = find_free_port(ws_port)
        self.subscriber_port = find_free_port(self.device_port + 1)
        self.http_port = find_free_port(http_port)

        self.devices: Dict[str, websockets.WebSocketServerProtocol] = {}
        self.device_info: Dict[str, dict] = {}
        self.subscribers: Set[websockets.WebSocketServerProtocol] = set()
        self.store = EventStore(db_path)

        # Load device IDs from persistent store on startup
        # (devices that were previously connected appear as "historical")
        self._restore_device_info()

    def _restore_device_info(self):
        """Rebuild device info stubs from stored events on startup."""
        if not self.store.enabled:
            return
        for device_id in self.store.get_device_ids():
            if device_id not in self.device_info:
                # Reconstruct minimal info from stored events
                events = self.store.get(device_id, limit=500)
                url = 'unknown'
                user_agent = 'unknown'
                for e in events:
                    if e.get('type') == 'agent.started':
                        url = e.get('payload', {}).get('url', url)
                        user_agent = e.get('payload', {}).get('userAgent', user_agent)
                        break
                self.device_info[device_id] = {
                    'deviceId': device_id,
                    'userAgent': user_agent,
                    'url': url,
                    'connectedAt': 'historical',
                    'lastSeen': 'historical',
                    'historical': True,  # flag: not currently connected
                }
        if self.device_info:
            logger.info(f"Restored {len(self.device_info)} device(s) from event history")

    async def handle_device(self, websocket, path):
        device_id = None
        try:
            logger.info(f"Device connected from {websocket.remote_address}")
            async for message in websocket:
                try:
                    event = json.loads(message)

                    if event.get('type') == '_auth':
                        device_id = event['payload']['deviceId']
                        self.devices[device_id] = websocket
                        self.device_info[device_id] = {
                            'deviceId': device_id,
                            'userAgent': event['payload'].get('userAgent', ''),
                            'url': event['payload'].get('url', ''),
                            'connectedAt': datetime.now().isoformat(),
                            'lastSeen': datetime.now().isoformat(),
                            'historical': False,
                        }
                        logger.info(f"Device authenticated: {device_id}")
                        await self.broadcast_to_subscribers({
                            'type': 'device.connected',
                            'payload': self.device_info[device_id]
                        })
                        continue

                    if device_id:
                        event['deviceId'] = device_id
                        self.store.append(device_id, event)
                        self.device_info[device_id]['lastSeen'] = datetime.now().isoformat()
                        await self.broadcast_to_subscribers(event)

                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON from device")
                except Exception as e:
                    logger.error(f"Error processing event: {e}")

        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Device disconnected: {device_id or 'unknown'}")
        finally:
            if device_id and device_id in self.devices:
                del self.devices[device_id]
                # Mark as historical rather than removing entirely
                if device_id in self.device_info:
                    self.device_info[device_id]['historical'] = True
                    self.device_info[device_id]['lastSeen'] = datetime.now().isoformat()
                await self.broadcast_to_subscribers({
                    'type': 'device.disconnected',
                    'payload': {'deviceId': device_id}
                })

    async def handle_subscriber(self, websocket, path):
        logger.info(f"Subscriber connected from {websocket.remote_address}")
        self.subscribers.add(websocket)
        try:
            await websocket.send(json.dumps({
                'type': 'devices.list',
                'payload': list(self.device_info.values())
            }))

            async for message in websocket:
                try:
                    command = json.loads(message)

                    if command.get('type') == 'ping':
                        # Keepalive from UI — no response needed, just keeps connection alive
                        continue

                    elif command['type'] == 'device.request_events':
                        device_id = command['deviceId']
                        events = self.store.get(device_id, limit=1000)
                        await websocket.send(json.dumps({
                            'type': 'device.events',
                            'payload': {'deviceId': device_id, 'events': events}
                        }))

                    elif command['type'] == 'device.send_command':
                        device_id = command['deviceId']
                        if device_id in self.devices:
                            await self.devices[device_id].send(json.dumps({
                                'type': 'command',
                                'command': command['command'],
                                'payload': command.get('payload', {})
                            }))
                        else:
                            logger.warning(f"Command to offline device: {device_id}")

                except json.JSONDecodeError:
                    logger.error("Invalid JSON from subscriber")
                except Exception as e:
                    logger.error(f"Error handling subscriber message: {e}")

        except websockets.exceptions.ConnectionClosed:
            logger.info("Subscriber disconnected")
        finally:
            self.subscribers.discard(websocket)

    async def broadcast_to_subscribers(self, event):
        if not self.subscribers:
            return
        message = json.dumps(event)
        disconnected = set()
        for subscriber in self.subscribers:
            try:
                await subscriber.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected.add(subscriber)
        self.subscribers -= disconnected

    async def http_handler(self, request):
        if request.path == '/api/devices':
            return web.json_response(list(self.device_info.values()))

        elif request.path.startswith('/api/device/'):
            device_id = request.path.split('/')[-2] if request.path.endswith('/events') else request.path.split('/')[-1]

            if request.path.endswith('/events'):
                device_id = request.path.split('/')[-2]
                events = self.store.get(device_id, limit=1000)
                return web.json_response({'deviceId': device_id, 'events': events})

            if device_id in self.device_info:
                return web.json_response({
                    'info': self.device_info[device_id],
                    'eventCount': len(self.store.get(device_id, limit=1))
                })
            return web.json_response({'error': 'Device not found'}, status=404)

        return web.json_response({'error': 'Not found'}, status=404)

    async def start(self):
        device_server = await websockets.serve(self.handle_device, self.host, self.device_port)
        logger.info(f"Device WebSocket:     ws://{self.host}:{self.device_port}")

        subscriber_server = await websockets.serve(self.handle_subscriber, self.host, self.subscriber_port)
        logger.info(f"Subscriber WebSocket: ws://{self.host}:{self.subscriber_port}")

        app = web.Application()
        app.router.add_get('/api/devices', self.http_handler)
        app.router.add_get('/api/device/{device_id}', self.http_handler)
        app.router.add_get('/api/device/{device_id}/events', self.http_handler)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.http_port)
        await site.start()
        logger.info(f"HTTP API:             http://{self.host}:{self.http_port}")

        await asyncio.Future()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='insidr Debug Server')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--ws-port', type=int, default=9229)
    parser.add_argument('--http-port', type=int, default=9231)
    parser.add_argument('--no-db', action='store_true', help='Disable SQLite persistence (memory only)')
    parser.add_argument('--db-path', default='insidr_events.db', help='Path to SQLite database file')

    args = parser.parse_args()

    db_path = None if args.no_db else args.db_path

    server = DebugServer(
        host=args.host,
        ws_port=args.ws_port,
        http_port=args.http_port,
        db_path=db_path,
    )

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Server stopped")
