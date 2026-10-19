/**
 * Tests for the binary packet protocol encoder/decoder.
 */

import { describe, test, expect } from 'bun:test';
import { encodePacket, decodePacket, jsonPayload, parseJsonPayload, createPingPacket, createPongPacket, extractRttFromPong } from '../../packages/dropweave/src/core/protocol';
import { PacketType, PacketFlags, PACKET_MAGIC } from '../../packages/dropweave/src/core/types';
import { PACKET_HEADER_SIZE, MAX_PAYLOAD_SIZE } from '../../packages/dropweave/src/core/constants';

describe('protocol', () => {
  describe('encodePacket / decodePacket roundtrip', () => {
    test('empty payload', () => {
      const encoded = encodePacket(PacketType.Ping, PacketFlags.None, 42);
      expect(encoded.byteLength).toBe(PACKET_HEADER_SIZE);

      const decoded = decodePacket(encoded);
      expect(decoded.header.magic).toBe(PACKET_MAGIC);
      expect(decoded.header.type).toBe(PacketType.Ping);
      expect(decoded.header.flags).toBe(PacketFlags.None);
      expect(decoded.header.seq).toBe(42);
      expect(decoded.header.payloadLength).toBe(0);
      expect(decoded.payload.byteLength).toBe(0);
    });

    test('binary payload roundtrip', () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encoded = encodePacket(PacketType.DataChunk, PacketFlags.LastChunk, 100, payload);

      expect(encoded.byteLength).toBe(PACKET_HEADER_SIZE + 8);

      const decoded = decodePacket(encoded);
      expect(decoded.header.type).toBe(PacketType.DataChunk);
      expect(decoded.header.flags).toBe(PacketFlags.LastChunk);
      expect(decoded.header.seq).toBe(100);
      expect(decoded.payload).toEqual(payload);
    });

    test('JSON payload roundtrip', () => {
      const obj = { transferId: 'abc123', fileName: 'test.txt', fileSize: 12345 };
      const payload = jsonPayload(obj);
      const encoded = encodePacket(PacketType.TransferOffer, PacketFlags.None, 1, payload);
      const decoded = decodePacket(encoded);
      const parsed = parseJsonPayload<typeof obj>(decoded.payload);

      expect(parsed.transferId).toBe('abc123');
      expect(parsed.fileName).toBe('test.txt');
      expect(parsed.fileSize).toBe(12345);
    });

    test('large payload', () => {
      const payload = new Uint8Array(64 * 1024); // 64 KiB
      payload.fill(0xAB);

      const encoded = encodePacket(PacketType.DataChunk, PacketFlags.None, 999, payload);
      const decoded = decodePacket(encoded);

      expect(decoded.header.payloadLength).toBe(64 * 1024);
      expect(decoded.payload[0]).toBe(0xAB);
      expect(decoded.payload[decoded.payload.length - 1]).toBe(0xAB);
    });

    test('all flag bits', () => {
      const flags = PacketFlags.AckRequired | PacketFlags.Compressed | PacketFlags.LastChunk | PacketFlags.Cancel;
      const encoded = encodePacket(PacketType.DataChunk, flags, 1);
      const decoded = decodePacket(encoded);

      expect(decoded.header.flags & PacketFlags.AckRequired).toBeTruthy();
      expect(decoded.header.flags & PacketFlags.Compressed).toBeTruthy();
      expect(decoded.header.flags & PacketFlags.LastChunk).toBeTruthy();
      expect(decoded.header.flags & PacketFlags.Cancel).toBeTruthy();
    });

    test('max sequence number (uint32 max)', () => {
      const seq = 0xFFFFFFFF;
      const encoded = encodePacket(PacketType.Ping, PacketFlags.None, seq);
      const decoded = decodePacket(encoded);
      expect(decoded.header.seq).toBe(seq);
    });
  });

  describe('error handling', () => {
    test('rejects payload exceeding MAX_PAYLOAD_SIZE', () => {
      const payload = new Uint8Array(MAX_PAYLOAD_SIZE + 1);
      expect(() => {
        encodePacket(PacketType.DataChunk, PacketFlags.None, 1, payload);
      }).toThrow('Payload size');
    });

    test('rejects buffer too short for header', () => {
      const short = new Uint8Array(5);
      expect(() => decodePacket(short)).toThrow('Buffer too short for packet header');
    });

    test('rejects invalid magic', () => {
      const buf = new Uint8Array(PACKET_HEADER_SIZE);
      const view = new DataView(buf.buffer);
      view.setUint16(0, 0x0000); // Wrong magic
      expect(() => decodePacket(buf)).toThrow('Invalid packet magic');
    });

    test('rejects truncated payload', () => {
      // Create a valid header that claims a 100-byte payload, but only provide header
      const buf = new Uint8Array(PACKET_HEADER_SIZE);
      const view = new DataView(buf.buffer);
      view.setUint16(0, PACKET_MAGIC);
      view.setUint8(2, PacketType.DataChunk);
      view.setUint8(3, 0);
      view.setUint32(4, 0);
      view.setUint32(8, 100); // Claims 100 bytes payload
      expect(() => decodePacket(buf)).toThrow('Buffer too short for payload');
    });
  });

  describe('PING/PONG RTT', () => {
    test('creates ping with timestamp', () => {
      const ping = createPingPacket(1);
      const decoded = decodePacket(ping);
      expect(decoded.header.type).toBe(PacketType.Ping);
      expect(decoded.payload.byteLength).toBe(8);
    });

    test('pong echoes ping payload', () => {
      const ping = createPingPacket(1);
      const decoded = decodePacket(ping);
      const pong = createPongPacket(2, decoded.payload);
      const pongDecoded = decodePacket(pong);

      expect(pongDecoded.header.type).toBe(PacketType.Pong);
      expect(pongDecoded.payload).toEqual(decoded.payload);
    });

    test('RTT extraction returns positive value', async () => {
      const ping = createPingPacket(1);
      const decoded = decodePacket(ping);
      
      // Small delay to ensure measurable RTT
      await new Promise((r) => setTimeout(r, 5));
      
      const rtt = extractRttFromPong(decoded.payload);
      expect(rtt).not.toBeNull();
      expect(rtt!).toBeGreaterThan(0);
    });
  });
});
