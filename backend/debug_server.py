#!/usr/bin/env python3
"""
insidr Debug Server

WebSocket server that receives debugging events from remote devices
and serves a web UI for viewing them.
"""

import asyncio
import json
import logging
import socket
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
    """
    Find next available TCP port starting from `port`
    """
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                port += 1


class DebugServer:

    def __init__(self, host='0.0.0.0', ws_port=9229, http_port=9231):

        self.host = host

        # Resolve ports safely
        self.device_port = find_free_port(ws_port)
        self.subscriber_port = find_free_port(self.device_port + 1)
        self.http_port = find_free_port(http_port)

        # Store connections by device ID
        self.devices: Dict[str, websockets.WebSocketServerProtocol] = {}

        # Store events by device ID
        self.device_events: Dict[str, list] = defaultdict(list)

        # Store device info
        self.device_info: Dict[str, dict] = {}

        # Subscribers (UI clients)
        self.subscribers: Set[websockets.WebSocketServerProtocol] = set()

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
                            'userAgent': event['payload']['userAgent'],
                            'url': event['payload']['url'],
                            'connectedAt': datetime.now().isoformat(),
                            'lastSeen': datetime.now().isoformat()
                        }

                        logger.info(f"Device authenticated: {device_id}")

                        await self.broadcast_to_subscribers({
                            'type': 'device.connected',
                            'payload': self.device_info[device_id]
                        })

                        continue

                    if device_id:

                        event['deviceId'] = device_id
                        self.device_events[device_id].append(event)

                        if len(self.device_events[device_id]) > 1000:
                            self.device_events[device_id] = self.device_events[device_id][-1000:]

                        self.device_info[device_id]['lastSeen'] = datetime.now().isoformat()

                        await self.broadcast_to_subscribers(event)

                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON from device: {message}")

                except Exception as e:
                    logger.error(f"Error processing event: {e}")

        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Device disconnected: {device_id or 'unknown'}")

        finally:

            if device_id and device_id in self.devices:

                del self.devices[device_id]

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

                    if command['type'] == 'device.request_events':

                        device_id = command['deviceId']

                        events = self.device_events.get(device_id, [])

                        await websocket.send(json.dumps({
                            'type': 'device.events',
                            'payload': {
                                'deviceId': device_id,
                                'events': events
                            }
                        }))

                    elif command['type'] == 'device.send_command':

                        device_id = command['deviceId']

                        if device_id in self.devices:

                            await self.devices[device_id].send(json.dumps({
                                'type': 'command',
                                'command': command['command'],
                                'payload': command.get('payload', {})
                            }))

                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON from subscriber: {message}")

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

            device_id = request.path.split('/')[-1]

            if device_id in self.device_info:

                return web.json_response({
                    'info': self.device_info[device_id],
                    'events': self.device_events.get(device_id, [])
                })

            return web.json_response({'error': 'Device not found'}, status=404)

        return web.json_response({'error': 'Not found'}, status=404)

    async def start(self):

        device_server = await websockets.serve(
            self.handle_device,
            self.host,
            self.device_port
        )

        logger.info(f"Device WebSocket server listening on ws://{self.host}:{self.device_port}")

        subscriber_server = await websockets.serve(
            self.handle_subscriber,
            self.host,
            self.subscriber_port
        )

        logger.info(f"Subscriber WebSocket server listening on ws://{self.host}:{self.subscriber_port}")

        app = web.Application()

        app.router.add_get('/api/devices', self.http_handler)
        app.router.add_get('/api/device/{device_id}', self.http_handler)

        runner = web.AppRunner(app)

        await runner.setup()

        site = web.TCPSite(runner, self.host, self.http_port)

        await site.start()

        logger.info(f"HTTP API listening on http://{self.host}:{self.http_port}")

        await asyncio.Future()


if __name__ == '__main__':

    parser = argparse.ArgumentParser(description='insidr Debug Server')

    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--ws-port', type=int, default=9229)
    parser.add_argument('--http-port', type=int, default=9231)

    args = parser.parse_args()

    server = DebugServer(
        host=args.host,
        ws_port=args.ws_port,
        http_port=args.http_port
    )

    try:
        asyncio.run(server.start())

    except KeyboardInterrupt:
        logger.info("Server stopped")
