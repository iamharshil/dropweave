/**
 * Tests for the integrity hasher.
 */

import { describe, test, expect } from 'bun:test';
import { IntegrityHasher, hashesEqual, sha256 } from '../../packages/dropweave/src/transfer/integrity';

describe('IntegrityHasher', () => {
  test('produces correct SHA-256 for known input', () => {
    const hasher = new IntegrityHasher('sha256');
    hasher.update(new TextEncoder().encode('hello'));
    const hex = hasher.digestHex();
    // SHA-256 of "hello"
    expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('streaming hash matches single-shot', () => {
    const data = new TextEncoder().encode('the quick brown fox jumps over the lazy dog');

    // Single shot
    const singleHash = sha256(data);

    // Streaming (chunk by chunk)
    const hasher = new IntegrityHasher('sha256');
    hasher.update(data.slice(0, 10));
    hasher.update(data.slice(10, 25));
    hasher.update(data.slice(25));
    const streamHash = hasher.digest();

    expect(hashesEqual(singleHash, streamHash)).toBe(true);
  });

  test('tracks bytes processed', () => {
    const hasher = new IntegrityHasher('sha256');
    expect(hasher.bytesProcessed).toBe(0);

    hasher.update(new Uint8Array(100));
    expect(hasher.bytesProcessed).toBe(100);

    hasher.update(new Uint8Array(50));
    expect(hasher.bytesProcessed).toBe(150);
  });

  test('prevents update after finalization', () => {
    const hasher = new IntegrityHasher('sha256');
    hasher.update(new Uint8Array(1));
    hasher.digest();
    expect(hasher.isFinalized).toBe(true);
    expect(() => hasher.update(new Uint8Array(1))).toThrow('already finalized');
  });

  test('prevents double digest', () => {
    const hasher = new IntegrityHasher('sha256');
    hasher.update(new Uint8Array(1));
    hasher.digestHex();
    expect(() => hasher.digest()).toThrow('already finalized');
  });
});

describe('hashesEqual', () => {
  test('equal hashes return true', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(hashesEqual(a, b)).toBe(true);
  });

  test('different hashes return false', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(hashesEqual(a, b)).toBe(false);
  });

  test('different lengths return false', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(hashesEqual(a, b)).toBe(false);
  });
});

describe('sha256 convenience', () => {
  test('produces 32-byte hash', () => {
    const hash = sha256(new Uint8Array([1, 2, 3]));
    expect(hash.byteLength).toBe(32);
  });
});
