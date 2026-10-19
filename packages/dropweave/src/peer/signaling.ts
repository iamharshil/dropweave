/**
 * WebSocket signaling client.
 *
 * Connects to the signaling server, sends/receives session and WebRTC
 * signaling messages. Used by both the send and receive CLI commands.
 */

import type { SignalingMessage, SignalingType } from '../core/types.js';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalingClientConfig {
  url: string;
}

export interface SignalingClientEvents {
  open: () => void;
  close: () => void;
  error: (err: Error) => void;
  message: (msg: SignalingMessage) => void;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SignalingClient extends EventEmitter {
  private ws: any = null;
  private isStandardWs = false;
  private readonly url: string;
  private _isConnected = false;

  constructor(config: SignalingClientConfig) {
    super();
    this.url = config.url;
  }

  /** Whether the WebSocket is currently connected. */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to the signaling server.
   * Returns a promise that resolves when the connection is established.
   */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        if (typeof globalThis.WebSocket !== 'undefined') {
          this.isStandardWs = true;
          const ws = new globalThis.WebSocket(this.url);
          this.ws = ws;

          ws.onopen = () => {
            this._isConnected = true;
            this.emit('open');
            resolve();
          };

          ws.onclose = () => {
            this._isConnected = false;
            this.emit('close');
          };

          ws.onerror = (event: any) => {
            const error = new Error(
              `Signaling error: ${event?.message || 'WebSocket connection error'}`,
            );
            this.emit('error', error);
            if (!this._isConnected) reject(error);
          };

          ws.onmessage = (event: any) => {
            this.handleIncoming(event.data);
          };
        } else {
          // Fallback to node-datachannel's built-in WebSocket client
          this.isStandardWs = false;
          const ndcModule = require('node-datachannel') as typeof import('node-datachannel');
          const ws = new ndcModule.WebSocket();
          this.ws = ws;

          ws.open(this.url);

          ws.onOpen(() => {
            this._isConnected = true;
            this.emit('open');
            resolve();
          });

          ws.onClosed(() => {
            this._isConnected = false;
            this.emit('close');
          });

          ws.onError((err: string) => {
            const error = new Error(`Signaling error: ${err}`);
            this.emit('error', error);
            if (!this._isConnected) reject(error);
          });

          ws.onMessage((data: string | Buffer) => {
            this.handleIncoming(data);
          });
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleIncoming(data: any): void {
    try {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      const msg = JSON.parse(text) as SignalingMessage;

      // Basic validation
      if (msg.v !== 1 || typeof msg.type !== 'string') {
        this.emit(
          'error',
          new Error('Invalid signaling message: missing v or type'),
        );
        return;
      }

      this.emit('message', msg);
    } catch (err) {
      this.emit(
        'error',
        new Error(`Failed to parse signaling message: ${err}`),
      );
    }
  }

  /**
   * Send a signaling message to the server.
   */
  send(
    type: SignalingType,
    payload?: Record<string, unknown>,
    sessionCode?: string,
  ): void {
    if (!this._isConnected || !this.ws) {
      throw new Error('Signaling client not connected');
    }

    const msg: SignalingMessage = {
      v: 1,
      type,
      ...(sessionCode ? { sessionCode } : {}),
      ...(payload ? { payload } : {}),
    };

    const str = JSON.stringify(msg);
    if (this.isStandardWs) {
      this.ws.send(str);
    } else {
      this.ws.sendMessage(str);
    }
  }

  /**
   * Wait for a specific message type.
   * Returns a promise that resolves with the message payload.
   */
  waitFor(
    type: SignalingType,
    timeoutMs: number = 30000,
  ): Promise<SignalingMessage> {
    return new Promise<SignalingMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('message', handler);
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeoutMs);

      const handler = (msg: SignalingMessage) => {
        if (msg.type === type) {
          clearTimeout(timeout);
          this.removeListener('message', handler);
          resolve(msg);
        }
      };

      this.on('message', handler);
    });
  }

  /**
   * Close the signaling connection.
   */
  close(): void {
    this._isConnected = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Already closed
      }
      this.ws = null;
    }
    this.removeAllListeners();
  }
}
