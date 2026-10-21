/**
 * Tests for SignalingClient error handling, fail-fast rejection,
 * protocol validation, and connection guards.
 */

import { describe, test, expect } from 'bun:test';
import { SignalingClient } from '../../packages/dropweave/src/peer/signaling';
import type { SignalingMessage } from '../../packages/dropweave/src/core/types';

describe('SignalingClient Error Handling & Edge Cases', () => {
  test('send() throws when client is not connected', () => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });
    expect(() => {
      client.send('session:create');
    }).toThrow('Signaling client not connected');
  });

  test('waitFor() rejects immediately on session:error', async () => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });
    const waitPromise = client.waitFor('session:created', 5000);

    // Simulate receiving an error from signaling server
    const errorMsg: SignalingMessage = {
      v: 1,
      type: 'session:error',
      payload: {
        code: 'NOT_FOUND',
        message: 'Session has expired or does not exist',
      },
    };

    // Emit message to client
    client.emit('message', errorMsg);

    await expect(waitPromise).rejects.toThrow('Session has expired or does not exist');
  });

  test('waitFor() falls back to error code if message is missing in session:error', async () => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });
    const waitPromise = client.waitFor('session:approved', 5000);

    const errorMsg: SignalingMessage = {
      v: 1,
      type: 'session:error',
      payload: {
        code: 'RATE_LIMITED',
      },
    };

    client.emit('message', errorMsg);

    await expect(waitPromise).rejects.toThrow('Signaling error: RATE_LIMITED');
  });

  test('waitFor() times out when expected message does not arrive', async () => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });
    const waitPromise = client.waitFor('session:created', 100); // 100ms timeout

    await expect(waitPromise).rejects.toThrow('Timeout waiting for session:created');
  });

  test('handleIncoming rejects malformed non-JSON messages via error event', (done) => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });

    client.on('error', (err) => {
      expect(err.message).toContain('Failed to parse signaling message');
      done();
    });

    // Access private handleIncoming via any cast
    (client as any).handleIncoming('INVALID_NON_JSON_CONTENT{{{');
  });

  test('handleIncoming rejects messages with missing or invalid version', (done) => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });

    client.on('error', (err) => {
      expect(err.message).toContain('Invalid signaling message: missing v or type');
      done();
    });

    (client as any).handleIncoming(JSON.stringify({ v: 2, type: 'session:create' }));
  });

  test('close() is safe and idempotent', () => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });
    expect(client.isConnected).toBe(false);

    expect(() => {
      client.close();
      client.close();
    }).not.toThrow();

    expect(client.listenerCount('message')).toBe(0);
  });

  test('handleIncoming does not crash process when no error listener is attached', () => {
    const client = new SignalingClient({ url: 'ws://localhost:9999/ws' });
    // Calling handleIncoming with invalid data should not throw unhandled exception
    expect(() => {
      (client as any).handleIncoming('INVALID_NON_JSON_CONTENT{{{');
    }).not.toThrow();
  });
});
