/**
 * File receiver — accepts transfer offers, receives chunks, reassembles,
 * and verifies integrity.
 */

import { PacketType, PacketFlags, TransferState } from '../core/types.js';
import type { TransferOffer, TransferAccept, TransferProgress, Packet } from '../core/types.js';
import {
  encodePacket,
  decodePacket,
  jsonPayload,
  parseJsonPayload,
  createChunkAckPacket,
} from '../core/protocol.js';
import { IntegrityHasher, hashesEqual } from './integrity.js';
import { ProgressTracker } from './progress.js';
import { FileWriter } from '../adapters/node/file-writer.js';
import type { DataChannelWrapper } from '../peer/connection.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReceiveOptions {
  dataChannel: DataChannelWrapper;
  outputDir: string;
  /** Optional: auto-accept all offers. Default: true (anonymous mode). */
  autoAccept?: boolean;
  onProgress?: (progress: TransferProgress) => void;
  onOffer?: (offer: TransferOffer) => Promise<boolean>;
}

export interface ReceiveResult {
  transferId: string;
  fileName: string;
  filePath: string;
  bytesReceived: number;
  hashHex: string;
  verified: boolean;
  elapsed: number;
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

export async function receiveFile(options: ReceiveOptions): Promise<ReceiveResult> {
  const {
    dataChannel,
    outputDir,
    autoAccept = true,
    onProgress,
    onOffer,
  } = options;

  const writer = new FileWriter();
  const hasher = new IntegrityHasher('sha256');

  try {
    // 1. Wait for TRANSFER_OFFER
    const offerPacket = await waitForPacketType(
      dataChannel,
      [PacketType.TransferOffer],
      60000,
    );
    const offer = parseJsonPayload<TransferOffer>(offerPacket.payload);

    // 2. Accept or reject
    let accepted = autoAccept;
    if (onOffer) {
      accepted = await onOffer(offer);
    }

    if (!accepted) {
      const rejectSeq = 0;
      const rejectPacket = encodePacket(
        PacketType.TransferReject,
        PacketFlags.None,
        rejectSeq,
        jsonPayload({ transferId: offer.transferId, reason: 'User rejected' }),
      );
      dataChannel.sendBinary(rejectPacket);
      throw new Error('Transfer rejected by user');
    }

    // Prepare file writer
    const { fileName, path } = await writer.prepare(outputDir, offer.fileName);

    // Send TRANSFER_ACCEPT
    const acceptPayload: TransferAccept = {
      transferId: offer.transferId,
      acceptedChunkSize: offer.chunkSize,
    };
    const acceptPacket = encodePacket(
      PacketType.TransferAccept,
      PacketFlags.None,
      0,
      jsonPayload(acceptPayload),
    );
    dataChannel.sendBinary(acceptPacket);

    // Set up progress tracking
    const progress = new ProgressTracker(offer.transferId, offer.fileSize);
    if (onProgress) {
      progress.onProgress(onProgress);
    }
    progress.setState(TransferState.Transferring);

    // 3. Receive chunks until LAST_CHUNK flag or all bytes received
    let receivedChecksum: Uint8Array | null = null;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let processChain = Promise.resolve();

      let timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Transfer timeout: no data received for 60 seconds'));
      }, 60000);

      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Transfer timeout: no data received for 60 seconds'));
        }, 60000);
      };

      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        dataChannel.removeListener('message', onMessage);
      };

      const onMessage = (data: Uint8Array) => {
        if (settled) return;
        processChain = processChain
          .then(async () => {
            if (settled) return;
            const packet = decodePacket(data);

            switch (packet.header.type) {
              case PacketType.DataChunk: {
                resetTimeout();

                // If sender requested ACK for RTT/bandwidth calibration, reply immediately
                if ((packet.header.flags & PacketFlags.AckRequired) !== 0) {
                  dataChannel.sendBinary(createChunkAckPacket(packet.header.seq));
                }

                // Write chunk to file
                await writer.writeChunk(packet.payload);

                // Hash incrementally
                hasher.update(packet.payload);

                // Update progress
                progress.addBytes(packet.payload.byteLength);
                break;
              }

              case PacketType.Checksum: {
                resetTimeout();
                receivedChecksum = packet.payload;
                progress.setState(TransferState.Verifying);

                // Verify
                const computedHash = hasher.digest();
                const match = hashesEqual(computedHash, receivedChecksum);

                // Send CHECKSUM_VERIFY
                const verifyPayload = new Uint8Array([match ? 1 : 0]);
                const verifyPacket = encodePacket(
                  PacketType.ChecksumVerify,
                  PacketFlags.None,
                  0,
                  verifyPayload,
                );
                dataChannel.sendBinary(verifyPacket);

                if (match) {
                  progress.setState(TransferState.Completed);
                } else {
                  progress.setState(TransferState.Failed);
                }

                cleanup();
                resolve();
                break;
              }

              case PacketType.Cancel: {
                cleanup();
                progress.setState(TransferState.Cancelled);
                reject(new Error('Transfer cancelled by sender'));
                break;
              }

              case PacketType.Error: {
                cleanup();
                const err = parseJsonPayload<{ message: string }>(packet.payload);
                progress.setState(TransferState.Failed);
                reject(new Error(`Transfer error: ${err.message}`));
                break;
              }

              default:
                // Ignore unknown packet types
                break;
            }
          })
          .catch((err) => {
            if (!settled) {
              cleanup();
              reject(err);
            }
          });
      };

      dataChannel.on('message', onMessage);
    });

    // 4. Finalize file
    const computedHex = Buffer.from(hasher.isFinalized ? new Uint8Array(0) : hasher.digest()).toString('hex');
    const verified = receivedChecksum !== null;
    const finalPath = await writer.finalize();

    const snapshot = progress.getSnapshot();

    return {
      transferId: offer.transferId,
      fileName,
      filePath: finalPath,
      bytesReceived: snapshot.bytesTransferred,
      hashHex: receivedChecksum
        ? Buffer.from(receivedChecksum).toString('hex')
        : '',
      verified: snapshot.state === TransferState.Completed,
      elapsed: snapshot.elapsed,
    };
  } catch (err) {
    await writer.abort();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForPacketType(
  dc: DataChannelWrapper,
  types: PacketType[],
  timeoutMs: number,
): Promise<Packet> {
  return new Promise<Packet>((resolve, reject) => {
    const timeout = setTimeout(() => {
      dc.removeListener('message', handler);
      reject(
        new Error(
          `Timeout waiting for packet type(s): ${types.map((t) => `0x${t.toString(16)}`).join(', ')}`,
        ),
      );
    }, timeoutMs);

    const handler = (data: Uint8Array) => {
      try {
        const packet = decodePacket(data);
        if (types.includes(packet.header.type)) {
          clearTimeout(timeout);
          dc.removeListener('message', handler);
          resolve(packet);
        }
      } catch {
        // Ignore malformed packets
      }
    };

    dc.on('message', handler);
  });
}
