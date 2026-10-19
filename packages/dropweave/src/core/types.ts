/**
 * Core types for the dropweave peer-to-peer file transfer protocol.
 *
 * All shared types, enums, and interfaces live here. Nothing in this file
 * imports browser-only or Node-only APIs.
 */

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Session lifecycle states. */
export enum SessionState {
  Waiting = 'waiting',
  PeerRequested = 'peer-requested',
  Approved = 'approved',
  Negotiating = 'negotiating',
  Connected = 'connected',
  Transferring = 'transferring',
  Completed = 'completed',
  Rejected = 'rejected',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

/** Terminal states that can never transition again. */
export const TERMINAL_STATES: ReadonlySet<SessionState> = new Set([
  SessionState.Completed,
  SessionState.Rejected,
  SessionState.Expired,
  SessionState.Cancelled,
  SessionState.Failed,
]);

// ---------------------------------------------------------------------------
// Packet Protocol
// ---------------------------------------------------------------------------

/** Magic bytes for DropWeave binary packets: 0x44 0x57 ("DW"). */
export const PACKET_MAGIC = 0x4457;

/** Binary message type IDs sent over the WebRTC data channel. */
export enum PacketType {
  // Transfer negotiation
  TransferOffer = 0x01,
  TransferAccept = 0x02,
  TransferReject = 0x03,

  // File data
  DataChunk = 0x10,
  ChunkAck = 0x11,

  // Integrity
  Checksum = 0x20,
  ChecksumVerify = 0x21,

  // Diagnostics
  ProgressSync = 0x30,

  // Control
  Cancel = 0xf0,
  Error = 0xf1,

  // Keep-alive / RTT measurement
  Ping = 0xfe,
  Pong = 0xff,
}

/** Bitfield flags inside the packet header. */
export enum PacketFlags {
  None = 0,
  /** Sender requests an ACK for this packet. */
  AckRequired = 1 << 0,
  /** Payload is compressed (reserved, not implemented in MVP). */
  Compressed = 1 << 1,
  /** This is the last chunk of the file. */
  LastChunk = 1 << 2,
  /** Cancellation flag. */
  Cancel = 1 << 3,
}

/** Decoded packet header (12 bytes on the wire). */
export interface PacketHeader {
  magic: number;
  type: PacketType;
  flags: PacketFlags;
  seq: number;
  payloadLength: number;
}

/** A fully decoded packet: header + payload. */
export interface Packet {
  header: PacketHeader;
  payload: Uint8Array;
}

// ---------------------------------------------------------------------------
// Transfer Metadata
// ---------------------------------------------------------------------------

/** Metadata sent by the sender in a TRANSFER_OFFER. */
export interface TransferOffer {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  checksumAlgo: 'sha256';
}

/** Metadata sent by the receiver in a TRANSFER_ACCEPT. */
export interface TransferAccept {
  transferId: string;
  acceptedChunkSize: number;
}

/** Metadata sent by the receiver in a TRANSFER_REJECT. */
export interface TransferReject {
  transferId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Snapshot of a transfer's progress at a point in time. */
export interface TransferProgress {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  /** Bytes per second (rolling average). */
  speed: number;
  /** Estimated time remaining in seconds, or null if unknown. */
  eta: number | null;
  /** Elapsed time in milliseconds. */
  elapsed: number;
  state: TransferState;
}

/** Transfer-level states (subset of the session lifecycle). */
export enum TransferState {
  Pending = 'pending',
  Offering = 'offering',
  Accepted = 'accepted',
  Transferring = 'transferring',
  Verifying = 'verifying',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

// ---------------------------------------------------------------------------
// Signaling Protocol (WebSocket)
// ---------------------------------------------------------------------------

/** Supported signaling message types. */
export type SignalingType =
  | 'session:create'
  | 'session:created'
  | 'session:join'
  | 'session:join-requested'
  | 'session:approve'
  | 'session:approved'
  | 'session:reject'
  | 'session:rejected'
  | 'peer:offer'
  | 'peer:answer'
  | 'peer:ice-candidate'
  | 'session:close'
  | 'session:error';

/** Envelope for every message on the signaling WebSocket. */
export interface SignalingMessage {
  /** Protocol version. Always 1 for now. */
  v: 1;
  type: SignalingType;
  sessionCode?: string;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ICE / Connection
// ---------------------------------------------------------------------------

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** How the WebRTC connection is being routed. */
export enum ConnectionMode {
  Direct = 'direct',
  Relayed = 'relayed',
  Unknown = 'unknown',
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Top-level configuration for a dropweave transfer instance. */
export interface DropweaveConfig {
  signalingUrl: string;
  iceServers: IceServerConfig[];
  /** Session code expiry in seconds. Default: 600 (10 min). */
  sessionTimeout?: number;
  /** Minimum chunk size in bytes. Default: 16384 (16 KiB). */
  minChunkSize?: number;
  /** Maximum chunk size in bytes. Default: 262144 (256 KiB). */
  maxChunkSize?: number;
  /** Initial chunk size in bytes. Default: 16384 (16 KiB). */
  initialChunkSize?: number;
}
