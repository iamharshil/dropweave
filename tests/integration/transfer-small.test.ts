/**
 * Integration test: Small file transfer over WebRTC data channel.
 *
 * Verifies that two peers connected via node-datachannel can:
 * - Negotiate offer/accept
 * - Stream chunks across the data channel
 * - Reconstruct the file on the receiver side
 * - Compute and verify SHA-256 integrity
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PeerConnectionWrapper, DataChannelWrapper } from '../../packages/dropweave/src/peer/connection.js';
import { sendFile } from '../../packages/dropweave/src/transfer/sender.js';
import { receiveFile } from '../../packages/dropweave/src/transfer/receiver.js';
import { sha256 } from '../../packages/dropweave/src/transfer/integrity.js';

describe('Transfer Small File Integration', () => {
  let tempDir: string;
  let srcFilePath: string;
  let outDir: string;
  const fileContent = Buffer.from(
    'Hello, DropWeave! This is an anonymous peer-to-peer file transfer test payload. 🚀🔒\n'.repeat(50),
  );

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dropweave-test-'));
    srcFilePath = join(tempDir, 'test-input.txt');
    outDir = join(tempDir, 'output');
    await writeFile(srcFilePath, fileContent);
  });

  afterAll(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test('transfers small file directly between two peers and verifies hash', async () => {
    const pcA = new PeerConnectionWrapper({ iceServers: [] });
    const pcB = new PeerConnectionWrapper({ iceServers: [] });

    // Relay signaling locally between pcA and pcB
    pcA.on('local-description', (sdp, type) => {
      pcB.setRemoteDescription(sdp, type);
    });
    pcB.on('local-description', (sdp, type) => {
      pcA.setRemoteDescription(sdp, type);
    });

    pcA.on('local-candidate', (candidate, mid) => {
      pcB.addRemoteCandidate(candidate, mid);
    });
    pcB.on('local-candidate', (candidate, mid) => {
      pcA.addRemoteCandidate(candidate, mid);
    });

    // Setup data channel
    const dcA = pcA.createDataChannel('dropweave');

    const dcBPromise = new Promise<DataChannelWrapper>((resolve) => {
      pcB.on('data-channel', (dc) => {
        resolve(dc);
      });
    });

    // Wait for both channels to open
    const [openA, dcB] = await Promise.all([
      new Promise<void>((resolve) => {
        if (dcA.isOpen) resolve();
        else dcA.on('open', resolve);
      }),
      dcBPromise,
    ]);

    await new Promise<void>((resolve) => {
      if (dcB.isOpen) resolve();
      else dcB.on('open', resolve);
    });

    expect(dcA.isOpen).toBe(true);
    expect(dcB.isOpen).toBe(true);

    // Track progress events
    let senderProgressCount = 0;
    let receiverProgressCount = 0;

    // Run sender and receiver concurrently
    const [sendResult, receiveResult] = await Promise.all([
      sendFile({
        filePath: srcFilePath,
        dataChannel: dcA,
        onProgress: () => {
          senderProgressCount++;
        },
      }),
      receiveFile({
        dataChannel: dcB,
        outputDir: outDir,
        onProgress: () => {
          receiverProgressCount++;
        },
      }),
    ]);

    expect(sendResult.verified).toBe(true);
    expect(receiveResult.verified).toBe(true);
    expect(sendResult.bytesTransferred).toBe(fileContent.byteLength);
    expect(receiveResult.bytesReceived).toBe(fileContent.byteLength);
    expect(sendResult.hashHex).toBe(receiveResult.hashHex);

    // Compare actual hash
    const expectedHashHex = Buffer.from(sha256(fileContent)).toString('hex');
    expect(sendResult.hashHex).toBe(expectedHashHex);

    // Verify saved file on disk
    const savedContent = await readFile(receiveResult.filePath);
    expect(savedContent.equals(fileContent)).toBe(true);

    expect(senderProgressCount).toBeGreaterThan(0);
    expect(receiverProgressCount).toBeGreaterThan(0);

    // Clean up
    dcA.close();
    dcB.close();
    pcA.close();
    pcB.close();
  });
});
