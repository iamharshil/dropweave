/**
 * Security and edge-case tests for path traversal prevention,
 * filename sanitization, and atomic file writing.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sanitizeFileName, FileWriter } from '../../packages/dropweave/src/adapters/node/file-writer';

describe('Security: Path Traversal & File Sanitization', () => {
  describe('sanitizeFileName', () => {
    test('strips simple directory traversal (../)', () => {
      expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
      expect(sanitizeFileName('../../../secret.txt')).toBe('secret.txt');
    });

    test('strips Windows directory traversal and drive letters', () => {
      // Path with backslashes on POSIX or Windows
      expect(sanitizeFileName('C:\\Windows\\System32\\cmd.exe')).not.toContain('\\');
      expect(sanitizeFileName('..\\..\\boot.ini')).not.toContain('\\');
      expect(sanitizeFileName('..\\..\\boot.ini')).not.toContain('..');
    });

    test('strips absolute Unix paths', () => {
      expect(sanitizeFileName('/etc/shadow')).toBe('shadow');
      expect(sanitizeFileName('/var/log/syslog')).toBe('syslog');
    });

    test('removes null bytes (\0) injection attempts', () => {
      const malicious = 'innocent.pdf\0.exe';
      const sanitized = sanitizeFileName(malicious);
      expect(sanitized).not.toContain('\0');
      expect(sanitized).toBe('innocent.pdf.exe');
    });

    test('removes ASCII control characters', () => {
      const withControls = 'report\x00\x08\x1b\x7f.doc';
      expect(sanitizeFileName(withControls)).toBe('report.doc');
    });

    test('removes leading dots to prevent hidden files', () => {
      expect(sanitizeFileName('.bashrc')).toBe('bashrc');
      expect(sanitizeFileName('..hidden_file')).toBe('hidden_file');
      expect(sanitizeFileName('...')).toBe('received_file');
    });

    test('replaces dangerous Windows reserved characters (< > : " / \\ | ? *)', () => {
      const dangerous = 'file<one>:two"three|four?five*six.txt';
      const sanitized = sanitizeFileName(dangerous);
      expect(sanitized).not.toMatch(/[<>:"/\\|?*]/);
      expect(sanitized).toBe('file_one__two_three_four_five_six.txt');
    });

    test('handles empty or whitespace-only inputs gracefully', () => {
      expect(sanitizeFileName('')).toBe('received_file');
      expect(sanitizeFileName('   ')).toBe('received_file');
      expect(sanitizeFileName('///')).toBe('received_file');
    });

    test('truncates excessively long file names while preserving extension', () => {
      const hugeName = 'a'.repeat(300) + '.tar.gz';
      const sanitized = sanitizeFileName(hugeName);
      expect(sanitized.length).toBeLessThanOrEqual(200);
      expect(sanitized.endsWith('.gz')).toBe(true);
    });
  });

  describe('FileWriter Security & Atomic Operations', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'dw-security-test-'));
    });

    afterEach(async () => {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    test('writes and finalizes file atomically inside destination directory', async () => {
      const writer = new FileWriter();
      const prepared = await writer.prepare(tempDir, 'document.txt');

      expect(prepared.path.startsWith(tempDir)).toBe(true);
      expect(prepared.fileName).toBe('document.txt');

      const chunk = new TextEncoder().encode('Hello, peer-to-peer security!');
      await writer.writeChunk(chunk);
      expect(writer.bytesWritten).toBe(chunk.byteLength);

      const finalPath = await writer.finalize();
      expect(finalPath).toBe(prepared.path);

      const content = await readFile(finalPath, 'utf8');
      expect(content).toBe('Hello, peer-to-peer security!');

      // Temp file must no longer exist
      let tempExists = false;
      try {
        await stat(finalPath + '.dwpart');
        tempExists = true;
      } catch {
        tempExists = false;
      }
      expect(tempExists).toBe(false);
    });

    test('aborts write and removes incomplete .dwpart temp file', async () => {
      const writer = new FileWriter();
      const prepared = await writer.prepare(tempDir, 'partial.bin');

      const chunk = new Uint8Array([1, 2, 3, 4, 5]);
      await writer.writeChunk(chunk);

      // Verify temp file exists before abort
      const tempPath = prepared.path + '.dwpart';
      const tempStats = await stat(tempPath);
      expect(tempStats.isFile()).toBe(true);

      // Abort
      await writer.abort();

      // Verify temp file is cleaned up
      let exists = false;
      try {
        await stat(tempPath);
        exists = true;
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });

    test('prevents filename collisions by generating safe indexed names', async () => {
      const writer1 = new FileWriter();
      await writer1.prepare(tempDir, 'duplicate.txt');
      await writer1.writeChunk(new TextEncoder().encode('version 1'));
      await writer1.finalize();

      const writer2 = new FileWriter();
      const prep2 = await writer2.prepare(tempDir, 'duplicate.txt');
      await writer2.writeChunk(new TextEncoder().encode('version 2'));
      await writer2.finalize();

      const writer3 = new FileWriter();
      const prep3 = await writer3.prepare(tempDir, 'duplicate.txt');
      await writer3.writeChunk(new TextEncoder().encode('version 3'));
      await writer3.finalize();

      expect(prep2.fileName).toBe('duplicate (1).txt');
      expect(prep3.fileName).toBe('duplicate (2).txt');

      const content1 = await readFile(join(tempDir, 'duplicate.txt'), 'utf8');
      const content2 = await readFile(join(tempDir, 'duplicate (1).txt'), 'utf8');
      const content3 = await readFile(join(tempDir, 'duplicate (2).txt'), 'utf8');

      expect(content1).toBe('version 1');
      expect(content2).toBe('version 2');
      expect(content3).toBe('version 3');
    });

    test('throws error when writing or finalizing before prepare()', async () => {
      const writer = new FileWriter();
      expect(writer.writeChunk(new Uint8Array([1]))).rejects.toThrow('FileWriter not prepared');
      expect(writer.finalize()).rejects.toThrow('FileWriter not prepared');
    });

    test('abort() is idempotent and safe to call multiple times', async () => {
      const writer = new FileWriter();
      await writer.prepare(tempDir, 'abort_test.txt');
      await writer.abort();
      // Second abort should not throw
      await expect(writer.abort()).resolves.toBeUndefined();
    });
  });
});
