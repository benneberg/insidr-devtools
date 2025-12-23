/**
 * WebSocket Transport Sink
 * 
 * Streams debugging events to remote server via WebSocket.
 * Handles reconnection, buffering, and command reception.
 */

class WebSocketSink {
  constructor(config = {}) {
    this.config = {
      url: config.url || 'ws://localhost:9229/insidr',
      reconnect: config.reconnect !== false,
      reconnectInterval: config.reconnectInterval || 3000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      bufferSize: config.bufferSize || 100,
      authToken: config.authToken || null,
      deviceId: config.deviceId || this.generateDeviceId(),
      ...config
    };

    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.eventBuffer = [];
    this.commandHandlers = new Map();
  }

  /**
   * Connect to remote server
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          console.log('[insidr] Connected to remote server');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          // Send authentication
          this.send({
            type: '_auth',
            payload: {
              deviceId: this.config.deviceId,
              authToken: this.config.authToken,
              userAgent: navigator.userAgent,
              url: window.location.href
            }
          });

          // Flush buffered events
          this.flushBuffer();

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[insidr] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[insidr] Disconnected from remote server');
          this.isConnected = false;

          if (this.config.reconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
              console.log(`[insidr] Reconnecting... (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
              this.connect();
            }, this.config.reconnectInterval);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send event to remote server
   */
  send(event) {
    if (!this.isConnected) {
      // Buffer events when disconnected
      if (this.eventBuffer.length < this.config.bufferSize) {
        this.eventBuffer.push(event);
      }
      return;
    }

    try {
      this.ws.send(JSON.stringify(event));
    } catch (error) {
      console.error('[insidr] Failed to send event:', error);
    }
  }

  /**
   * Flush buffered events
   */
  flushBuffer() {
    if (this.eventBuffer.length === 0) return;

    console.log(`[insidr] Flushing ${this.eventBuffer.length} buffered events`);
    
    this.eventBuffer.forEach(event => {
      this.send(event);
    });

    this.eventBuffer = [];
  }

  /**
   * Handle incoming messages from server
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'command') {
        this.executeCommand(message.command, message.payload);
      }
    } catch (error) {
      console.error('[insidr] Failed to handle message:', error);
    }
  }

  /**
   * Register command handler
   */
  onCommand(command, handler) {
    this.commandHandlers.set(command, handler);
  }

  /**
   * Execute command from server
   */
  executeCommand(command, payload) {
    const handler = this.commandHandlers.get(command);
    
    if (handler) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[insidr] Command handler error (${command}):`, error);
      }
    } else {
      console.warn(`[insidr] No handler for command: ${command}`);
    }
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.ws) {
      this.config.reconnect = false;
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Generate unique device ID
   */
  generateDeviceId() {
    let deviceId = localStorage.getItem('insidr_device_id');
    
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('insidr_device_id', deviceId);
    }

    return deviceId;
  }
}

export default WebSocketSink;
