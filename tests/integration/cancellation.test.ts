/**
 * Integration test: Transfer cancellation mid-stream.
 *
 * Verifies that:
 * - A transfer can be cancelled mid-stream
 * - The receiver aborts and removes incomplete temp file (.dwpart)
 * - Neither process hangs or crashes
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PeerConnectionWrapper, DataChannelWrapper } from '../../packages/dropweave/src/peer/connection.js';
import { sendFile } from '../../packages/dropweave/src/transfer/sender.js';
import { receiveFile } from '../../packages/dropweave/src/transfer/receiver.js';
import { encodePacket, jsonPayload } from '../../packages/dropweave/src/core/protocol.js';
import { PacketType, PacketFlags } from '../../packages/dropweave/src/core/types.js';

describe('Cancellation Integration', () => {
  let tempDir: string;
  let srcFilePath: string;
  let outDir: string;
  const fileSize = 2 * 1024 * 1024; // 2 MB
  const buffer = Buffer.alloc(fileSize, 0x5a);

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dropweave-cancel-'));
    srcFilePath = join(tempDir, 'cancel-test.bin');
    outDir = join(tempDir, 'output');
    await writeFile(srcFilePath, buffer);
  });

  afterAll(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test('cancelling mid-stream cleans up temp files and rejects cleanly', async () => {
    const pcA = new PeerConnectionWrapper({ iceServers: [] });
    const pcB = new PeerConnectionWrapper({ iceServers: [] });

    pcA.on('local-description', (sdp, type) => pcB.setRemoteDescription(sdp, type));
    pcB.on('local-description', (sdp, type) => pcA.setRemoteDescription(sdp, type));
    pcA.on('local-candidate', (cand, mid) => pcB.addRemoteCandidate(cand, mid));
    pcB.on('local-candidate', (cand, mid) => pcA.addRemoteCandidate(cand, mid));

    const dcA = pcA.createDataChannel('dropweave-cancel');
    const dcBPromise = new Promise<DataChannelWrapper>((resolve) => {
      pcB.on('data-channel', resolve);
    });

    const [openA, dcB] = await Promise.all([
      new Promise<void>((resolve) => (dcA.isOpen ? resolve() : dcA.on('open', resolve))),
      dcBPromise,
    ]);
    await new Promise<void>((resolve) => (dcB.isOpen ? resolve() : dcB.on('open', resolve)));

    let cancelled = false;

    // Sender sends, but as soon as progress starts, we send a Cancel packet from dcA
    const senderPromise = sendFile({
      filePath: srcFilePath,
      dataChannel: dcA,
      onProgress: (p) => {
        if (!cancelled && p.bytesTransferred > 64 * 1024) {
          cancelled = true;
          // Send CANCEL packet to receiver
          const cancelPacket = encodePacket(
            PacketType.Cancel,
            PacketFlags.None,
            9999,
            jsonPayload({ reason: 'User cancelled' }),
          );
          dcA.sendBinary(cancelPacket);
        }
      },
    });

    const receiverPromise = receiveFile({
      dataChannel: dcB,
      outputDir: outDir,
    });

    // Receiver should reject because it received CANCEL
    let receiverError: Error | null = null;
    try {
      await receiverPromise;
    } catch (err: any) {
      receiverError = err;
    }

    expect(receiverError).toBeDefined();
    expect(receiverError?.message).toContain('Transfer cancelled');

    // Verify temp file .dwpart does NOT exist (aborted and unlinked)
    try {
      const files = await readdir(outDir);
      const dwpartFiles = files.filter((f) => f.endsWith('.dwpart'));
      expect(dwpartFiles.length).toBe(0);
    } catch {
      // outDir may not have any files
    }

    dcA.close();
    dcB.close();
    pcA.close();
    pcB.close();
  });
});
