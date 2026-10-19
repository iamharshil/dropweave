/**
 * WebSocket message handler for the signaling server.
 *
 * Routes incoming signaling messages, validates them, and dispatches
 * to the session manager. Zero-knowledge: no logging of codes, IPs,
 * or payload content.
 */

import type { ServerWebSocket } from 'bun';
import type { SocketData } from '../sessions/session.js';
import { ServerSessionState } from '../sessions/session.js';
import { SessionManager } from '../sessions/manager.js';
import { RateLimiterRegistry } from '../rate-limit/token-bucket.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalingMessage {
  v: 1;
  type: string;
  sessionCode?: string;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class MessageHandler {
  private readonly sessions: SessionManager;
  private readonly rateLimiter: RateLimiterRegistry;

  constructor(sessions: SessionManager, rateLimiter: RateLimiterRegistry) {
    this.sessions = sessions;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Handle an incoming WebSocket message.
   */
  handle(ws: ServerWebSocket<SocketData>, raw: string): void {
    // Rate limit
    const bucket = this.rateLimiter.get(ws.data.id);
    if (!bucket.consume()) {
      this.sendError(ws, 'RATE_LIMITED', 'Too many requests');
      return;
    }

    // Parse
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendError(ws, 'INVALID_MESSAGE', 'Malformed JSON');
      return;
    }

    // Validate envelope
    if (msg.v !== 1 || typeof msg.type !== 'string') {
      this.sendError(ws, 'INVALID_MESSAGE', 'Missing version or type');
      return;
    }

    // Route
    switch (msg.type) {
      case 'session:create':
        this.handleCreate(ws);
        break;

      case 'session:join':
        this.handleJoin(ws, msg);
        break;

      case 'session:approve':
        this.handleApprove(ws);
        break;

      case 'session:reject':
        this.handleReject(ws);
        break;

      case 'peer:offer':
      case 'peer:answer':
      case 'peer:ice-candidate':
        this.handlePeerSignaling(ws, msg);
        break;

      case 'session:close':
        this.handleClose(ws);
        break;

      default:
        this.sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`);
    }
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private handleCreate(ws: ServerWebSocket<SocketData>): void {
    // Don't allow creating multiple sessions from same connection
    if (ws.data.sessionCode) {
      this.sendError(ws, 'ALREADY_IN_SESSION', 'Already in a session');
      return;
    }

    const code = this.sessions.createSession(ws);
    const session = this.sessions.getSession(code)!;
    const expiresIn = Math.floor((session.expiresAt - Date.now()) / 1000);

    this.send(ws, {
      v: 1,
      type: 'session:created',
      sessionCode: code,
      payload: { code, expiresIn },
    });
  }

  private handleJoin(ws: ServerWebSocket<SocketData>, msg: SignalingMessage): void {
    if (ws.data.sessionCode) {
      this.sendError(ws, 'ALREADY_IN_SESSION', 'Already in a session');
      return;
    }

    const code = msg.sessionCode ?? (msg.payload?.code as string);
    if (!code || typeof code !== 'string') {
      this.sendError(ws, 'INVALID_CODE', 'Missing session code');
      return;
    }

    // Track join attempts per connection
    ws.data.joinAttempts++;
    if (ws.data.joinAttempts > 5) {
      const cooldownRemaining = ws.data.lastAttemptAt + 30000 - Date.now();
      if (cooldownRemaining > 0) {
        this.sendError(ws, 'RATE_LIMITED', 'Too many join attempts. Try again later.');
        return;
      }
      // Reset after cooldown
      ws.data.joinAttempts = 1;
    }
    ws.data.lastAttemptAt = Date.now();

    const session = this.sessions.joinSession(code, ws);

    if (!session) {
      // Deliberately vague error to prevent code enumeration
      this.sendError(ws, 'JOIN_FAILED', 'Invalid or expired code');
      return;
    }

    // Notify the host that a peer wants to join
    if (session.hostSocket) {
      this.send(session.hostSocket, {
        v: 1,
        type: 'session:join-requested',
        sessionCode: session.code,
      });
    }
  }

  private handleApprove(ws: ServerWebSocket<SocketData>): void {
    const code = ws.data.sessionCode;
    if (!code || ws.data.role !== 'host') {
      this.sendError(ws, 'NOT_HOST', 'Only the host can approve');
      return;
    }

    const session = this.sessions.approveSession(code);
    if (!session) {
      this.sendError(ws, 'INVALID_STATE', 'Cannot approve in current state');
      return;
    }

    // Notify both host and joiner
    for (const sock of [session.hostSocket, session.joinerSocket]) {
      if (sock) {
        this.send(sock, {
          v: 1,
          type: 'session:approved',
          sessionCode: code,
        });
      }
    }
  }

  private handleReject(ws: ServerWebSocket<SocketData>): void {
    const code = ws.data.sessionCode;
    if (!code || ws.data.role !== 'host') {
      this.sendError(ws, 'NOT_HOST', 'Only the host can reject');
      return;
    }

    const session = this.sessions.getSession(code);
    if (!session) return;

    // Notify the joiner
    if (session.joinerSocket) {
      this.send(session.joinerSocket, {
        v: 1,
        type: 'session:rejected',
        payload: { reason: 'Host rejected the connection' },
      });
    }

    // Remove session
    this.sessions.removeSession(code);
  }

  private handlePeerSignaling(ws: ServerWebSocket<SocketData>, msg: SignalingMessage): void {
    const code = ws.data.sessionCode;
    if (!code) {
      this.sendError(ws, 'NOT_IN_SESSION', 'Not in a session');
      return;
    }

    const session = this.sessions.getSession(code);
    if (!session) {
      this.sendError(ws, 'SESSION_NOT_FOUND', 'Session not found');
      return;
    }

    // Must be approved to exchange signaling
    if (
      session.state !== ServerSessionState.Approved &&
      session.state !== ServerSessionState.Negotiating
    ) {
      this.sendError(ws, 'INVALID_STATE', 'Session not in negotiating state');
      return;
    }

    // Transition to negotiating if not already
    this.sessions.startNegotiating(code);

    // Relay to the other peer
    const target =
      ws.data.role === 'host' ? session.joinerSocket : session.hostSocket;

    if (target) {
      this.send(target, {
        v: 1,
        type: msg.type,
        sessionCode: code,
        payload: msg.payload,
      });
    }
  }

  private handleClose(ws: ServerWebSocket<SocketData>): void {
    this.sessions.handleDisconnect(ws);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private send(ws: ServerWebSocket<SocketData>, msg: SignalingMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket closed
    }
  }

  private sendError(
    ws: ServerWebSocket<SocketData>,
    code: string,
    message: string,
  ): void {
    this.send(ws, {
      v: 1,
      type: 'session:error',
      payload: { code, message },
    });
  }
}
