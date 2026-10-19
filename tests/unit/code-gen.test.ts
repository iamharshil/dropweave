/**
 * Tests for the 8-character session code generator.
 */

import { describe, test, expect } from 'bun:test';
import {
  generateSessionCode,
  normalizeCode,
  isValidCode,
  formatCode,
} from '../../packages/dropweave/src/core/code-gen';
import { SESSION_CODE_LENGTH, CROCKFORD_ALPHABET } from '../../packages/dropweave/src/core/constants';

describe('code-gen', () => {
  describe('generateSessionCode', () => {
    test('generates code of correct length', () => {
      const code = generateSessionCode();
      expect(code.length).toBe(SESSION_CODE_LENGTH);
    });

    test('uses only Crockford Base32 characters', () => {
      for (let i = 0; i < 100; i++) {
        const code = generateSessionCode();
        for (const ch of code) {
          expect(CROCKFORD_ALPHABET).toContain(ch);
        }
      }
    });

    test('generates unique codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        codes.add(generateSessionCode());
      }
      // With 40 bits of entropy, 1000 codes should be unique
      expect(codes.size).toBe(1000);
    });
  });

  describe('normalizeCode', () => {
    test('strips hyphens', () => {
      expect(normalizeCode('7KMP-4Q9D')).toBe('7KMP4Q9D');
    });

    test('strips spaces', () => {
      expect(normalizeCode('7KMP 4Q9D')).toBe('7KMP4Q9D');
    });

    test('uppercases', () => {
      expect(normalizeCode('7kmp4q9d')).toBe('7KMP4Q9D');
    });

    test('substitutes O → 0', () => {
      expect(normalizeCode('OKMP4Q9D')).toBe('0KMP4Q9D');
    });

    test('substitutes I → 1', () => {
      expect(normalizeCode('IKMP4Q9D')).toBe('1KMP4Q9D');
    });

    test('substitutes L → 1', () => {
      expect(normalizeCode('LKMP4Q9D')).toBe('1KMP4Q9D');
    });

    test('handles mixed separators', () => {
      expect(normalizeCode('7k.mp_4q-9d')).toBe('7KMP4Q9D');
    });
  });

  describe('isValidCode', () => {
    test('accepts valid code', () => {
      expect(isValidCode('7KMP4Q9D')).toBe(true);
    });

    test('rejects short code', () => {
      expect(isValidCode('7KMP')).toBe(false);
    });

    test('rejects long code', () => {
      expect(isValidCode('7KMP4Q9DA')).toBe(false);
    });

    test('rejects code with invalid characters', () => {
      expect(isValidCode('7KMP4Q9I')).toBe(false); // I is not in Crockford
      expect(isValidCode('7KMP4Q9O')).toBe(false); // O is not in Crockford
      expect(isValidCode('7KMP4Q9L')).toBe(false); // L is not in Crockford
      expect(isValidCode('7KMP4Q9U')).toBe(false); // U is not in Crockford
    });
  });

  describe('formatCode', () => {
    test('adds hyphen separator', () => {
      expect(formatCode('7KMP4Q9D')).toBe('7KMP-4Q9D');
    });

    test('passes through non-standard length', () => {
      expect(formatCode('SHORT')).toBe('SHORT');
    });
  });
});
