/**
 * Constants for the dropweave protocol.
 *
 * Configurable defaults live here — chunk sizes, timeouts, limits.
 * Nothing in this file should import platform-specific APIs.
 */

// ---------------------------------------------------------------------------
// Packet Protocol
// ---------------------------------------------------------------------------

/** Package version. */
export const VERSION = '1.0.7';

/** Size of the binary packet header in bytes. */
export const PACKET_HEADER_SIZE = 12;

/** Maximum payload size in a single packet (256 KiB). */
export const MAX_PAYLOAD_SIZE = 256 * 1024;

// ---------------------------------------------------------------------------
// Chunk Sizing (Adaptive)
// ---------------------------------------------------------------------------

/** Minimum chunk size in bytes (16 KiB). */
export const MIN_CHUNK_SIZE = 16 * 1024;

/** Maximum chunk size in bytes (256 KiB). */
export const MAX_CHUNK_SIZE = 256 * 1024;

/** Initial chunk size before adaptive sizing kicks in (16 KiB). */
export const INITIAL_CHUNK_SIZE = 16 * 1024;

/** Number of chunks in the evaluation window for adaptive sizing. */
export const CHUNK_EVAL_WINDOW = 10;

/** Factor to increase chunk size when conditions are good. */
export const CHUNK_INCREASE_FACTOR = 2.0;

/** Factor to decrease chunk size when conditions degrade. */
export const CHUNK_DECREASE_FACTOR = 0.5;

/** Factor for a conservative probe when throughput is stable. */
export const CHUNK_PROBE_FACTOR = 1.25;

// ---------------------------------------------------------------------------
// Backpressure
// ---------------------------------------------------------------------------

/** Pause sending when data channel bufferedAmount exceeds this (1 MiB). */
export const HIGH_WATER_MARK = 1 * 1024 * 1024;

/** Resume sending when data channel bufferedAmount drops below this (256 KiB). */
export const LOW_WATER_MARK = 256 * 1024;

// ---------------------------------------------------------------------------
// Session / Connection
// ---------------------------------------------------------------------------

/** Default session code expiry in seconds (10 minutes). */
export const DEFAULT_SESSION_TIMEOUT = 600;

/** Length of the session connection code in characters. */
export const SESSION_CODE_LENGTH = 8;

/**
 * Crockford Base32 alphabet (excludes I, L, O, U to avoid ambiguity).
 * 32 characters → 5 bits per character → 8 chars = 40 bits of entropy.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Maximum join attempts per connection before cooldown. */
export const MAX_JOIN_ATTEMPTS_PER_CONNECTION = 5;

/** Cooldown period in milliseconds after exceeding join attempts (30 seconds). */
export const JOIN_ATTEMPT_COOLDOWN_MS = 30_000;

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

/** Maximum file name length in bytes (to reject absurdly long names). */
export const MAX_FILE_NAME_LENGTH = 255;

/** Maximum metadata JSON payload size in bytes (64 KiB). */
export const MAX_METADATA_SIZE = 64 * 1024;

/** Transfer timeout: how long to wait for the peer after connection (30 sec). */
export const TRANSFER_IDLE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// RTT / Diagnostics
// ---------------------------------------------------------------------------

/** Number of RTT samples to keep for the rolling average. */
export const RTT_SAMPLE_WINDOW = 20;

/** Number of throughput samples to keep for the rolling average. */
export const THROUGHPUT_SAMPLE_WINDOW = 10;

/** Interval between PING packets for RTT measurement (2 seconds). */
export const PING_INTERVAL_MS = 2_000;

import type { IceServerConfig } from './types.js';

/** Public STUN servers (Google). Used when no custom config is provided. */
export const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

