/**
 * Backpressure controller for WebRTC data channel.
 *
 * Monitors the data channel's bufferedAmount and pauses/resumes sending
 * based on high and low watermarks. Prevents overwhelming the channel
 * and causing dropped messages or memory bloat.
 */

import { HIGH_WATER_MARK, LOW_WATER_MARK } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackpressureConfig {
  highWaterMark?: number;
  lowWaterMark?: number;
}

export type DrainCallback = () => void;

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class BackpressureController {
  readonly highWaterMark: number;
  readonly lowWaterMark: number;

  private _isPaused = false;
  private drainCallbacks: DrainCallback[] = [];

  constructor(config: BackpressureConfig = {}) {
    this.highWaterMark = config.highWaterMark ?? HIGH_WATER_MARK;
    this.lowWaterMark = config.lowWaterMark ?? LOW_WATER_MARK;

    if (this.lowWaterMark >= this.highWaterMark) {
      throw new RangeError(
        `lowWaterMark (${this.lowWaterMark}) must be less than highWaterMark (${this.highWaterMark})`,
      );
    }
  }

  /** Whether sending is currently paused due to backpressure. */
  get isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * Check whether a send should proceed given the current buffered amount.
   *
   * Call this before each send. If it returns false, wait for the
   * `onDrain` callback before sending again.
   */
  shouldSend(bufferedAmount: number): boolean {
    if (bufferedAmount >= this.highWaterMark) {
      this._isPaused = true;
      return false;
    }
    return !this._isPaused;
  }

  /**
   * Call this periodically (or when the channel reports a buffer drain)
   * to check if sending can resume.
   */
  checkDrain(bufferedAmount: number): void {
    if (this._isPaused && bufferedAmount <= this.lowWaterMark) {
      this._isPaused = false;
      // Fire drain callbacks
      const cbs = this.drainCallbacks.slice();
      this.drainCallbacks = [];
      for (const cb of cbs) {
        cb();
      }
    }
  }

  /**
   * Register a callback for when the buffer drains below the low watermark.
   * The callback is removed after it fires (one-shot).
   */
  onDrain(cb: DrainCallback): void {
    if (!this._isPaused) {
      // Already below low water, fire immediately
      cb();
      return;
    }
    this.drainCallbacks.push(cb);
  }

  /**
   * Wait for the buffer to drain (promise-based API).
   * Resolves immediately if not currently paused.
   */
  waitForDrain(): Promise<void> {
    if (!this._isPaused) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainCallbacks.push(resolve);
    });
  }

  /** Reset state. */
  reset(): void {
    this._isPaused = false;
    this.drainCallbacks = [];
  }
}
