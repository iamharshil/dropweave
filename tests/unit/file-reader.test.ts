/**
 * Tests for FileReader adapter — chunking, bounded memory reads,
 * and MIME type detection edge cases.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileReader } from '../../packages/dropweave/src/adapters/node/file-reader';

describe('FileReader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dw-reader-test-'));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test('opens and reads file in chunks with correct progress and completion flags', async () => {
    const filePath = join(tempDir, 'data.txt');
    const content = 'The quick brown fox jumps over the lazy dog.';
    await writeFile(filePath, content, 'utf8');

    const reader = new FileReader();
    const meta = await reader.open(filePath);

    expect(meta.fileName).toBe('data.txt');
    expect(meta.fileSize).toBe(Buffer.byteLength(content));
    expect(meta.mimeType).toBe('text/plain');
    expect(reader.offset).toBe(0);
    expect(reader.isComplete).toBe(false);

    // Read in 10-byte chunks
    const chunks: Uint8Array[] = [];
    while (!reader.isComplete) {
      const chunk = await reader.readChunk(10);
      if (chunk) chunks.push(chunk);
    }

    expect(reader.isComplete).toBe(true);
    expect(reader.offset).toBe(meta.fileSize);

    // Read past EOF returns null
    const eofChunk = await reader.readChunk(10);
    expect(eofChunk).toBeNull();

    // Reconstruct
    const totalBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    expect(totalBytes).toBe(meta.fileSize);

    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    expect(merged).toBe(content);

    await reader.close();
  });

  test('handles empty 0-byte file gracefully', async () => {
    const emptyPath = join(tempDir, 'empty.txt');
    await writeFile(emptyPath, '', 'utf8');

    const reader = new FileReader();
    const meta = await reader.open(emptyPath);

    expect(meta.fileSize).toBe(0);
    expect(reader.isComplete).toBe(true);

    const chunk = await reader.readChunk(1024);
    expect(chunk).toBeNull();

    await reader.close();
  });

  test('throws error when opening a directory instead of a regular file', async () => {
    const subDir = join(tempDir, 'subfolder');
    await mkdir(subDir);

    const reader = new FileReader();
    expect(reader.open(subDir)).rejects.toThrow('Not a file');
  });

  test('throws error when opening non-existent file', async () => {
    const reader = new FileReader();
    expect(reader.open(join(tempDir, 'does-not-exist.bin'))).rejects.toThrow();
  });

  test('detects various file MIME types properly and defaults to octet-stream for unknown', async () => {
    const extensions = [
      { ext: 'video.mp4', expected: 'video/mp4' },
      { ext: 'archive.tar.gz', expected: 'application/gzip' },
      { ext: 'image.png', expected: 'image/png' },
      { ext: 'document.pdf', expected: 'application/pdf' },
      { ext: 'app.wasm', expected: 'application/wasm' },
      { ext: 'script.ts', expected: 'text/typescript' },
      { ext: 'custom.unknownext', expected: 'application/octet-stream' },
    ];

    for (const { ext, expected } of extensions) {
      const p = join(tempDir, ext);
      await writeFile(p, 'dummy');

      const reader = new FileReader();
      const meta = await reader.open(p);
      expect(meta.mimeType).toBe(expected);
      await reader.close();
    }
  });

  test('close() is idempotent and safe to call when handle is null', async () => {
    const reader = new FileReader();
    await expect(reader.close()).resolves.toBeUndefined();
  });
});
