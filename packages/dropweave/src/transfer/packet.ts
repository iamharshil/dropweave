/**
 * Packet tracker for sequence-level diagnostics.
 *
 * Tracks every sent packet's sequence number, timestamps ACKs, computes
 * rolling RTT and throughput, and feeds data to the adaptive chunk sizer.
 */

import {
  RTT_SAMPLE_WINDOW,
  THROUGHPUT_SAMPLE_WINDOW,
} from '../core/constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SentRecord {
  timestamp: number; // performance.now() at send time
  size: number;      // payload size in bytes
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class PacketTracker {
  /** Outstanding sent packets awaiting ACK. */
  private readonly sent = new Map<number, SentRecord>();

  /** Set of acknowledged sequence numbers. */
  private readonly acked = new Set<number>();

  /** Rolling RTT samples in milliseconds. */
  private readonly rttSamples: number[] = [];

  /** Rolling throughput samples in bytes/sec. */
  private readonly throughputSamples: number[] = [];

  /** Total bytes acknowledged so far. */
  private totalBytesAcked = 0;

  /** Timestamp of the first ACK (for overall throughput). */
  private firstAckTime: number | null = null;

  /** Next sequence number to assign. */
  private nextSeq = 0;

  // -------------------------------------------------------------------------
  // Sequence Management
  // -------------------------------------------------------------------------

  /** Allocate the next monotonic sequence number. */
  allocateSeq(): number {
    return this.nextSeq++;
  }

  // -------------------------------------------------------------------------
  // Send / ACK
  // -------------------------------------------------------------------------

  /** Record a packet being sent. */
  recordSent(seq: number, size: number): void {
    this.sent.set(seq, { timestamp: performance.now(), size });
  }

  /**
   * Record an ACK for a previously sent packet.
   * Updates RTT and throughput samples.
   *
   * @returns RTT for this packet in ms, or null if the seq was unknown.
   */
  recordAck(seq: number): number | null {
    const record = this.sent.get(seq);
    if (!record) return null;

    const now = performance.now();
    const rtt = now - record.timestamp;

    // Record RTT sample
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > RTT_SAMPLE_WINDOW) {
      this.rttSamples.shift();
    }

    // Track throughput
    this.totalBytesAcked += record.size;
    if (this.firstAckTime === null) {
      this.firstAckTime = now;
    } else {
      const elapsed = (now - this.firstAckTime) / 1000; // seconds
      if (elapsed > 0) {
        const throughput = this.totalBytesAcked / elapsed;
        this.throughputSamples.push(throughput);
        if (this.throughputSamples.length > THROUGHPUT_SAMPLE_WINDOW) {
          this.throughputSamples.shift();
        }
      }
    }

    // Cleanup
    this.sent.delete(seq);
    this.acked.add(seq);

    return rtt;
  }

  // -------------------------------------------------------------------------
  // RTT
  // -------------------------------------------------------------------------

  /**
   * Record an RTT sample directly (e.g. from PING/PONG).
   */
  recordRtt(rttMs: number): void {
    this.rttSamples.push(rttMs);
    if (this.rttSamples.length > RTT_SAMPLE_WINDOW) {
      this.rttSamples.shift();
    }
  }

  /**
   * Get the current RTT estimate as an exponential moving average.
   * Returns null if no samples exist.
   */
  getCurrentRtt(): number | null {
    if (this.rttSamples.length === 0) return null;

    // EMA with α = 2 / (N + 1)
    const alpha = 2 / (this.rttSamples.length + 1);
    let ema = this.rttSamples[0]!;
    for (let i = 1; i < this.rttSamples.length; i++) {
      ema = alpha * this.rttSamples[i]! + (1 - alpha) * ema;
    }
    return ema;
  }

  // -------------------------------------------------------------------------
  // Throughput
  // -------------------------------------------------------------------------

  /**
   * Record a throughput sample directly.
   */
  recordThroughput(bytesPerSec: number): void {
    this.throughputSamples.push(bytesPerSec);
    if (this.throughputSamples.length > THROUGHPUT_SAMPLE_WINDOW) {
      this.throughputSamples.shift();
    }
  }

  /**
   * Get the current throughput estimate in bytes/sec.
   * Returns null if no samples exist.
   */
  getCurrentThroughput(): number | null {
    if (this.throughputSamples.length === 0) return null;

    // Simple average of recent samples
    const sum = this.throughputSamples.reduce((a, b) => a + b, 0);
    return sum / this.throughputSamples.length;
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /** Number of packets currently in-flight (sent but not ACKed). */
  get inFlightCount(): number {
    return this.sent.size;
  }

  /** Total packets ACKed. */
  get ackedCount(): number {
    return this.acked.size;
  }

  /** Total bytes ACKed. */
  get bytesAcked(): number {
    return this.totalBytesAcked;
  }

  /** Get a snapshot of current tracker state for debugging. */
  snapshot(): {
    inFlight: number;
    acked: number;
    bytesAcked: number;
    rttMs: number | null;
    throughputBps: number | null;
  } {
    return {
      inFlight: this.inFlightCount,
      acked: this.ackedCount,
      bytesAcked: this.totalBytesAcked,
      rttMs: this.getCurrentRtt(),
      throughputBps: this.getCurrentThroughput(),
    };
  }
}
