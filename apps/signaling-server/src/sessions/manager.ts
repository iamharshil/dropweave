/**
 * In-memory session manager for the signaling server.
 *
 * Zero-knowledge: stores only ephemeral session codes mapped to socket pairs.
 * No IPs, no logs, no fingerprints. Everything evicted on session close or expiry.
 */

import { randomBytes } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import {
  ServerSessionState,
  type Session,
  type SocketData,
} from './session.js';

// ---------------------------------------------------------------------------
// Crockford Base32 (duplicated from client to avoid cross-package dep)
// ---------------------------------------------------------------------------

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

function generateCode(): string {
  const chars: string[] = [];
  while (chars.length < CODE_LENGTH) {
    const bytes = randomBytes(CODE_LENGTH - chars.length);
    for (const byte of bytes) {
      if (chars.length >= CODE_LENGTH) break;
      chars.push(CROCKFORD_ALPHABET[byte % 32]!);
    }
  }
  return chars.join('');
}

function normalizeCode(input: string): string {
  const subs: Record<string, string> = { O: '0', o: '0', I: '1', i: '1', L: '1', l: '1' };
  return input
    .replace(/[-\s_.]/g, '')
    .split('')
    .map((ch) => (subs[ch] ?? ch).toUpperCase())
    .join('');
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly defaultTimeoutMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(defaultTimeoutMs: number = 600_000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /** Start the periodic cleanup sweep. */
  startCleanup(intervalMs: number = 30_000): void {
    this.cleanupInterval = setInterval(() => {
      this.sweep();
    }, intervalMs);
  }

  /** Stop the cleanup sweep. */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create a new session.
   * Returns the generated code.
   */
  createSession(hostSocket: ServerWebSocket<SocketData>): string {
    // Generate a unique code
    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 100) {
        throw new Error('Failed to generate unique session code');
      }
    } while (this.sessions.has(code));

    const now = Date.now();
    const session: Session = {
      code,
      state: ServerSessionState.Waiting,
      hostSocket,
      joinerSocket: null,
      createdAt: now,
      expiresAt: now + this.defaultTimeoutMs,
    };

    this.sessions.set(code, session);

    // Update socket data
    hostSocket.data.sessionCode = code;
    hostSocket.data.role = 'host';

    return code;
  }

  /**
   * Join an existing session.
   * Returns the session if the code is valid and the session is in the right state.
   */
  joinSession(
    code: string,
    joinerSocket: ServerWebSocket<SocketData>,
  ): Session | null {
    const normalized = normalizeCode(code);
    const session = this.sessions.get(normalized);

    if (!session) return null;
    if (session.state !== ServerSessionState.Waiting) return null;
    if (Date.now() > session.expiresAt) {
      this.removeSession(normalized);
      return null;
    }

    session.state = ServerSessionState.PeerRequested;
    session.joinerSocket = joinerSocket;

    joinerSocket.data.sessionCode = normalized;
    joinerSocket.data.role = 'joiner';

    return session;
  }

  /**
   * Approve a join request (host approves joiner).
   */
  approveSession(code: string): Session | null {
    const session = this.sessions.get(code);
    if (!session || session.state !== ServerSessionState.PeerRequested) {
      return null;
    }

    session.state = ServerSessionState.Approved;
    return session;
  }

  /**
   * Transition to negotiating state.
   */
  startNegotiating(code: string): Session | null {
    const session = this.sessions.get(code);
    if (!session) return null;
    if (
      session.state !== ServerSessionState.Approved &&
      session.state !== ServerSessionState.Negotiating
    ) {
      return null;
    }
    session.state = ServerSessionState.Negotiating;
    return session;
  }

  /** Get a session by code. */
  getSession(code: string): Session | null {
    return this.sessions.get(normalizeCode(code)) ?? null;
  }

  /** Remove a session and free all references. */
  removeSession(code: string): void {
    const normalized = normalizeCode(code);
    const session = this.sessions.get(normalized);
    if (session) {
      session.hostSocket = null;
      session.joinerSocket = null;
      this.sessions.delete(normalized);
    }
  }

  /**
   * Handle a socket disconnect — clean up any session it belongs to.
   */
  handleDisconnect(socket: ServerWebSocket<SocketData>): void {
    const code = socket.data.sessionCode;
    if (!code) return;

    const session = this.sessions.get(code);
    if (!session) return;

    // Notify the other peer
    const otherSocket =
      session.hostSocket === socket
        ? session.joinerSocket
        : session.hostSocket;

    if (otherSocket) {
      try {
        otherSocket.send(
          JSON.stringify({
            v: 1,
            type: 'session:close',
            payload: { reason: 'Peer disconnected' },
          }),
        );
      } catch {
        // Other socket may already be closed
      }
    }

    this.removeSession(code);
  }

  /** Sweep expired sessions. */
  private sweep(): void {
    const now = Date.now();
    for (const [code, session] of this.sessions) {
      if (now > session.expiresAt) {
        // Notify connected sockets
        for (const sock of [session.hostSocket, session.joinerSocket]) {
          if (sock) {
            try {
              sock.send(
                JSON.stringify({
                  v: 1,
                  type: 'session:error',
                  payload: { code: 'EXPIRED', message: 'Session expired' },
                }),
              );
            } catch {
              // Socket may be closed
            }
          }
        }
        this.removeSession(code);
      }
    }
  }

  /** Current number of active sessions (for metrics, no identifying data). */
  get activeCount(): number {
    return this.sessions.size;
  }
}
