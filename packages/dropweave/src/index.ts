/**
 * Public API exports for the dropweave package.
 */

// Core types and protocol
export {
  SessionState,
  TERMINAL_STATES,
  PACKET_MAGIC,
  PacketType,
  PacketFlags,
  TransferState,
  ConnectionMode,
  type PacketHeader,
  type Packet,
  type TransferOffer,
  type TransferAccept,
  type TransferReject,
  type TransferProgress,
  type SignalingType,
  type SignalingMessage,
  type IceServerConfig,
  type DropweaveConfig,
} from './core/types.js';

export * from './core/constants.js';
export { encodePacket, decodePacket, jsonPayload, parseJsonPayload } from './core/protocol.js';
export { SessionStateMachine } from './core/state-machine.js';
export { generateSessionCode, normalizeCode, isValidCode, formatCode } from './core/code-gen.js';

// Peer connection
export { PeerConnectionWrapper, DataChannelWrapper } from './peer/connection.js';
export { SignalingClient } from './peer/signaling.js';

// Transfer
export { PacketTracker } from './transfer/packet.js';
export { AdaptiveChunker } from './transfer/chunker.js';
export { BackpressureController } from './transfer/backpressure.js';
export { IntegrityHasher, hashesEqual, sha256 } from './transfer/integrity.js';
export { ProgressTracker } from './transfer/progress.js';
export { sendFile, type SendOptions, type SendResult } from './transfer/sender.js';
export { receiveFile, type ReceiveOptions, type ReceiveResult } from './transfer/receiver.js';

// Node.js file adapters
export { FileReader } from './adapters/node/file-reader.js';
export { FileWriter, sanitizeFileName } from './adapters/node/file-writer.js';
