/**
 * WebRTC peer connection wrapper using node-datachannel.
 *
 * Provides a clean async API over the C++ bindings. Handles ICE,
 * SDP exchange, data channel creation, and lifecycle management.
 */

import {
  PeerConnection as NDCPeerConnection,
  DataChannel as NDCDataChannel,
  DescriptionType,
} from 'node-datachannel';
import { ConnectionMode, type IceServerConfig } from '../core/types.js';
import { DEFAULT_ICE_SERVERS } from '../core/constants.js';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeerConnectionConfig {
  iceServers?: IceServerConfig[];
}

export interface PeerConnectionEvents {
  'local-description': (sdp: string, type: string) => void;
  'local-candidate': (candidate: string, mid: string) => void;
  'state-change': (state: string) => void;
  'gathering-complete': () => void;
  'data-channel': (channel: DataChannelWrapper) => void;
  error: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// Data Channel Wrapper
// ---------------------------------------------------------------------------

export class DataChannelWrapper extends EventEmitter {
  private readonly dc: NDCDataChannel;
  private _isOpen = false;

  constructor(dc: NDCDataChannel) {
    super();
    this.dc = dc;

    dc.onOpen(() => {
      this._isOpen = true;
      this.emit('open');
    });

    dc.onClosed(() => {
      this._isOpen = false;
      this.emit('close');
    });

    dc.onError((err: string) => {
      this.emit('error', new Error(err));
    });

    dc.onMessage((msg: string | Buffer) => {
      if (typeof msg === 'string') {
        this.emit('message', new TextEncoder().encode(msg));
      } else {
        this.emit('message', new Uint8Array(msg));
      }
    });
  }

  /** Whether the data channel is currently open. */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Get the current buffered amount in bytes. */
  get bufferedAmount(): number {
    try {
      return this.dc.bufferedAmount();
    } catch {
      return 0;
    }
  }

  /** Send binary data over the data channel. */
  sendBinary(data: Uint8Array): boolean {
    if (!this._isOpen) return false;
    try {
      this.dc.sendMessageBinary(Buffer.from(data));
      return true;
    } catch {
      return false;
    }
  }

  /** Close the data channel. */
  close(): void {
    try {
      this._isOpen = false;
      this.dc.close();
    } catch {
      // Already closed
    }
  }
}

// ---------------------------------------------------------------------------
// Peer Connection Wrapper
// ---------------------------------------------------------------------------

export class PeerConnectionWrapper extends EventEmitter {
  private readonly pc: NDCPeerConnection;
  private _connectionMode: ConnectionMode = ConnectionMode.Unknown;

  constructor(config: PeerConnectionConfig = {}) {
    super();

    const iceServers = config.iceServers ?? DEFAULT_ICE_SERVERS;

    // Convert ICE servers to the format node-datachannel expects
    const iceServerStrings: string[] = [];
    for (const server of iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const url of urls) {
        if (server.username && server.credential) {
          // TURN: turn:host:port?transport=udp
          iceServerStrings.push(
            `${url}:${server.username}:${server.credential}`,
          );
        } else {
          iceServerStrings.push(url);
        }
      }
    }

    this.pc = new NDCPeerConnection('dropweave', {
      iceServers: iceServerStrings,
    });

    this.pc.onStateChange((state: string) => {
      this.emit('state-change', state);
    });

    this.pc.onGatheringStateChange((state: string) => {
      if (state === 'complete') {
        this.emit('gathering-complete');
      }
    });

    this.pc.onLocalDescription((sdp: string, type: string) => {
      this.emit('local-description', sdp, type);
    });

    this.pc.onLocalCandidate((candidate: string, mid: string) => {
      this.emit('local-candidate', candidate, mid);
    });

    this.pc.onDataChannel((dc: NDCDataChannel) => {
      this.emit('data-channel', new DataChannelWrapper(dc));
    });
  }

  /** Get the detected connection mode (direct/relayed/unknown). */
  get connectionMode(): ConnectionMode {
    return this._connectionMode;
  }

  /**
   * Create a data channel (initiator side).
   */
  createDataChannel(label: string): DataChannelWrapper {
    const dc = this.pc.createDataChannel(label);
    return new DataChannelWrapper(dc);
  }

  /**
   * Set the remote SDP description.
   */
  setRemoteDescription(sdp: string, type: string): void {
    this.pc.setRemoteDescription(sdp, type as DescriptionType);
  }

  /**
   * Add a remote ICE candidate.
   */
  addRemoteCandidate(candidate: string, mid: string): void {
    this.pc.addRemoteCandidate(candidate, mid);
  }

  /**
   * Get the local SDP description (for sending to remote peer via signaling).
   */
  localDescription(): { sdp: string; type: string } | null {
    const desc = this.pc.localDescription();
    if (!desc) return null;
    return { sdp: desc.sdp, type: desc.type };
  }

  /**
   * Try to determine if the connection is direct or relayed.
   * This inspects the selected ICE candidate pair when available.
   */
  detectConnectionMode(): ConnectionMode {
    try {
      const selected = this.pc.getSelectedCandidatePair();
      if (selected) {
        const local = selected.local;
        if (local && typeof local === 'object' && 'type' in local) {
          const candidateType = (local as { type: string }).type;
          if (candidateType === 'relay') {
            this._connectionMode = ConnectionMode.Relayed;
          } else {
            this._connectionMode = ConnectionMode.Direct;
          }
        }
      }
    } catch {
      // Not all implementations support getSelectedCandidatePair
    }
    return this._connectionMode;
  }

  /**
   * Close the peer connection and release resources.
   */
  close(): void {
    try {
      this.pc.close();
    } catch {
      // Already closed
    }
    this.removeAllListeners();
  }
}
