/**
 * Adaptive chunk sizing engine.
 *
 * Dynamically adjusts the chunk size based on network conditions:
 *   - RTT trending down + throughput rising → increase chunk size
 *   - RTT trending up or backpressure active → decrease chunk size
 *   - Stable for N chunks → probe with a small increase
 *
 * Bounds: MIN_CHUNK_SIZE ≤ chunkSize ≤ MAX_CHUNK_SIZE
 */

import {
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  INITIAL_CHUNK_SIZE,
  CHUNK_EVAL_WINDOW,
  CHUNK_INCREASE_FACTOR,
  CHUNK_DECREASE_FACTOR,
  CHUNK_PROBE_FACTOR,
} from '../core/constants.js';
import type { PacketTracker } from './packet.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChunkerConfig {
  minChunkSize?: number;
  maxChunkSize?: number;
  initialChunkSize?: number;
  evalWindow?: number;
}

enum ThroughputTrend {
  Rising = 'rising',
  Falling = 'falling',
  Stable = 'stable',
}

// ---------------------------------------------------------------------------
// Chunker
// ---------------------------------------------------------------------------

export class AdaptiveChunker {
  private currentSize: number;
  private readonly min: number;
  private readonly max: number;
  private readonly evalWindow: number;

  /** Number of chunks sent at the current size without adjustment. */
  private chunksSinceAdjust = 0;

  /** Previous throughput sample for trend detection. */
  private prevThroughput: number | null = null;

  /** Previous RTT sample for trend detection. */
  private prevRtt: number | null = null;

  constructor(config: ChunkerConfig = {}) {
    this.min = config.minChunkSize ?? MIN_CHUNK_SIZE;
    this.max = config.maxChunkSize ?? MAX_CHUNK_SIZE;
    this.currentSize = config.initialChunkSize ?? INITIAL_CHUNK_SIZE;
    this.evalWindow = config.evalWindow ?? CHUNK_EVAL_WINDOW;
  }

  /** Get the current recommended chunk size in bytes. */
  get chunkSize(): number {
    return this.currentSize;
  }

  /**
   * Called after each chunk is sent. Uses the packet tracker's
   * RTT and throughput data to decide whether to adjust the chunk size.
   *
   * @param tracker - The packet tracker providing RTT and throughput data.
   * @param isBackpressured - Whether the data channel is currently backpressured.
   */
  onChunkSent(tracker: PacketTracker, isBackpressured: boolean): void {
    this.chunksSinceAdjust++;

    // Don't evaluate until we have enough samples
    if (this.chunksSinceAdjust < this.evalWindow) return;

    const rtt = tracker.getCurrentRtt();
    const throughput = tracker.getCurrentThroughput();

    // If backpressured, always decrease
    if (isBackpressured) {
      this.decrease();
      return;
    }

    // Need both metrics to make a decision
    if (rtt === null || throughput === null) {
      this.chunksSinceAdjust = 0;
      return;
    }

    const rttTrend = this.getRttTrend(rtt);
    const throughputTrend = this.getThroughputTrend(throughput);

    // Decision matrix
    if (
      throughputTrend === ThroughputTrend.Rising &&
      rttTrend !== ThroughputTrend.Rising
    ) {
      // Throughput improving, RTT not degrading → increase
      this.increase();
    } else if (
      rttTrend === ThroughputTrend.Rising ||
      throughputTrend === ThroughputTrend.Falling
    ) {
      // RTT increasing or throughput dropping → decrease
      this.decrease();
    } else if (throughputTrend === ThroughputTrend.Stable) {
      // Stable conditions → conservative probe
      this.probe();
    }

    // Update previous values for next comparison
    this.prevRtt = rtt;
    this.prevThroughput = throughput;
  }

  // -------------------------------------------------------------------------
  // Adjustments
  // -------------------------------------------------------------------------

  private increase(): void {
    this.currentSize = Math.min(
      this.max,
      Math.floor(this.currentSize * CHUNK_INCREASE_FACTOR),
    );
    this.chunksSinceAdjust = 0;
  }

  private decrease(): void {
    this.currentSize = Math.max(
      this.min,
      Math.floor(this.currentSize * CHUNK_DECREASE_FACTOR),
    );
    this.chunksSinceAdjust = 0;
  }

  private probe(): void {
    this.currentSize = Math.min(
      this.max,
      Math.floor(this.currentSize * CHUNK_PROBE_FACTOR),
    );
    this.chunksSinceAdjust = 0;
  }

  // -------------------------------------------------------------------------
  // Trend Detection
  // -------------------------------------------------------------------------

  private getThroughputTrend(current: number): ThroughputTrend {
    if (this.prevThroughput === null) return ThroughputTrend.Stable;
    const ratio = current / this.prevThroughput;
    if (ratio > 1.1) return ThroughputTrend.Rising;
    if (ratio < 0.9) return ThroughputTrend.Falling;
    return ThroughputTrend.Stable;
  }

  private getRttTrend(current: number): ThroughputTrend {
    if (this.prevRtt === null) return ThroughputTrend.Stable;
    const ratio = current / this.prevRtt;
    if (ratio > 1.15) return ThroughputTrend.Rising;    // RTT up = bad
    if (ratio < 0.85) return ThroughputTrend.Falling;   // RTT down = good
    return ThroughputTrend.Stable;
  }

  /** Reset the chunker to initial state. */
  reset(): void {
    this.currentSize = this.min;
    this.chunksSinceAdjust = 0;
    this.prevThroughput = null;
    this.prevRtt = null;
  }
}
