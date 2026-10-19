/**
 * Tests for the backpressure controller.
 */

import { describe, test, expect } from 'bun:test';
import { BackpressureController } from '../../packages/dropweave/src/transfer/backpressure';

describe('BackpressureController', () => {
  test('allows send when buffer is low', () => {
    const bp = new BackpressureController({
      highWaterMark: 1000,
      lowWaterMark: 200,
    });
    expect(bp.shouldSend(0)).toBe(true);
    expect(bp.shouldSend(500)).toBe(true);
    expect(bp.shouldSend(999)).toBe(true);
  });

  test('pauses at high water mark', () => {
    const bp = new BackpressureController({
      highWaterMark: 1000,
      lowWaterMark: 200,
    });
    expect(bp.shouldSend(1000)).toBe(false);
    expect(bp.isPaused).toBe(true);
  });

  test('stays paused until drain below low water', () => {
    const bp = new BackpressureController({
      highWaterMark: 1000,
      lowWaterMark: 200,
    });
    bp.shouldSend(1000); // Pause

    // Buffer drops but still above low water
    bp.checkDrain(500);
    expect(bp.isPaused).toBe(true);

    // Buffer drops below low water
    bp.checkDrain(100);
    expect(bp.isPaused).toBe(false);
  });

  test('fires drain callback', async () => {
    const bp = new BackpressureController({
      highWaterMark: 1000,
      lowWaterMark: 200,
    });
    bp.shouldSend(1000); // Pause

    let drained = false;
    bp.onDrain(() => {
      drained = true;
    });

    expect(drained).toBe(false);
    bp.checkDrain(100); // Below low water
    expect(drained).toBe(true);
  });

  test('waitForDrain resolves immediately if not paused', async () => {
    const bp = new BackpressureController({
      highWaterMark: 1000,
      lowWaterMark: 200,
    });
    await bp.waitForDrain(); // Should not block
  });

  test('waitForDrain resolves on drain', async () => {
    const bp = new BackpressureController({
      highWaterMark: 1000,
      lowWaterMark: 200,
    });
    bp.shouldSend(1000); // Pause

    const drainPromise = bp.waitForDrain();

    // Simulate async drain
    setTimeout(() => bp.checkDrain(0), 10);

    await drainPromise; // Should resolve
    expect(bp.isPaused).toBe(false);
  });

  test('rejects low >= high watermark', () => {
    expect(() => {
      new BackpressureController({
        highWaterMark: 100,
        lowWaterMark: 100,
      });
    }).toThrow('lowWaterMark');
  });

  test('reset clears state', () => {
    const bp = new BackpressureController({
      highWaterMark: 1000,
      lowWaterMark: 200,
    });
    bp.shouldSend(1000); // Pause
    expect(bp.isPaused).toBe(true);

    bp.reset();
    expect(bp.isPaused).toBe(false);
  });
});
