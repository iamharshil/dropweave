/**
 * Binary packet protocol encoder/decoder.
 *
 * Every message over the WebRTC data channel uses a 12-byte binary header:
 *
 *   ┌───────────┬──────────┬───────────┬──────────┬──────────────┬─────────┐
 *   │ Magic (2B)│ Type (1B)│ Flags (1B)│ Seq (4B) │ PayloadLen(4)│ Payload │
 *   └───────────┴──────────┴───────────┴──────────┴──────────────┴─────────┘
 *
 * All multi-byte integers are big-endian (network byte order).
 */

import {
  PACKET_MAGIC,
  PacketType,
  PacketFlags,
  type PacketHeader,
  type Packet,
} from './types.js';
import { PACKET_HEADER_SIZE, MAX_PAYLOAD_SIZE } from './constants.js';

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode a packet into a single Uint8Array ready to send over the data channel.
 *
 * @throws If payload exceeds MAX_PAYLOAD_SIZE.
 */
export function encodePacket(
  type: PacketType,
  flags: PacketFlags,
  seq: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (payload.byteLength > MAX_PAYLOAD_SIZE) {
    throw new RangeError(
      `Payload size ${payload.byteLength} exceeds maximum ${MAX_PAYLOAD_SIZE}`,
    );
  }

  const out = new Uint8Array(PACKET_HEADER_SIZE + payload.byteLength);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // Header
  view.setUint16(0, PACKET_MAGIC);      // Magic (2 bytes)
  view.setUint8(2, type);                // Type  (1 byte)
  view.setUint8(3, flags);               // Flags (1 byte)
  view.setUint32(4, seq);                // Seq   (4 bytes, big-endian)
  view.setUint32(8, payload.byteLength); // PayloadLen (4 bytes, big-endian)

  // Payload
  if (payload.byteLength > 0) {
    out.set(payload, PACKET_HEADER_SIZE);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode a binary buffer into a Packet (header + payload).
 * Uses zero-copy subarray view for ultra-fast throughput without memory bloat.
 *
 * @throws If the buffer is too short, magic is wrong, or payload length mismatches.
 */
export function decodePacket(data: Uint8Array): Packet {
  if (data.byteLength < PACKET_HEADER_SIZE) {
    throw new RangeError(
      `Buffer too short for packet header: ${data.byteLength} < ${PACKET_HEADER_SIZE}`,
    );
  }

  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  );

  const magic = view.getUint16(0);
  if (magic !== PACKET_MAGIC) {
    throw new Error(
      `Invalid packet magic: 0x${magic.toString(16).padStart(4, '0')} (expected 0x${PACKET_MAGIC.toString(16).padStart(4, '0')})`,
    );
  }

  const type = view.getUint8(2) as PacketType;
  const flags = view.getUint8(3) as PacketFlags;
  const seq = view.getUint32(4);
  const payloadLength = view.getUint32(8);

  const expectedTotal = PACKET_HEADER_SIZE + payloadLength;
  if (data.byteLength < expectedTotal) {
    throw new RangeError(
      `Buffer too short for payload: ${data.byteLength} < ${expectedTotal}`,
    );
  }

  // Zero-copy view directly referencing the underlying buffer segment
  const payload = data.subarray(PACKET_HEADER_SIZE, expectedTotal);

  return {
    header: { magic, type, flags, seq, payloadLength },
    payload,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a JSON-serializable payload as UTF-8 bytes. */
export function jsonPayload(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

/** Decode a UTF-8 payload back to a parsed JSON object. */
export function parseJsonPayload<T = unknown>(payload: Uint8Array): T {
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Create a PING packet with the current high-resolution timestamp. */
export function createPingPacket(seq: number): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  // Store timestamp as a float64 (milliseconds since epoch)
  view.setFloat64(0, performance.now());
  return encodePacket(PacketType.Ping, PacketFlags.None, seq, payload);
}

/** Create a PONG packet echoing back the PING timestamp. */
export function createPongPacket(
  seq: number,
  pingPayload: Uint8Array,
): Uint8Array {
  return encodePacket(PacketType.Pong, PacketFlags.None, seq, pingPayload);
}

/**
 * Extract the timestamp from a PING/PONG payload and compute RTT.
 *
 * @returns RTT in milliseconds, or null if payload is malformed.
 */
export function extractRttFromPong(payload: Uint8Array): number | null {
  if (payload.byteLength < 8) return null;
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const sentAt = view.getFloat64(0);
  return performance.now() - sentAt;
}

/** Create a lightweight 12-byte CHUNK_ACK packet. */
export function createChunkAckPacket(seq: number): Uint8Array {
  return encodePacket(PacketType.ChunkAck, PacketFlags.None, seq);
}
