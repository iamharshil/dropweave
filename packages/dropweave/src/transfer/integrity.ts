/**
 * Streaming integrity verification using SHA-256.
 *
 * Processes file chunks incrementally so we never need the entire file
 * in memory to compute the hash. Uses Node.js built-in crypto.
 */

import { createHash, type Hash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Streaming Hasher
// ---------------------------------------------------------------------------

export class IntegrityHasher {
  private readonly hash: Hash;
  private _bytesProcessed = 0;
  private _finalized = false;

  constructor(algorithm: string = 'sha256') {
    this.hash = createHash(algorithm);
  }

  /** Total bytes fed to the hasher so far. */
  get bytesProcessed(): number {
    return this._bytesProcessed;
  }

  /** Whether digest() has been called (no more updates allowed). */
  get isFinalized(): boolean {
    return this._finalized;
  }

  /**
   * Feed a chunk of data into the hash.
   *
   * @throws If the hasher has already been finalized.
   */
  update(chunk: Uint8Array): void {
    if (this._finalized) {
      throw new Error('IntegrityHasher already finalized');
    }
    this.hash.update(chunk);
    this._bytesProcessed += chunk.byteLength;
  }

  /**
   * Finalize and return the hash digest as a Uint8Array (32 bytes for SHA-256).
   *
   * After calling this, no more updates are allowed.
   */
  digest(): Uint8Array {
    if (this._finalized) {
      throw new Error('IntegrityHasher already finalized');
    }
    this._finalized = true;
    const buf = this.hash.digest();
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /**
   * Finalize and return the hash as a hex string.
   */
  digestHex(): string {
    if (this._finalized) {
      throw new Error('IntegrityHasher already finalized');
    }
    this._finalized = true;
    return this.hash.digest('hex');
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two hash digests.
 * Prevents timing attacks on integrity verification.
 */
export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;

  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Convenience: compute SHA-256 of a complete buffer in one call.
 */
export function sha256(data: Uint8Array): Uint8Array {
  const hasher = new IntegrityHasher('sha256');
  hasher.update(data);
  return hasher.digest();
}
