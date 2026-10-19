/**
 * Safe file writer for received files.
 *
 * Prevents path traversal, validates destination, and writes chunks
 * to a temporary file before renaming on completion (atomic finalization).
 */

import { open, rename, unlink, stat, mkdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Path Safety
// ---------------------------------------------------------------------------

/**
 * Sanitize a remote file name to prevent path traversal.
 * Strips all directory components and dangerous characters.
 */
export function sanitizeFileName(remoteName: string): string {
  // Take only the basename (strip any directory components)
  let safe = basename(remoteName);

  // Remove null bytes and other control characters
  safe = safe.replace(/[\x00-\x1f\x7f]/g, '');

  // Remove leading dots (hidden files)
  safe = safe.replace(/^\.+/, '');

  // Remove dangerous characters for cross-platform safety
  safe = safe.replace(/[<>:"|?*\\]/g, '_');

  // Fallback if nothing is left
  if (safe.length === 0) {
    safe = 'received_file';
  }

  // Truncate to reasonable length
  if (safe.length > 200) {
    const ext = safe.slice(safe.lastIndexOf('.'));
    safe = safe.slice(0, 200 - ext.length) + ext;
  }

  return safe;
}

// ---------------------------------------------------------------------------
// File Writer
// ---------------------------------------------------------------------------

export class FileWriter {
  private handle: FileHandle | null = null;
  private tempPath: string = '';
  private finalPath: string = '';
  private _bytesWritten = 0;

  /** Total bytes written so far. */
  get bytesWritten(): number {
    return this._bytesWritten;
  }

  /** The final path where the file will be saved. */
  get outputPath(): string {
    return this.finalPath;
  }

  /**
   * Prepare to receive a file.
   *
   * @param outputDir - Directory to save the file in (must exist or be creatable).
   * @param remoteName - The file name from the sender (will be sanitized).
   * @returns The sanitized file name and final path.
   */
  async prepare(
    outputDir: string,
    remoteName: string,
  ): Promise<{ fileName: string; path: string }> {
    const sanitized = sanitizeFileName(remoteName);

    // Ensure output directory exists
    const resolvedDir = resolve(outputDir);
    await mkdir(resolvedDir, { recursive: true });

    // Determine final path, avoid overwrites
    this.finalPath = await this.uniquePath(resolvedDir, sanitized);
    this.tempPath = this.finalPath + '.dwpart';

    // Open temp file for writing
    this.handle = await open(this.tempPath, 'w');
    this._bytesWritten = 0;

    return {
      fileName: basename(this.finalPath),
      path: this.finalPath,
    };
  }

  /**
   * Write a chunk of data to the temporary file.
   */
  async writeChunk(data: Uint8Array): Promise<void> {
    if (!this.handle) {
      throw new Error('FileWriter not prepared');
    }

    await this.handle.write(data, 0, data.byteLength);
    this._bytesWritten += data.byteLength;
  }

  /**
   * Finalize the file: close the handle and rename temp → final.
   * Call this only after integrity verification succeeds.
   */
  async finalize(): Promise<string> {
    if (!this.handle) {
      throw new Error('FileWriter not prepared');
    }

    const h = this.handle;
    this.handle = null;
    await h.close();

    // Atomic rename
    await rename(this.tempPath, this.finalPath);

    return this.finalPath;
  }

  /**
   * Abort the write: close and delete the temporary file.
   */
  async abort(): Promise<void> {
    if (this.handle) {
      const h = this.handle;
      this.handle = null;
      try {
        await h.close();
      } catch {
        // Already closed
      }
    }

    if (this.tempPath) {
      try {
        await unlink(this.tempPath);
      } catch {
        // File may not exist
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Generate a unique file path, appending (1), (2), etc. if the file exists.
   */
  private async uniquePath(dir: string, name: string): Promise<string> {
    let candidate = join(dir, name);

    // Verify the candidate is still inside dir (prevent traversal)
    if (!resolve(candidate).startsWith(resolve(dir))) {
      throw new Error(`Path traversal detected: ${name}`);
    }

    let exists = false;
    try {
      await stat(candidate);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) return candidate;

    // Append counter
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    const base = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;

    for (let i = 1; i < 1000; i++) {
      candidate = join(dir, `${base} (${i})${ext}`);
      try {
        await stat(candidate);
      } catch {
        return candidate;
      }
    }

    throw new Error(`Cannot find unique filename for: ${name}`);
  }
}
