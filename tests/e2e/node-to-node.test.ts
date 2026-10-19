/**
 * End-to-end test: Full Node.js ↔ Node.js file transfer.
 *
 * Simulates two separate CLI processes running on different nodes:
 * 1. Signaling server running on WebSocket
 * 2. Peer A (Sender) opens session, receives 8-char code
 * 3. Peer B (Receiver) enters 8-char code to join
 * 4. Signaling service validates code and pairs the peers
 * 5. WebRTC ICE & SDP negotiation through the signaling server
 * 6. WebRTC DataChannel establishes
 * 7. File transferred directly over DataChannel
 * 8. Receiver verifies SHA-256 and writes file to disk
 * 9. Both peers and signaling server clean up cleanly
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSignalingServer } from '../../apps/signaling-server/src/index.js';
import { PeerConnectionWrapper, DataChannelWrapper } from '../../packages/dropweave/src/peer/connection.js';
import { SignalingClient } from '../../packages/dropweave/src/peer/signaling.js';
import { sendFile } from '../../packages/dropweave/src/transfer/sender.js';
import { receiveFile } from '../../packages/dropweave/src/transfer/receiver.js';
import { sha256 } from '../../packages/dropweave/src/transfer/integrity.js';

describe('E2E Node-to-Node Transfer via Signaling', () => {
  let serverInstance: ReturnType<typeof createSignalingServer>;
  let signalingUrl: string;
  let tempDir: string;
  let srcFile: string;
  let outDir: string;
  const testPayload = Buffer.from(
    'DropWeave E2E Transfer Payload: ' +
      'Anonymous P2P zero-knowledge file transfer with 8-character connection code! 🌐✨\n'.repeat(200),
  );

  beforeAll(async () => {
    // Start signaling server on port 19876
    serverInstance = createSignalingServer({
      port: 19876,
      sessionTimeoutMs: 60000,
      cleanupIntervalMs: 10000,
    });
    signalingUrl = `ws://localhost:${serverInstance.port}/ws`;

    tempDir = await mkdtemp(join(tmpdir(), 'dropweave-e2e-'));
    srcFile = join(tempDir, 'document.pdf');
    outDir = join(tempDir, 'downloads');
    await writeFile(srcFile, testPayload);
  });

  afterAll(async () => {
    serverInstance.stop();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test('full end-to-end send and receive flow via 8-char code', async () => {
    // --- Peer A: Sender ---
    const sigA = new SignalingClient({ url: signalingUrl });
    await sigA.connect();

    // 1. Host creates session
    sigA.send('session:create');
    const createdMsg = await sigA.waitFor('session:created');
    const code = createdMsg.sessionCode!;
    expect(code).toBeDefined();
    expect(code.length).toBe(8);

    // --- Peer B: Receiver joins using code ---
    const sigB = new SignalingClient({ url: signalingUrl });
    await sigB.connect();
    sigB.send('session:join', { code }, code);

    // Host receives join-requested & auto-approves
    await sigA.waitFor('session:join-requested');
    sigA.send('session:approve', undefined, code);

    // Receiver receives approved
    await sigB.waitFor('session:approved');

    // --- WebRTC Setup ---
    const pcA = new PeerConnectionWrapper({ iceServers: [] });
    const pcB = new PeerConnectionWrapper({ iceServers: [] });

    // Signaling relay: Host (A) sends offers / ICE candidates
    pcA.on('local-description', (sdp, type) => {
      sigA.send('peer:offer', { sdp, type }, code);
    });
    pcA.on('local-candidate', (candidate, mid) => {
      sigA.send('peer:ice-candidate', { candidate, mid }, code);
    });

    // Signaling relay: Joiner (B) sends answers / ICE candidates
    pcB.on('local-description', (sdp, type) => {
      sigB.send('peer:answer', { sdp, type }, code);
    });
    pcB.on('local-candidate', (candidate, mid) => {
      sigB.send('peer:ice-candidate', { candidate, mid }, code);
    });

    // Handle incoming messages on A from B
    sigA.on('message', (msg) => {
      if (msg.type === 'peer:answer' && msg.payload) {
        pcA.setRemoteDescription(msg.payload.sdp as string, msg.payload.type as string);
      } else if (msg.type === 'peer:ice-candidate' && msg.payload) {
        pcA.addRemoteCandidate(msg.payload.candidate as string, msg.payload.mid as string);
      }
    });

    // Handle incoming messages on B from A
    sigB.on('message', (msg) => {
      if (msg.type === 'peer:offer' && msg.payload) {
        pcB.setRemoteDescription(msg.payload.sdp as string, msg.payload.type as string);
      } else if (msg.type === 'peer:ice-candidate' && msg.payload) {
        pcB.addRemoteCandidate(msg.payload.candidate as string, msg.payload.mid as string);
      }
    });

    // Host creates data channel
    const dcA = pcA.createDataChannel('transfer');

    // Joiner listens for data channel
    const dcBPromise = new Promise<DataChannelWrapper>((resolve) => {
      pcB.on('data-channel', (dc) => {
        if (dc.isOpen) resolve(dc);
        else dc.on('open', () => resolve(dc));
      });
    });

    // Wait for channel open on both sides
    const [_, dcB] = await Promise.all([
      new Promise<void>((resolve) => (dcA.isOpen ? resolve() : dcA.on('open', resolve))),
      dcBPromise,
    ]);

    expect(dcA.isOpen).toBe(true);
    expect(dcB.isOpen).toBe(true);

    // --- Transfer File ---
    const [sendResult, receiveResult] = await Promise.all([
      sendFile({
        filePath: srcFile,
        dataChannel: dcA,
      }),
      receiveFile({
        dataChannel: dcB,
        outputDir: outDir,
      }),
    ]);

    expect(sendResult.verified).toBe(true);
    expect(receiveResult.verified).toBe(true);
    expect(sendResult.bytesTransferred).toBe(testPayload.byteLength);
    expect(receiveResult.bytesReceived).toBe(testPayload.byteLength);

    const expectedHash = Buffer.from(sha256(testPayload)).toString('hex');
    expect(sendResult.hashHex).toBe(expectedHash);
    expect(receiveResult.hashHex).toBe(expectedHash);

    // Verify written file on disk
    const saved = await readFile(receiveResult.filePath);
    expect(saved.equals(testPayload)).toBe(true);

    // Clean up
    dcA.close();
    dcB.close();
    pcA.close();
    pcB.close();
    sigA.close();
    sigB.close();
  });
});
