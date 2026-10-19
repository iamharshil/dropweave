/**
 * Session model and state management for the signaling server.
 *
 * Each session represents a single host ↔ joiner pairing.
 * All state is ephemeral — held in memory, freed on completion/expiry.
 */

import type { ServerWebSocket } from 'bun';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum ServerSessionState {
  Waiting = 'waiting',
  PeerRequested = 'peer-requested',
  Approved = 'approved',
  Negotiating = 'negotiating',
  Connected = 'connected',
  Closed = 'closed',
}

export interface Session {
  code: string;
  state: ServerSessionState;
  hostSocket: ServerWebSocket<SocketData> | null;
  joinerSocket: ServerWebSocket<SocketData> | null;
  createdAt: number;
  expiresAt: number;
}

export interface SocketData {
  id: string;        // Opaque connection ID (no IP)
  sessionCode: string | null;
  role: 'host' | 'joiner' | null;
  joinAttempts: number;
  lastAttemptAt: number;
}
