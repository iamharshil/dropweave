/**
 * Per-connection rate limiter using a token bucket.
 *
 * No IP storage — rate limiting is scoped to the WebSocket connection.
 * When the connection closes, the bucket is garbage-collected.
 */

// ---------------------------------------------------------------------------
// Token Bucket
// ---------------------------------------------------------------------------

export class TokenBucket {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond
  private lastRefill: number;

  /**
   * @param maxTokens - Maximum burst capacity.
   * @param refillPerSecond - Tokens refilled per second.
   */
  constructor(maxTokens: number, refillPerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token.
   * @returns true if allowed, false if rate-limited.
   */
  consume(count: number = 1): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /** Current available tokens. */
  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRate,
    );
    this.lastRefill = now;
  }
}

// ---------------------------------------------------------------------------
// Rate Limiter Registry
// ---------------------------------------------------------------------------

/**
 * Manages per-connection rate limiters.
 * When a connection closes, call `remove()` to free the bucket.
 */
export class RateLimiterRegistry {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly maxTokens: number;
  private readonly refillPerSecond: number;

  constructor(maxTokens: number = 10, refillPerSecond: number = 2) {
    this.maxTokens = maxTokens;
    this.refillPerSecond = refillPerSecond;
  }

  /** Get or create a rate limiter for a connection ID. */
  get(connectionId: string): TokenBucket {
    let bucket = this.buckets.get(connectionId);
    if (!bucket) {
      bucket = new TokenBucket(this.maxTokens, this.refillPerSecond);
      this.buckets.set(connectionId, bucket);
    }
    return bucket;
  }

  /** Remove a connection's rate limiter (on disconnect). */
  remove(connectionId: string): void {
    this.buckets.delete(connectionId);
  }

  /** Current number of tracked connections. */
  get size(): number {
    return this.buckets.size;
  }
}
