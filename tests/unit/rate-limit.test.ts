/**
 * Tests for the rate limiter (token bucket).
 */

import { describe, test, expect } from 'bun:test';
import { TokenBucket, RateLimiterRegistry } from '../../apps/signaling-server/src/rate-limit/token-bucket';

describe('TokenBucket', () => {
  test('allows requests within capacity', () => {
    const bucket = new TokenBucket(5, 1);
    for (let i = 0; i < 5; i++) {
      expect(bucket.consume()).toBe(true);
    }
  });

  test('rejects when depleted', () => {
    const bucket = new TokenBucket(2, 0.1);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(false);
  });

  test('refills over time', async () => {
    const bucket = new TokenBucket(2, 100); // 100 tokens/sec
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(false);

    // Wait for refill
    await new Promise((r) => setTimeout(r, 50));

    expect(bucket.consume()).toBe(true);
  });

  test('available shows current tokens', () => {
    const bucket = new TokenBucket(10, 1);
    expect(bucket.available).toBe(10);
    bucket.consume(3);
    expect(bucket.available).toBe(7);
  });
});

describe('RateLimiterRegistry', () => {
  test('creates buckets for new connections', () => {
    const registry = new RateLimiterRegistry(5, 1);
    const bucket = registry.get('conn-1');
    expect(bucket.available).toBe(5);
  });

  test('returns same bucket for same connection', () => {
    const registry = new RateLimiterRegistry(5, 1);
    const a = registry.get('conn-1');
    const b = registry.get('conn-1');
    a.consume();
    expect(b.available).toBe(4); // Same bucket
  });

  test('removes bucket on disconnect', () => {
    const registry = new RateLimiterRegistry(5, 1);
    registry.get('conn-1');
    expect(registry.size).toBe(1);
    registry.remove('conn-1');
    expect(registry.size).toBe(0);
  });

  test('creates fresh bucket after removal', () => {
    const registry = new RateLimiterRegistry(5, 1);
    const first = registry.get('conn-1');
    first.consume(5); // Deplete
    registry.remove('conn-1');

    const second = registry.get('conn-1');
    expect(second.available).toBe(5); // Fresh bucket
  });
});
