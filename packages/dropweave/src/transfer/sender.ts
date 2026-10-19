/**
 * File sender — orchestrates reading, chunking, and sending over the data channel.
 *
 * Reads file chunk-by-chunk → wraps in binary packets → sends with backpressure
 * and adaptive chunk sizing → waits for integrity verification.
 */

import { PacketType, PacketFlags, TransferState } from '../core/types.js';
import type { TransferOffer, TransferAccept } from '../core/types.js';
import { encodePacket, jsonPayload, parseJsonPayload } from '../core/protocol.js';
import { PacketTracker } from './packet.js';
import { AdaptiveChunker } from './chunker.js';
import { BackpressureController } from './backpressure.js';
import { IntegrityHasher } from './integrity.js';
import { ProgressTracker } from './progress.js';
import { FileReader } from '../adapters/node/file-reader.js';
import type { DataChannelWrapper } from '../peer/connection.js';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendOptions {
  filePath: string;
  dataChannel: DataChannelWrapper;
  onProgress?: (progress: import('../core/types.js').TransferProgress) => void;
}

export interface SendResult {
  transferId: string;
  bytesTransferred: number;
  hashHex: string;
  verified: boolean;
  elapsed: number;
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

export async function sendFile(options: SendOptions): Promise<SendResult> {
  const { filePath, dataChannel, onProgress } = options;

  const reader = new FileReader();
  const tracker = new PacketTracker();
  const chunker = new AdaptiveChunker();
  const backpressure = new BackpressureController();
  const hasher = new IntegrityHasher('sha256');

  const transferId = randomBytes(8).toString('hex');

  try {
    // 1. Open file and get metadata
    const metadata = await reader.open(filePath);

    const progress = new ProgressTracker(transferId, metadata.fileSize);
    if (onProgress) {
      progress.onProgress(onProgress);
    }

    // 2. Send TRANSFER_OFFER
    const offer: TransferOffer = {
      transferId,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      mimeType: metadata.mimeType,
      chunkSize: chunker.chunkSize,
      checksumAlgo: 'sha256',
    };

    const offerSeq = tracker.allocateSeq();
    const offerPacket = encodePacket(
      PacketType.TransferOffer,
      PacketFlags.None,
      offerSeq,
      jsonPayload(offer),
    );
    dataChannel.sendBinary(offerPacket);
    tracker.recordSent(offerSeq, offerPacket.byteLength);
    progress.setState(TransferState.Offering);

    // 3. Wait for TRANSFER_ACCEPT or TRANSFER_REJECT
    const acceptMsg = await waitForPacketType(
      dataChannel,
      [PacketType.TransferAccept, PacketType.TransferReject],
      30000,
    );

    if (acceptMsg.header.type === PacketType.TransferReject) {
      const reject = parseJsonPayload<{ reason: string }>(acceptMsg.payload);
      throw new Error(`Transfer rejected: ${reject.reason}`);
    }

    const accept = parseJsonPayload<TransferAccept>(acceptMsg.payload);
    progress.setState(TransferState.Transferring);

    // 4. Send file chunks
    let chunk: Uint8Array | null;
    while ((chunk = await reader.readChunk(chunker.chunkSize)) !== null) {
      // Backpressure check
      if (!backpressure.shouldSend(dataChannel.bufferedAmount)) {
        await backpressure.waitForDrain();
      }

      // Hash the chunk
      hasher.update(chunk);

      // Determine flags
      const isLast = reader.isComplete;
      const flags = isLast
        ? PacketFlags.LastChunk
        : PacketFlags.None;

      // Encode and send
      const seq = tracker.allocateSeq();
      const packet = encodePacket(PacketType.DataChunk, flags, seq, chunk);
      dataChannel.sendBinary(packet);
      tracker.recordSent(seq, chunk.byteLength);

      // Update progress
      progress.addBytes(chunk.byteLength);

      // Feed adaptive chunker
      chunker.onChunkSent(tracker, backpressure.isPaused);

      // Check backpressure for next iteration
      backpressure.checkDrain(dataChannel.bufferedAmount);
    }

    // 5. Send checksum
    const hashBytes = hasher.digest();
    const checksumSeq = tracker.allocateSeq();
    const checksumPacket = encodePacket(
      PacketType.Checksum,
      PacketFlags.None,
      checksumSeq,
      hashBytes,
    );
    dataChannel.sendBinary(checksumPacket);
    progress.setState(TransferState.Verifying);

    // 6. Wait for CHECKSUM_VERIFY
    const verifyMsg = await waitForPacketType(
      dataChannel,
      [PacketType.ChecksumVerify],
      60000,
    );

    const verified = verifyMsg.payload[0] === 1;
    const finalState = verified
      ? TransferState.Completed
      : TransferState.Failed;
    progress.setState(finalState);

    const snapshot = progress.getSnapshot();

    return {
      transferId,
      bytesTransferred: snapshot.bytesTransferred,
      hashHex: Buffer.from(hashBytes).toString('hex'),
      verified,
      elapsed: snapshot.elapsed,
    };
  } finally {
    await reader.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { decodePacket } from '../core/protocol.js';
import type { Packet } from '../core/types.js';

/**
 * Wait for a specific packet type on the data channel.
 * Buffers other messages and resolves when the expected type arrives.
 */
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
        // Ignore malformed packets while waiting
      }
    };

    dc.on('message', handler);
  });
}
