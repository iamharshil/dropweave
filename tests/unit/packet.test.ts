/**
 * Tests for the packet tracker.
 */

import { describe, test, expect } from 'bun:test';
import { PacketTracker } from '../../packages/dropweave/src/transfer/packet';

describe('PacketTracker', () => {
  test('allocates monotonic sequence numbers', () => {
    const tracker = new PacketTracker();
    expect(tracker.allocateSeq()).toBe(0);
    expect(tracker.allocateSeq()).toBe(1);
    expect(tracker.allocateSeq()).toBe(2);
  });

  test('tracks sent packets', () => {
    const tracker = new PacketTracker();
    const seq = tracker.allocateSeq();
    tracker.recordSent(seq, 1024);
    expect(tracker.inFlightCount).toBe(1);
  });

  test('records ACK and computes RTT', async () => {
    const tracker = new PacketTracker();
    const seq = tracker.allocateSeq();
    tracker.recordSent(seq, 1024);

    // Small delay
    await new Promise((r) => setTimeout(r, 10));

    const rtt = tracker.recordAck(seq);
    expect(rtt).not.toBeNull();
    expect(rtt!).toBeGreaterThan(0);
    expect(tracker.inFlightCount).toBe(0);
    expect(tracker.ackedCount).toBe(1);
    expect(tracker.bytesAcked).toBe(1024);
  });

  test('returns null for unknown ACK seq', () => {
    const tracker = new PacketTracker();
    const rtt = tracker.recordAck(999);
    expect(rtt).toBeNull();
  });

  test('computes RTT from manual samples', () => {
    const tracker = new PacketTracker();
    tracker.recordRtt(10);
    tracker.recordRtt(20);
    tracker.recordRtt(15);

    const rtt = tracker.getCurrentRtt();
    expect(rtt).not.toBeNull();
    expect(rtt!).toBeGreaterThan(0);
    expect(rtt!).toBeLessThan(25);
  });

  test('computes throughput from manual samples', () => {
    const tracker = new PacketTracker();
    tracker.recordThroughput(1_000_000);
    tracker.recordThroughput(1_200_000);

    const throughput = tracker.getCurrentThroughput();
    expect(throughput).not.toBeNull();
    expect(throughput!).toBe(1_100_000);
  });

  test('returns null when no samples', () => {
    const tracker = new PacketTracker();
    expect(tracker.getCurrentRtt()).toBeNull();
    expect(tracker.getCurrentThroughput()).toBeNull();
  });

  test('snapshot returns all fields', () => {
    const tracker = new PacketTracker();
    tracker.recordRtt(10);
    tracker.recordThroughput(500_000);

    const snap = tracker.snapshot();
    expect(snap.inFlight).toBe(0);
    expect(snap.acked).toBe(0);
    expect(snap.bytesAcked).toBe(0);
    expect(snap.rttMs).not.toBeNull();
    expect(snap.throughputBps).not.toBeNull();
  });

  test('bounds internal tracking map to prevent unbounded memory growth on large transfers', () => {
    const tracker = new PacketTracker();
    // Simulate sending 2000 packets without ACKs
    for (let i = 0; i < 2000; i++) {
      const seq = tracker.allocateSeq();
      tracker.recordSent(seq, 65536);
    }
    // inFlightCount must be capped at 500 (MAX_IN_FLIGHT_TRACKING), not 2000
    expect(tracker.inFlightCount).toBeLessThanOrEqual(500);
  });
});
