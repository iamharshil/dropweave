/**
 * Node.js file reader with bounded memory.
 *
 * Reads files chunk-by-chunk using file handles and bounded reads.
 * Never loads the entire file into memory.
 */

import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// MIME Detection (simple, no deps)
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.wasm': 'application/wasm',
  '.iso': 'application/x-iso9660-image',
  '.dmg': 'application/x-apple-diskimage',
  '.deb': 'application/x-debian-package',
  '.rpm': 'application/x-rpm',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
};

function detectMimeType(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// File Reader
// ---------------------------------------------------------------------------

export class FileReader {
  private handle: FileHandle | null = null;
  private _offset = 0;
  private _fileSize = 0;
  private _fileName = '';
  private _mimeType = '';

  /** Current read offset in the file. */
  get offset(): number {
    return this._offset;
  }

  /** Total file size in bytes. */
  get fileSize(): number {
    return this._fileSize;
  }

  /** Whether all bytes have been read. */
  get isComplete(): boolean {
    return this._offset >= this._fileSize;
  }

  /** File metadata for the transfer offer. */
  get metadata(): FileMetadata {
    return {
      fileName: this._fileName,
      fileSize: this._fileSize,
      mimeType: this._mimeType,
    };
  }

  /**
   * Open a file for reading.
   *
   * @param filePath - Absolute path to the file.
   * @throws If the file doesn't exist or can't be read.
   */
  async open(filePath: string): Promise<FileMetadata> {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    this.handle = await open(filePath, 'r');
    this._fileSize = stats.size;
    this._offset = 0;

    // Extract just the filename (no path traversal)
    const parts = filePath.split(/[/\\]/);
    this._fileName = parts[parts.length - 1] ?? 'unknown';
    this._mimeType = detectMimeType(this._fileName);

    return this.metadata;
  }

  /**
   * Read the next chunk of bytes from the file.
   *
   * @param chunkSize - Maximum number of bytes to read.
   * @returns The chunk read, or null if EOF.
   */
  async readChunk(chunkSize: number): Promise<Uint8Array | null> {
    if (!this.handle || this.isComplete) return null;

    const remaining = this._fileSize - this._offset;
    const toRead = Math.min(chunkSize, remaining);
    const buffer = Buffer.alloc(toRead);

    const result = await this.handle.read(buffer, 0, toRead, this._offset);
    this._offset += result.bytesRead;

    if (result.bytesRead === 0) return null;

    // Return a view of exactly the bytes read
    return new Uint8Array(buffer.buffer, buffer.byteOffset, result.bytesRead);
  }

  /**
   * Close the file handle.
   */
  async close(): Promise<void> {
    if (this.handle) {
      const h = this.handle;
      this.handle = null;
      try {
        await h.close();
      } catch {
        // Already closed
      }
    }
  }
}
