#!/usr/bin/env python3
"""
insidr Debug Server

WebSocket server that receives debugging events from remote devices
and serves a web UI for viewing them.

Usage:
    python debug_server.py [--port 9229] [--host 0.0.0.0]
"""

import asyncio
import json
import logging
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

class DebugServer:
    def __init__(self, host='0.0.0.0', ws_port=9229, http_port=9230):
        self.host = host
        self.ws_port = ws_port
        self.http_port = http_port
        
        # Store connections by device ID
        self.devices: Dict[str, websockets.WebSocketServerProtocol] = {}
        
        # Store events by device ID
        self.device_events: Dict[str, list] = defaultdict(list)
        
        # Store device info
        self.device_info: Dict[str, dict] = {}
        
        # Subscribers (UI clients)
        self.subscribers: Set[websockets.WebSocketServerProtocol] = set()

    async def handle_device(self, websocket, path):
        """
        Handle connection from debugging agent on device
        """
        device_id = None
        
        try:
            logger.info(f"Device connected from {websocket.remote_address}")
            
            async for message in websocket:
                try:
                    event = json.loads(message)
                    
                    # Handle authentication
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
                        
                        # Notify subscribers
                        await self.broadcast_to_subscribers({
                            'type': 'device.connected',
                            'payload': self.device_info[device_id]
                        })
                        continue
                    
                    # Store event
                    if device_id:
                        event['deviceId'] = device_id
                        self.device_events[device_id].append(event)
                        
                        # Keep only recent events (last 1000)
                        if len(self.device_events[device_id]) > 1000:
                            self.device_events[device_id] = self.device_events[device_id][-1000:]
                        
                        # Update last seen
                        self.device_info[device_id]['lastSeen'] = datetime.now().isoformat()
                        
                        # Broadcast to subscribers
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
        """
        Handle connection from UI client
        """
        logger.info(f"Subscriber connected from {websocket.remote_address}")
        self.subscribers.add(websocket)
        
        try:
            # Send list of connected devices
            await websocket.send(json.dumps({
                'type': 'devices.list',
                'payload': list(self.device_info.values())
            }))
            
            async for message in websocket:
                try:
                    command = json.loads(message)
                    
                    if command['type'] == 'device.request_events':
                        # Send all events for a device
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
                        # Forward command to device
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
        """
        Broadcast event to all UI subscribers
        """
        if not self.subscribers:
            return
            
        message = json.dumps(event)
        disconnected = set()
        
        for subscriber in self.subscribers:
            try:
                await subscriber.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected.add(subscriber)
        
        # Remove disconnected subscribers
        self.subscribers -= disconnected

    async def http_handler(self, request):
        """
        Serve HTTP API
        """
        if request.path == '/api/devices':
            return web.json_response(list(self.device_info.values()))
        
        elif request.path.startswith('/api/device/'):
            device_id = request.path.split('/')[-1]
            
            if device_id in self.device_info:
                return web.json_response({
                    'info': self.device_info[device_id],
                    'events': self.device_events.get(device_id, [])
                })
            else:
                return web.json_response({'error': 'Device not found'}, status=404)
        
        return web.json_response({'error': 'Not found'}, status=404)

    async def start(self):
        """
        Start WebSocket servers and HTTP API
        """
        # WebSocket server for devices
        device_server = await websockets.serve(
            self.handle_device,
            self.host,
            self.ws_port
        )
        logger.info(f"Device WebSocket server listening on ws://{self.host}:{self.ws_port}")
        
        # WebSocket server for subscribers (UI)
        subscriber_server = await websockets.serve(
            self.handle_subscriber,
            self.host,
            self.ws_port + 1  # 9230
        )
        logger.info(f"Subscriber WebSocket server listening on ws://{self.host}:{self.ws_port + 1}")
        
        # HTTP API server
        app = web.Application()
        app.router.add_get('/api/devices', self.http_handler)
        app.router.add_get('/api/device/{device_id}', self.http_handler)
        
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.http_port)
        await site.start()
        logger.info(f"HTTP API listening on http://{self.host}:{self.http_port}")
        
        # Keep running
        await asyncio.Future()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='insidr Debug Server')
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to')
    parser.add_argument('--ws-port', type=int, default=9229, help='WebSocket port for devices')
    parser.add_argument('--http-port', type=int, default=9230, help='HTTP API port')
    
    args = parser.parse_args()
    
    server = DebugServer(host=args.host, ws_port=args.ws_port, http_port=args.http_port)
    
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Server stopped")
