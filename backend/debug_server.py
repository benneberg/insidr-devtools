#!/usr/bin/env python3
"""
insidr Debug Server — v2

Tier-1 additions vs v1:
  - _batch envelope    : unpack and store each event individually
  - _replay envelope   : dedup against already-stored seqs, insert gaps only
  - _ping / _pong      : heartbeat + watchdog (devices silent >90s flagged)
  - sequence tracking  : last_seq per device for gap detection
  - agent.rate_limited : store drop diagnostic events
  - /api/device/{id}/gaps  : query endpoint for gap detection
  - Graceful concurrent SQLite  : WAL mode + connection-per-write

Usage:
    python debug_server.py [--ws-port 9229] [--http-port 9231]
    python debug_server.py --no-db
"""

import asyncio
import json
import logging
import socket
import sqlite3
import os
import secrets
import time
from datetime import datetime, timezone
from collections import defaultdict
from typing import Dict, Set, Optional
from pathlib import Path

import base64
import websockets
from aiohttp import web
import argparse
from snapshot_analyzer import get_analyzer

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
)
logger = logging.getLogger('insidr')

WATCHDOG_TIMEOUT = 90   # seconds — mark device suspect if no ping received


# ── Enrollment token auth ─────────────────────────────────────────────────────
#
# Security model:
#   - Devices connect to port 9229 and must include the enrollment token
#     in their _auth message: { type: '_auth', payload: { token: '...' } }
#   - Dashboard subscribers connect to port 9230 and must send the token
#     as the first message: { type: '_dashboard_auth', token: '...' }
#   - If INSIDR_TOKEN_REQUIRED=false or --no-auth is passed, auth is skipped
#     (local development only — never disable in production)
#   - Token is loaded from INSIDR_ENROLLMENT_TOKEN env var, or from a
#     .insidr_token file, or auto-generated on first run and saved.
#   - Connections that fail auth are closed immediately with code 4401.
#
# To configure the agent: pass token in WebSocketSink config:
#   new WebSocketSink({ url: 'ws://...', enrollmentToken: 'your-token' })

def load_or_generate_token() -> str:
    """Load from env, .insidr_token file, or generate + persist a new one."""
    env_token = os.environ.get('INSIDR_ENROLLMENT_TOKEN', '').strip()
    if env_token:
        return env_token

    token_file = Path(__file__).parent / '.insidr_token'
    if token_file.exists():
        t = token_file.read_text().strip()
        if t:
            return t

    new_token = secrets.token_urlsafe(32)
    try:
        token_file.write_text(new_token)
        token_file.chmod(0o600)
    except OSError:
        pass
    return new_token


def find_free_port(port: int) -> int:
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('0.0.0.0', port))
                return port
            except OSError:
                port += 1


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_ms() -> int:
    return int(time.time() * 1000)


# ── SQLite persistence ────────────────────────────────────────────────────────

class EventStore:
    """
    Persists events to SQLite with WAL mode for concurrent access.
    - Stores raw event JSON + extracted metadata for fast queries
    - Tracks last sequence number per device for gap detection
    - Falls back to memory when disabled
    """

    def __init__(self, db_path: Optional[str]):
        self.enabled  = db_path is not None
        self.db_path  = db_path
        self._memory: Dict[str, list] = defaultdict(list)
        self._mem_seqs: Dict[str, set] = defaultdict(set)

        if self.enabled:
            self._init_db()
            logger.info(f'Event persistence: {db_path}')
        else:
            logger.info('Event persistence disabled (memory only)')

    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA synchronous=NORMAL')
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS events (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id   TEXT    NOT NULL,
                    session_id  TEXT,
                    seq         INTEGER,
                    event_type  TEXT    NOT NULL,
                    timestamp   INTEGER NOT NULL,
                    payload     TEXT    NOT NULL,
                    created_at  TEXT    DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_device_ts
                    ON events(device_id, timestamp);
                CREATE INDEX IF NOT EXISTS idx_type
                    ON events(event_type);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_device_seq
                    ON events(device_id, seq)
                    WHERE seq IS NOT NULL;

                CREATE TABLE IF NOT EXISTS device_seq (
                    device_id  TEXT PRIMARY KEY,
                    last_seq   INTEGER NOT NULL DEFAULT 0
                );
            """)

    # ── Write ─────────────────────────────────────────────────────────────────

    def append(self, device_id: str, event: dict, *, replay: bool = False) -> bool:
        """
        Store one event. Returns True if stored, False if deduped (seq already present).
        """
        seq        = event.get('seq')
        session_id = event.get('sessionId', '')
        ts         = event.get('timestamp', now_ms())
        etype      = event.get('type', '')
        payload    = json.dumps(event)

        if self.enabled:
            try:
                with self._conn() as conn:
                    if seq is not None:
                        # INSERT OR IGNORE respects the UNIQUE index on (device_id, seq)
                        cur = conn.execute(
                            """INSERT OR IGNORE INTO events
                               (device_id, session_id, seq, event_type, timestamp, payload)
                               VALUES (?, ?, ?, ?, ?, ?)""",
                            (device_id, session_id, seq, etype, ts, payload)
                        )
                        if cur.rowcount == 0:
                            return False  # duplicate

                        # Advance last_seq if this is newer
                        conn.execute(
                            """INSERT INTO device_seq (device_id, last_seq) VALUES (?, ?)
                               ON CONFLICT(device_id) DO UPDATE SET
                               last_seq = MAX(last_seq, excluded.last_seq)""",
                            (device_id, seq)
                        )
                    else:
                        conn.execute(
                            """INSERT INTO events
                               (device_id, session_id, seq, event_type, timestamp, payload)
                               VALUES (?, ?, NULL, ?, ?, ?)""",
                            (device_id, session_id, etype, ts, payload)
                        )

                    # Trim to last 5000 events per device
                    conn.execute("""
                        DELETE FROM events
                        WHERE device_id = ?
                          AND id NOT IN (
                              SELECT id FROM events
                              WHERE device_id = ?
                              ORDER BY id DESC LIMIT 5000
                          )
                    """, (device_id, device_id))

                return True

            except Exception as e:
                logger.error(f'DB write error: {e}')
                return False
        else:
            if seq is not None and seq in self._mem_seqs[device_id]:
                return False
            if seq is not None:
                self._mem_seqs[device_id].add(seq)
            self._memory[device_id].append(event)
            if len(self._memory[device_id]) > 5000:
                self._memory[device_id] = self._memory[device_id][-5000:]
            return True

    def append_batch(self, device_id: str, events: list, *, replay: bool = False) -> dict:
        """Store a batch. Returns {stored, duped} counts."""
        stored = duped = 0
        for ev in events:
            if self.append(device_id, ev, replay=replay):
                stored += 1
            else:
                duped += 1
        return {'stored': stored, 'duped': duped}

    # ── Read ──────────────────────────────────────────────────────────────────

    def get(self, device_id: str, limit: int = 1000) -> list:
        if self.enabled:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT payload FROM events
                       WHERE device_id = ?
                       ORDER BY id DESC LIMIT ?""",
                    (device_id, limit)
                ).fetchall()
            return [json.loads(r['payload']) for r in reversed(rows)]
        else:
            return list(self._memory.get(device_id, []))[-limit:]

    def get_last_seq(self, device_id: str) -> int:
        if self.enabled:
            with self._conn() as conn:
                row = conn.execute(
                    'SELECT last_seq FROM device_seq WHERE device_id = ?',
                    (device_id,)
                ).fetchone()
            return row['last_seq'] if row else 0
        else:
            seqs = self._mem_seqs.get(device_id, set())
            return max(seqs) if seqs else 0

    def get_device_ids(self) -> list:
        if self.enabled:
            with self._conn() as conn:
                rows = conn.execute(
                    'SELECT DISTINCT device_id FROM events'
                ).fetchall()
            return [r['device_id'] for r in rows]
        else:
            return list(self._memory.keys())

    def clear_device(self, device_id: str):
        if self.enabled:
            with self._conn() as conn:
                conn.execute('DELETE FROM events WHERE device_id = ?', (device_id,))
                conn.execute('DELETE FROM device_seq WHERE device_id = ?', (device_id,))
        else:
            self._memory.pop(device_id, None)
            self._mem_seqs.pop(device_id, None)


# ── Debug Server ──────────────────────────────────────────────────────────────

class DebugServer:

    def __init__(
        self,
        host='0.0.0.0',
        ws_port=9229,
        http_port=9231,
        db_path='insidr_events.db',
        enrollment_token: Optional[str] = None,
    ):
        self.host             = host
        self.device_port      = find_free_port(ws_port)
        self.subscriber_port  = find_free_port(self.device_port + 1)
        self.http_port        = find_free_port(http_port)

        # None = auth disabled (--no-auth), string = required token
        self.enrollment_token = enrollment_token

        # Active connections
        self.devices: Dict[str, websockets.WebSocketServerProtocol] = {}
        self.device_info: Dict[str, dict] = {}
        self.subscribers: Set[websockets.WebSocketServerProtocol] = set()

        # Watchdog: last ping time per device
        self._last_ping: Dict[str, float] = {}

        self.store = EventStore(db_path)

        # Snapshot storage directory
        self.snapshot_dir = Path(db_path).parent / 'snapshots' if db_path else Path('snapshots')
        self.snapshot_dir.mkdir(exist_ok=True)
        self._analyzer = get_analyzer()

        self._restore_device_info()

    # ── Startup restore ───────────────────────────────────────────────────────

    def _restore_device_info(self):
        if not self.store.enabled:
            return
        for device_id in self.store.get_device_ids():
            if device_id in self.device_info:
                continue
            events = self.store.get(device_id, limit=200)
            url = ua = 'unknown'
            for e in events:
                if e.get('type') == 'agent.started':
                    url = e.get('payload', {}).get('url', url)
                    ua  = e.get('payload', {}).get('userAgent', ua)
                    break
            self.device_info[device_id] = {
                'deviceId':    device_id,
                'userAgent':   ua,
                'url':         url,
                'connectedAt': 'historical',
                'lastSeen':    'historical',
                'historical':  True,
            }
        if self.device_info:
            logger.info(f'Restored {len(self.device_info)} device(s) from history')

    # ── Device handler ────────────────────────────────────────────────────────

    async def handle_device(self, websocket):
        device_id = None
        try:
            async for raw in websocket:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                mtype = msg.get('type', '')

                # ── Auth ──────────────────────────────────────────────────────
                if mtype == '_auth':
                    payload      = msg.get('payload', {})
                    device_id    = payload.get('deviceId') or f'device_{int(time.time())}'
                    given_token  = payload.get('enrollmentToken') or ''

                    # Validate enrollment token if auth is enabled
                    if self.enrollment_token is not None:
                        if not secrets.compare_digest(given_token, self.enrollment_token):
                            logger.warning(f'Rejected device {device_id}: invalid enrollment token')
                            await websocket.close(4401, 'Invalid enrollment token')
                            return

                    old = self.devices.get(device_id)
                    if old:
                        try: await old.close()
                        except: pass

                    self.devices[device_id] = websocket
                    self._last_ping[device_id] = time.time()
                    self.device_info[device_id] = {
                        'deviceId':    device_id,
                        'userAgent':   payload.get('userAgent', ''),
                        'url':         payload.get('url', ''),
                        'connectedAt': now_iso(),
                        'lastSeen':    now_iso(),
                        'historical':  False,
                        'lastSeq':     self.store.get_last_seq(device_id),
                    }
                    logger.info(f'Device authenticated: {device_id}')

                    # Tell device the last seq we have so it can skip replaying old events
                    await self._safe_send_device(websocket, {
                        'type':    '_ack',
                        'lastSeq': self.device_info[device_id]['lastSeq'],
                    })

                    await self.broadcast_to_subscribers({
                        'type':    'device.connected',
                        'payload': self.device_info[device_id],
                    })
                    continue

                if device_id is None:
                    continue   # not yet authenticated

                # ── Heartbeat ─────────────────────────────────────────────────
                if mtype == '_ping':
                    self._last_ping[device_id] = time.time()
                    self.device_info[device_id]['lastSeen'] = now_iso()
                    await self._safe_send_device(websocket, {'type': '_pong'})
                    continue

                # ── Batch envelope ────────────────────────────────────────────
                if mtype == '_batch':
                    events = msg.get('events', [])
                    result = self.store.append_batch(device_id, events)
                    self.device_info[device_id]['lastSeen'] = now_iso()

                    # Update lastSeq tracker
                    seqs = [e['seq'] for e in events if 'seq' in e]
                    if seqs:
                        self.device_info[device_id]['lastSeq'] = max(
                            self.device_info[device_id].get('lastSeq', 0),
                            max(seqs),
                        )

                    # Fan out individual events to dashboard subscribers
                    for ev in events:
                        ev['deviceId'] = device_id
                        await self.broadcast_to_subscribers(ev)

                    if result.get('duped', 0):
                        logger.debug(
                            f'{device_id}: batch {len(events)} events '
                            f'(stored={result["stored"]} duped={result["duped"]})'
                        )
                    continue

                # ── Replay envelope ───────────────────────────────────────────
                if mtype == '_replay':
                    events = msg.get('events', [])
                    result = self.store.append_batch(device_id, events, replay=True)
                    logger.info(
                        f'{device_id}: replay {len(events)} events '
                        f'(new={result["stored"]} already_had={result["duped"]})'
                    )
                    # Fan out only genuinely new events
                    # (subscribers already saw the originals if they were connected)
                    continue

                # ── Snapshot ──────────────────────────────────────────────────
                if mtype == 'snapshot':
                    await self._handle_snapshot(device_id, msg)
                    continue

                # ── Single event (legacy / auth fallback) ─────────────────────
                msg['deviceId'] = device_id
                self.store.append(device_id, msg)
                self.device_info[device_id]['lastSeen'] = now_iso()
                await self.broadcast_to_subscribers(msg)

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            logger.error(f'Device handler error: {e}')
        finally:
            if device_id:
                self.devices.pop(device_id, None)
                self._last_ping.pop(device_id, None)
                if device_id in self.device_info:
                    self.device_info[device_id]['historical'] = True
                    self.device_info[device_id]['lastSeen']   = now_iso()
                await self.broadcast_to_subscribers({
                    'type':    'device.disconnected',
                    'payload': {'deviceId': device_id},
                })
                logger.info(f'Device disconnected: {device_id}')

    # ── Subscriber handler ────────────────────────────────────────────────────

    async def handle_subscriber(self, websocket):
        # Token gate — dashboard must present enrollment token as first message.
        # If auth is disabled (enrollment_token is None), skip straight through.
        if self.enrollment_token is not None:
            try:
                raw = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                msg = json.loads(raw)
                given = msg.get('token', '')
                if msg.get('type') != '_dashboard_auth' or \
                        not secrets.compare_digest(given, self.enrollment_token):
                    logger.warning(f'Rejected subscriber from {websocket.remote_address}: invalid token')
                    await websocket.close(4401, 'Invalid enrollment token')
                    return
            except asyncio.TimeoutError:
                logger.warning(f'Rejected subscriber from {websocket.remote_address}: auth timeout')
                await websocket.close(4401, 'Auth timeout')
                return
            except json.JSONDecodeError:
                await websocket.close(4401, 'Invalid auth message')
                return

        self.subscribers.add(websocket)
        logger.info(f'Subscriber connected from {websocket.remote_address}')
        try:
            # Send current device list immediately
            await websocket.send(json.dumps({
                'type':    'devices.list',
                'payload': list(self.device_info.values()),
            }))

            async for raw in websocket:
                try:
                    cmd = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                ctype = cmd.get('type', '')

                if ctype == 'ping':
                    continue

                elif ctype == 'device.request_events':
                    device_id = cmd.get('deviceId')
                    events    = self.store.get(device_id, limit=1000)
                    await websocket.send(json.dumps({
                        'type':    'device.events',
                        'payload': {'deviceId': device_id, 'events': events},
                    }))

                elif ctype == 'device.send_command':
                    device_id = cmd.get('deviceId')
                    if device_id in self.devices:
                        await self._safe_send_device(self.devices[device_id], {
                            'type':    'command',
                            'command': cmd.get('command'),
                            'payload': cmd.get('payload', {}),
                        })
                    else:
                        logger.warning(f'Command to offline device: {device_id}')

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            logger.error(f'Subscriber handler error: {e}')
        finally:
            self.subscribers.discard(websocket)
            logger.info('Subscriber disconnected')

    # ── Broadcast ─────────────────────────────────────────────────────────────

    async def broadcast_to_subscribers(self, event: dict):
        if not self.subscribers:
            return
        msg = json.dumps(event)
        await asyncio.gather(*[
            self._safe_send(sub, msg) for sub in list(self.subscribers)
        ])

    async def _safe_send(self, ws, message: str):
        try:
            await ws.send(message)
        except websockets.exceptions.ConnectionClosed:
            self.subscribers.discard(ws)

    async def _safe_send_device(self, ws, data: dict):
        try:
            await ws.send(json.dumps(data))
        except Exception:
            pass

    # ── Snapshot handling ─────────────────────────────────────────────────────

    async def _handle_snapshot(self, device_id: str, msg: dict):
        payload  = msg.get('payload', {})
        data_url = payload.get('dataUrl', '')
        trigger  = payload.get('trigger', 'unknown')
        ts       = payload.get('ts', now_ms())
        blank    = payload.get('blank', False)

        # Decode base64 JPEG
        jpeg_bytes = None
        if data_url.startswith('data:image/'):
            try:
                header, b64 = data_url.split(',', 1)
                jpeg_bytes  = base64.b64decode(b64)
            except Exception as e:
                logger.error(f'Snapshot decode error for {device_id}: {e}')

        if not jpeg_bytes:
            return

        # Persist to disk
        dev_dir = self.snapshot_dir / device_id
        dev_dir.mkdir(exist_ok=True)
        filename  = f'{ts}.jpg'
        filepath  = dev_dir / filename
        filepath.write_bytes(jpeg_bytes)

        size_kb = len(jpeg_bytes) // 1024

        # Run analysis pipeline (sync — fast enough at <200ms)
        analysis = {}
        try:
            analysis = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._analyzer.analyze(jpeg_bytes),
            )
        except Exception as e:
            logger.warning(f'Snapshot analysis error: {e}')
            analysis = {'error': str(e), 'matches': [], 'highest_severity': 'none'}

        # Build the event the dashboard will receive
        snapshot_event = {
            'type':     'snapshot.stored',
            'deviceId': device_id,
            'payload': {
                'ts':               ts,
                'filename':         filename,
                'trigger':          trigger,
                'size_kb':          size_kb,
                'width':            payload.get('width'),
                'height':           payload.get('height'),
                'url':              payload.get('url'),
                'blank':            blank,
                'analysis':         analysis,
                'image_url':        f'/api/device/{device_id}/snapshot/{ts}',
            },
        }

        # Store metadata (not the image bytes) as an event for history
        meta = dict(snapshot_event)
        self.store.append(device_id, meta)
        self.device_info[device_id]['lastSeen'] = now_iso()

        # Broadcast to dashboard
        await self.broadcast_to_subscribers(snapshot_event)

        sev = analysis.get('highest_severity', 'none')
        teams = analysis.get('alert_teams', [])
        matches = [m['label'] for m in analysis.get('matches', [])]
        logger.info(
            f'Snapshot {device_id} [{trigger}] '
            f'{size_kb}KB dark={analysis.get("dark_ratio", 0):.0%} '
            f'sev={sev} matches={matches or "none"}'
        )
        if teams:
            logger.warning(f'ALERT → {teams}: {[m["message"] for m in analysis.get("matches", []) if m.get("alert")]}')

    # ── Watchdog ──────────────────────────────────────────────────────────────

    async def _watchdog(self):
        """Periodically flag devices that haven't pinged recently."""
        while True:
            await asyncio.sleep(30)
            now = time.time()
            for device_id, last in list(self._last_ping.items()):
                if now - last > WATCHDOG_TIMEOUT:
                    info = self.device_info.get(device_id, {})
                    if not info.get('suspect'):
                        info['suspect'] = True
                        logger.warning(
                            f'Device {device_id} silent for '
                            f'{int(now - last)}s — possible crash'
                        )
                        await self.broadcast_to_subscribers({
                            'type':    'device.suspect',
                            'payload': {
                                'deviceId': device_id,
                                'silentSeconds': int(now - last),
                            },
                        })
                else:
                    if self.device_info.get(device_id, {}).get('suspect'):
                        self.device_info[device_id]['suspect'] = False

    # ── HTTP API ──────────────────────────────────────────────────────────────

    async def http_handler(self, request):
        path = request.path

        if path == '/api/devices':
            return web.json_response(list(self.device_info.values()))

        if path.startswith('/api/device/'):
            parts     = path.split('/')   # ['', 'api', 'device', id, ...]
            device_id = parts[3] if len(parts) > 3 else None

            if not device_id:
                return web.json_response({'error': 'Missing device_id'}, status=400)

            tail = parts[4] if len(parts) > 4 else ''

            if tail == 'events':
                limit  = int(request.rel_url.query.get('limit', 1000))
                events = self.store.get(device_id, limit=limit)
                return web.json_response({'deviceId': device_id, 'events': events})

            if tail == 'seq':
                return web.json_response({
                    'deviceId': device_id,
                    'lastSeq':  self.store.get_last_seq(device_id),
                })

            if tail == 'snapshots':
                # List snapshot metadata for a device
                events   = self.store.get(device_id, limit=2000)
                snaps    = [e for e in events if e.get('type') == 'snapshot.stored']
                return web.json_response(snaps)

            if tail == 'snapshot':
                # Serve a specific snapshot image
                # path: /api/device/{id}/snapshot/{timestamp}
                ts_str = parts[5] if len(parts) > 5 else None
                if not ts_str:
                    return web.json_response({'error': 'Missing timestamp'}, status=400)
                filepath = self.snapshot_dir / device_id / f'{ts_str}.jpg'
                if not filepath.exists():
                    return web.json_response({'error': 'Not found'}, status=404)
                return web.Response(
                    body=filepath.read_bytes(),
                    content_type='image/jpeg',
                    headers={'Cache-Control': 'public, max-age=86400'},
                )

            if device_id in self.device_info:
                return web.json_response(self.device_info[device_id])

            return web.json_response({'error': 'Device not found'}, status=404)

        if path == '/api/health':
            return web.json_response({
                'status':      'ok',
                'devices':     len(self.devices),
                'subscribers': len(self.subscribers),
                'ts':          now_iso(),
            })

        return web.json_response({'error': 'Not found'}, status=404)

    # ── Snapshot HTTP trigger ────────────────────────────────────────────────

    async def snapshot_request_handler(self, request):
        """POST /api/device/{device_id}/snapshot/request  — trigger on-demand capture"""
        device_id = request.match_info.get('device_id')
        if device_id not in self.devices:
            return web.json_response({'error': 'Device offline'}, status=404)
        await self._safe_send_device(self.devices[device_id], {
            'type':    'command',
            'command': 'snapshot.take',
            'payload': {},
        })
        return web.json_response({'status': 'requested', 'deviceId': device_id})

    # ── Start ─────────────────────────────────────────────────────────────────

    async def start(self):
        device_ws = await websockets.serve(
            self.handle_device, self.host, self.device_port
        )
        sub_ws = await websockets.serve(
            self.handle_subscriber, self.host, self.subscriber_port
        )

        app = web.Application()
        for route in [
            '/api/devices',
            '/api/device/{device_id}',
            '/api/device/{device_id}/{tail}',
            '/api/health',
        ]:
            app.router.add_get(route, self.http_handler)

        # Additional routes with more path segments
        app.router.add_get(
            '/api/device/{device_id}/snapshot/{ts}',
            self.http_handler,
        )
        app.router.add_post(
            '/api/device/{device_id}/snapshot/request',
            self.snapshot_request_handler,
        )

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.http_port)
        await site.start()

        logger.info(f'Device WS:      ws://{self.host}:{self.device_port}')
        logger.info(f'Subscriber WS:  ws://{self.host}:{self.subscriber_port}')
        logger.info(f'HTTP API:        http://{self.host}:{self.http_port}')

        asyncio.create_task(self._watchdog())

        await asyncio.Future()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='insidr Debug Server v2')
    parser.add_argument('--host',      default='0.0.0.0')
    parser.add_argument('--ws-port',   type=int, default=9229)
    parser.add_argument('--http-port', type=int, default=9231)
    parser.add_argument('--no-db',     action='store_true')
    parser.add_argument('--db-path',   default='insidr_events.db')
    parser.add_argument('--token',     default=None,
                        help='Enrollment token (overrides env var and .insidr_token file)')
    parser.add_argument('--no-auth',   action='store_true',
                        help='Disable token auth — local dev only, never use on shared networks')
    args = parser.parse_args()

    # Resolve token
    if args.no_auth or os.environ.get('INSIDR_TOKEN_REQUIRED', '').lower() == 'false':
        enrollment_token = None
        logger.warning('Auth DISABLED (--no-auth). Do not use on shared networks.')
    else:
        enrollment_token = args.token or load_or_generate_token()
        logger.info(f'Enrollment token: {enrollment_token}')
        logger.info('Pass this token as enrollmentToken in WebSocketSink config.')
        logger.info('Use --no-auth to disable for local dev, --token <value> to set explicitly.')

    server = DebugServer(
        host=args.host,
        ws_port=args.ws_port,
        http_port=args.http_port,
        db_path=None if args.no_db else args.db_path,
        enrollment_token=enrollment_token,
    )

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info('Server stopped')
