/**
 * Secure 8-character connection code generator.
 *
 * Uses Crockford Base32 alphabet (no I, L, O, U) with crypto.getRandomValues()
 * for CSPRNG. Normalizes input for case-insensitive, separator-tolerant matching.
 *
 * 8 characters × 5 bits = 40 bits of entropy (~1 trillion codes).
 */

import { randomBytes } from 'node:crypto';
import { SESSION_CODE_LENGTH, CROCKFORD_ALPHABET } from './constants.js';

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure 8-character session code.
 *
 * Uses rejection sampling to avoid modulo bias: each random byte is
 * accepted only if it falls within the largest multiple of 32 that
 * fits in a byte (256 − 256 % 32 = 256, so no bias for base-32).
 */
export function generateSessionCode(): string {
  const chars: string[] = [];
  const alphabetLen = CROCKFORD_ALPHABET.length; // 32

  while (chars.length < SESSION_CODE_LENGTH) {
    const bytes = randomBytes(SESSION_CODE_LENGTH - chars.length);
    for (const byte of bytes) {
      if (chars.length >= SESSION_CODE_LENGTH) break;
      // 256 % 32 === 0, so every byte maps cleanly. No rejection needed.
      chars.push(CROCKFORD_ALPHABET[byte % alphabetLen]!);
    }
  }

  return chars.join('');
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Character substitution map for Crockford Base32 decoding tolerance.
 * Handles common confusions (0/O, 1/I/L) and strips separators.
 */
const SUBSTITUTIONS: Record<string, string> = {
  O: '0',
  o: '0',
  I: '1',
  i: '1',
  L: '1',
  l: '1',
};

/**
 * Normalize a user-entered code to canonical form.
 *
 * - Strips hyphens, spaces, and other separators.
 * - Uppercases all characters.
 * - Applies Crockford substitutions (O→0, I/L→1).
 * - Returns the normalized string.
 */
export function normalizeCode(input: string): string {
  return input
    .replace(/[-\s_.]/g, '')  // Strip common separators
    .split('')
    .map((ch) => {
      const sub = SUBSTITUTIONS[ch];
      return (sub ?? ch).toUpperCase();
    })
    .join('');
}

/**
 * Validate that a normalized code is well-formed.
 *
 * @returns true if the code has the correct length and only valid characters.
 */
export function isValidCode(code: string): boolean {
  if (code.length !== SESSION_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!CROCKFORD_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * Format a code for display with a hyphen separator: "7KMP-4Q9D".
 */
export function formatCode(code: string): string {
  if (code.length !== SESSION_CODE_LENGTH) return code;
  const mid = SESSION_CODE_LENGTH / 2;
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}
