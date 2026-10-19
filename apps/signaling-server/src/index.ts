/**
 * Signaling server entry point.
 *
 * Zero-knowledge Bun WebSocket server for dropweave peer pairing.
 * - No IPs logged
 * - No persistent state
 * - No file data ever touches this server
 */

import { randomBytes } from 'node:crypto';
import { SessionManager } from './sessions/manager.js';
import { RateLimiterRegistry } from './rate-limit/token-bucket.js';
import { MessageHandler } from './websocket/handler.js';
import type { SocketData } from './sessions/session.js';

// ---------------------------------------------------------------------------
// Server Factory
// ---------------------------------------------------------------------------

export interface SignalingServerOptions {
  port?: number;
  sessionTimeoutMs?: number;
  cleanupIntervalMs?: number;
}

export function createSignalingServer(options: SignalingServerOptions = {}) {
  const port = options.port ?? parseInt(process.env.PORT ?? '8080', 10);
  const sessionTimeoutMs =
    options.sessionTimeoutMs ??
    parseInt(process.env.SESSION_TIMEOUT_MS ?? '600000', 10);

  const sessions = new SessionManager(sessionTimeoutMs);
  const rateLimiter = new RateLimiterRegistry(10, 2);
  const handler = new MessageHandler(sessions, rateLimiter);

  // Start cleanup sweep
  sessions.startCleanup(options.cleanupIntervalMs ?? 30_000);

  const server = Bun.serve<SocketData>({
    port,

    fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === '/ws' || url.pathname === '/') {
        const id = randomBytes(16).toString('hex');

        const success = server.upgrade(req, {
          data: {
            id,
            sessionCode: null,
            role: null,
            joinAttempts: 0,
            lastAttemptAt: 0,
          } satisfies SocketData,
        });

        if (success) return undefined;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Health check
      if (url.pathname === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            activeSessions: sessions.activeCount,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response('dropweave signaling server', { status: 200 });
    },

    websocket: {
      open(_ws) {
        // Connection opened — no logging, no IP storage
      },

      message(ws, message) {
        if (typeof message === 'string') {
          handler.handle(ws, message);
        } else {
          // Binary messages not expected on signaling channel
          handler.handle(ws, new TextDecoder().decode(message));
        }
      },

      close(ws) {
        // Clean up session and rate limiter
        sessions.handleDisconnect(ws);
        rateLimiter.remove(ws.data.id);
      },

      drain(_ws) {
        // Backpressure cleared — nothing to do for signaling
      },
    },
  });

  return {
    server,
    sessions,
    rateLimiter,
    handler,
    port: server.port,
    stop() {
      sessions.stopCleanup();
      server.stop(true);
    },
  };
}

// ---------------------------------------------------------------------------
// Run Server if executed directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const instance = createSignalingServer();
  console.log(
    `⚡ dropweave signaling server running on ws://localhost:${instance.port}`,
  );
  console.log(`   Session timeout: ${instance.sessions['defaultTimeoutMs'] / 1000}s`);
  console.log(`   Zero-knowledge mode: no IPs logged, no persistent state`);
}
