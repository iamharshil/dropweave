/**
 * Tests for the adaptive chunk sizer.
 */

import { describe, test, expect } from 'bun:test';
import { AdaptiveChunker } from '../../packages/dropweave/src/transfer/chunker';
import { PacketTracker } from '../../packages/dropweave/src/transfer/packet';

describe('AdaptiveChunker', () => {
  test('starts at initial chunk size', () => {
    const chunker = new AdaptiveChunker({ initialChunkSize: 16384 });
    expect(chunker.chunkSize).toBe(16384);
  });

  test('respects custom min/max', () => {
    const chunker = new AdaptiveChunker({
      minChunkSize: 8192,
      maxChunkSize: 131072,
      initialChunkSize: 8192,
    });
    expect(chunker.chunkSize).toBe(8192);
  });

  test('does not adjust before evaluation window', () => {
    const chunker = new AdaptiveChunker({ evalWindow: 5, initialChunkSize: 16384 });
    const tracker = new PacketTracker();

    // Feed 4 chunks (less than window of 5)
    for (let i = 0; i < 4; i++) {
      chunker.onChunkSent(tracker, false);
    }

    expect(chunker.chunkSize).toBe(16384); // Unchanged
  });

  test('decreases under backpressure', () => {
    const chunker = new AdaptiveChunker({
      evalWindow: 2,
      initialChunkSize: 32768,
      minChunkSize: 8192,
    });
    const tracker = new PacketTracker();
    tracker.recordRtt(10);
    tracker.recordThroughput(1_000_000);

    // Simulate backpressure
    for (let i = 0; i < 3; i++) {
      chunker.onChunkSent(tracker, true);
    }

    expect(chunker.chunkSize).toBeLessThan(32768);
  });

  test('does not go below minimum', () => {
    const chunker = new AdaptiveChunker({
      evalWindow: 1,
      initialChunkSize: 16384,
      minChunkSize: 16384,
    });
    const tracker = new PacketTracker();

    // Force decrease under backpressure
    for (let i = 0; i < 10; i++) {
      chunker.onChunkSent(tracker, true);
    }

    expect(chunker.chunkSize).toBe(16384);
  });

  test('reset returns to initial state', () => {
    const chunker = new AdaptiveChunker({
      evalWindow: 1,
      initialChunkSize: 32768,
      minChunkSize: 16384,
    });
    const tracker = new PacketTracker();

    // Modify state
    for (let i = 0; i < 5; i++) {
      chunker.onChunkSent(tracker, true);
    }

    chunker.reset();
    expect(chunker.chunkSize).toBe(16384); // Reset to min
  });
});
