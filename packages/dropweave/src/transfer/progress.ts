/**
 * Transfer progress tracker.
 *
 * Computes percentage, speed (bytes/sec), and ETA from bytes transferred.
 * Emits progress snapshots that the CLI display layer consumes.
 */

import { TransferState, type TransferProgress } from '../core/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressCallback = (progress: TransferProgress) => void;

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class ProgressTracker {
  readonly transferId: string;
  readonly totalBytes: number;

  private _bytesTransferred = 0;
  private _state: TransferState = TransferState.Pending;
  private readonly startTime: number;
  private readonly callbacks: ProgressCallback[] = [];

  /** Rolling speed samples for smoothing (bytes/sec). */
  private speedSamples: number[] = [];
  private lastSampleTime: number;
  private lastSampleBytes = 0;
  private readonly maxSpeedSamples = 10;

  constructor(transferId: string, totalBytes: number) {
    this.transferId = transferId;
    this.totalBytes = totalBytes;
    this.startTime = performance.now();
    this.lastSampleTime = this.startTime;
  }

  /** Current bytes transferred. */
  get bytesTransferred(): number {
    return this._bytesTransferred;
  }

  /** Current transfer state. */
  get state(): TransferState {
    return this._state;
  }

  /** Register a callback for progress updates. */
  onProgress(cb: ProgressCallback): void {
    this.callbacks.push(cb);
  }

  /** Update the transfer state and emit a progress event. */
  setState(state: TransferState): void {
    this._state = state;
    this.emit();
  }

  /**
   * Record bytes transferred and emit a progress event.
   *
   * @param bytes - Additional bytes transferred since last call.
   */
  addBytes(bytes: number): void {
    this._bytesTransferred += bytes;

    // Update speed sample
    const now = performance.now();
    const elapsed = (now - this.lastSampleTime) / 1000; // seconds
    if (elapsed >= 0.25) {
      // Sample every 250ms
      const bytesDelta = this._bytesTransferred - this.lastSampleBytes;
      const speed = bytesDelta / elapsed;
      this.speedSamples.push(speed);
      if (this.speedSamples.length > this.maxSpeedSamples) {
        this.speedSamples.shift();
      }
      this.lastSampleTime = now;
      this.lastSampleBytes = this._bytesTransferred;
    }

    this.emit();
  }

  /** Build and return the current progress snapshot. */
  getSnapshot(): TransferProgress {
    const elapsed = performance.now() - this.startTime;
    const speed = this.getSpeed();
    const remaining = this.totalBytes - this._bytesTransferred;
    const eta =
      speed > 0 ? remaining / speed : null;

    return {
      transferId: this.transferId,
      bytesTransferred: this._bytesTransferred,
      totalBytes: this.totalBytes,
      percentage:
        this.totalBytes > 0
          ? Math.min(100, (this._bytesTransferred / this.totalBytes) * 100)
          : 0,
      speed,
      eta,
      elapsed,
      state: this._state,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /** Get smoothed speed in bytes/sec. */
  private getSpeed(): number {
    if (this.speedSamples.length === 0) {
      // Fallback: overall average
      const elapsed = (performance.now() - this.startTime) / 1000;
      return elapsed > 0 ? this._bytesTransferred / elapsed : 0;
    }

    // Average of recent samples
    const sum = this.speedSamples.reduce((a, b) => a + b, 0);
    return sum / this.speedSamples.length;
  }

  /** Emit progress to all registered callbacks. */
  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const cb of this.callbacks) {
      cb(snapshot);
    }
  }
}
