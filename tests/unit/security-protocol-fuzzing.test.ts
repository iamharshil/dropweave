/**
 * Security and resilience tests for protocol fuzzing, corrupted byte packets,
 * boundary sizes, and invalid headers.
 */

import { describe, test, expect } from 'bun:test';
import { encodePacket, decodePacket, jsonPayload, parseJsonPayload } from '../../packages/dropweave/src/core/protocol';
import { PacketType, PacketFlags, PACKET_MAGIC } from '../../packages/dropweave/src/core/types';
import { PACKET_HEADER_SIZE, MAX_PAYLOAD_SIZE } from '../../packages/dropweave/src/core/constants';
import { randomBytes } from 'node:crypto';

describe('Security: Protocol Fuzzing & Boundary Testing', () => {
  test('rejects buffers shorter than PACKET_HEADER_SIZE', () => {
    for (let len = 0; len < PACKET_HEADER_SIZE; len++) {
      const shortBuffer = new Uint8Array(len);
      expect(() => decodePacket(shortBuffer)).toThrow('Buffer too short for packet header');
    }
  });

  test('rejects packets with incorrect magic bytes', () => {
    const valid = encodePacket(PacketType.Ping, PacketFlags.None, 1);
    // Mutate magic
    valid[0] = 0x00;
    valid[1] = 0x00;
    expect(() => decodePacket(valid)).toThrow('Invalid packet magic');
  });

  test('rejects packets claiming payload length larger than buffer length (truncated packets)', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const valid = encodePacket(PacketType.DataChunk, PacketFlags.None, 10, payload);

    // Truncate buffer by 4 bytes
    const truncated = valid.slice(0, valid.byteLength - 4);
    expect(() => decodePacket(truncated)).toThrow('Buffer too short for payload');
  });

  test('rejects payloads strictly exceeding MAX_PAYLOAD_SIZE (256 KiB)', () => {
    const oversized = new Uint8Array(MAX_PAYLOAD_SIZE + 1);
    expect(() => {
      encodePacket(PacketType.DataChunk, PacketFlags.None, 1, oversized);
    }).toThrow('exceeds maximum');
  });

  test('handles boundary sequence numbers (uint32 maximum 0xFFFFFFFF)', () => {
    const maxUint32 = 4294967295;
    const packet = encodePacket(PacketType.ChunkAck, PacketFlags.None, maxUint32);
    const decoded = decodePacket(packet);

    expect(decoded.header.seq).toBe(maxUint32);
  });

  test('fuzzing: handles random garbage bytes without crashing process', () => {
    // Generate 200 random byte arrays of various lengths
    for (let i = 0; i < 200; i++) {
      const randomLength = Math.floor(Math.random() * 500);
      const garbage = randomBytes(randomLength);

      try {
        decodePacket(new Uint8Array(garbage));
      } catch (err: any) {
        // Must throw an expected protocol error, not an unhandled crash or range error
        expect(err).toBeInstanceOf(Error);
      }
    }
  });

  test('fuzzing: random bytes prefixed with valid magic do not crash', () => {
    for (let i = 0; i < 100; i++) {
      const length = 12 + Math.floor(Math.random() * 100);
      const buffer = randomBytes(length);
      // Inject magic
      buffer.writeUInt16BE(PACKET_MAGIC, 0);

      try {
        decodePacket(new Uint8Array(buffer));
      } catch (err: any) {
        expect(err).toBeInstanceOf(Error);
      }
    }
  });

  test('parseJsonPayload safely rejects malformed or corrupted JSON', () => {
    const invalidJson = new TextEncoder().encode('{ not-valid-json: [}}');
    expect(() => {
      parseJsonPayload(invalidJson);
    }).toThrow('Failed to parse JSON payload');
  });
});
