/**
 * Integration tests for the signaling server and SignalingClient.
 *
 * Tests the complete lifecycle:
 * - Session creation & 8-char code generation
 * - Joining & join-request delivery
 * - Host approval
 * - SDP offer/answer relay
 * - ICE candidate exchange
 * - Invalid/expired code rejection
 * - Rate limiting on repeated invalid attempts
 * - Clean teardown & resource eviction
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createSignalingServer } from '../../apps/signaling-server/src/index.js';
import { SignalingClient } from '../../packages/dropweave/src/peer/signaling.js';
import { isValidCode } from '../../packages/dropweave/src/core/code-gen.js';

describe('Signaling Integration', () => {
  let serverInstance: ReturnType<typeof createSignalingServer>;
  let serverUrl: string;

  beforeAll(() => {
    // Use dynamic port 0 for testing to avoid conflicts
    serverInstance = createSignalingServer({
      port: 0,
      sessionTimeoutMs: 5000,
      cleanupIntervalMs: 1000,
    });
    serverUrl = `ws://localhost:${serverInstance.port}/ws`;
  });

  afterAll(() => {
    serverInstance.stop();
  });

  test('health check endpoint returns status ok', async () => {
    const res = await fetch(`http://localhost:${serverInstance.port}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; activeSessions: number };
    expect(json.status).toBe('ok');
    expect(typeof json.activeSessions).toBe('number');
  });

  test('happy path: create session → join → approve → sdp & ice relay', async () => {
    const host = new SignalingClient({ url: serverUrl });
    const joiner = new SignalingClient({ url: serverUrl });

    await host.connect();
    await joiner.connect();

    // 1. Host creates session
    host.send('session:create');
    const createdMsg = await host.waitFor('session:created');
    expect(createdMsg.sessionCode).toBeDefined();
    const code = createdMsg.sessionCode!;
    expect(isValidCode(code)).toBe(true);

    // 2. Joiner requests to join with code
    joiner.send('session:join', {}, code);

    // 3. Host receives join request
    const joinReq = await host.waitFor('session:join-requested');
    expect(joinReq.sessionCode).toBe(code);

    // 4. Host approves joiner
    host.send('session:approve', {}, code);

    // 5. Joiner receives approval
    const approvedMsg = await joiner.waitFor('session:approved');
    expect(approvedMsg.sessionCode).toBe(code);

    // 6. Host sends SDP offer
    host.send('peer:offer', { sdp: 'dummy-sdp-offer' }, code);
    const receivedOffer = await joiner.waitFor('peer:offer');
    expect(receivedOffer.payload?.sdp).toBe('dummy-sdp-offer');

    // 7. Joiner sends SDP answer
    joiner.send('peer:answer', { sdp: 'dummy-sdp-answer' }, code);
    const receivedAnswer = await host.waitFor('peer:answer');
    expect(receivedAnswer.payload?.sdp).toBe('dummy-sdp-answer');

    // 8. ICE candidates exchange
    host.send(
      'peer:ice-candidate',
      { candidate: 'cand-host-1', mid: '0' },
      code,
    );
    const receivedCandJoiner = await joiner.waitFor('peer:ice-candidate');
    expect(receivedCandJoiner.payload?.candidate).toBe('cand-host-1');

    joiner.send(
      'peer:ice-candidate',
      { candidate: 'cand-joiner-1', mid: '0' },
      code,
    );
    const receivedCandHost = await host.waitFor('peer:ice-candidate');
    expect(receivedCandHost.payload?.candidate).toBe('cand-joiner-1');

    host.close();
    joiner.close();
  });

  test('joining with invalid or non-existent code returns session:error', async () => {
    const client = new SignalingClient({ url: serverUrl });
    await client.connect();

    client.send('session:join', {}, '99999999');
    const errMsg = await client.waitFor('session:error');
    expect(errMsg.payload).toBeDefined();

    client.close();
  });

  test('rate limiter throttles excessive failed join attempts', async () => {
    const client = new SignalingClient({ url: serverUrl });
    await client.connect();

    // The rate limiter allows up to 5 attempts before cooldown
    for (let i = 0; i < 5; i++) {
      client.send('session:join', {}, `FAIL000${i}`);
      const err = await client.waitFor('session:error');
      expect(err.type).toBe('session:error');
    }

    // 6th attempt should be blocked by cooldown / rate limit
    client.send('session:join', {}, 'FAIL9999');
    const rateLimitedErr = await client.waitFor('session:error');
    expect(rateLimitedErr.payload?.code).toBe('RATE_LIMITED');

    client.close();
  });

  test('closing connection cleans up session from active sessions', async () => {
    const host = new SignalingClient({ url: serverUrl });
    await host.connect();

    host.send('session:create');
    const createdMsg = await host.waitFor('session:created');
    const code = createdMsg.sessionCode!;

    expect(serverInstance.sessions.getSession(code)).toBeDefined();

    host.close();

    // Give server tick to handle socket close
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(serverInstance.sessions.getSession(code)).toBeNull();
  });
});
