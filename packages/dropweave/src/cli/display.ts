/**
 * CLI progress display — minimal, fast, Unix-style.
 *
 * Renders a progress bar with speed and ETA to stdout.
 * No heavy TUI dependencies.
 */

import type { TransferProgress } from '../core/types.js';

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Progress Bar Renderer
// ---------------------------------------------------------------------------

const BAR_WIDTH = 24;
const FILLED = '█';
const EMPTY = '░';

export function renderProgressBar(progress: TransferProgress): string {
  const pct = Math.min(100, Math.max(0, progress.percentage));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;

  const bar = FILLED.repeat(filled) + EMPTY.repeat(empty);
  const pctStr = `${pct.toFixed(0)}%`.padStart(4);
  const speed = formatSpeed(progress.speed);
  const eta = progress.eta !== null ? formatTime(progress.eta) : '--:--';

  return `  ${bar} ${pctStr}  ${speed.padStart(10)}  ${eta} remaining`;
}

/**
 * Write progress to stdout with carriage return (overwrites the line).
 */
export function writeProgress(progress: TransferProgress): void {
  const line = renderProgressBar(progress);
  process.stdout.write(`\r${line}`);
}

/**
 * Clear the progress line.
 */
export function clearProgress(): void {
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
}

// ---------------------------------------------------------------------------
// Status Box
// ---------------------------------------------------------------------------

export function renderSessionBox(code: string, expiresIn: number): string {
  const formattedCode = code.length === 8
    ? `${code.slice(0, 4)}-${code.slice(4)}`
    : code;

  const lines = [
    '',
    '  ┌──────────────────────────────────────┐',
    `  │  Code: ${formattedCode.padEnd(29)}│`,
    `  │  Expires in: ${formatTime(expiresIn).padEnd(23)}│`,
    '  │  Waiting for peer...                 │',
    '  └──────────────────────────────────────┘',
    '',
  ];

  return lines.join('\n');
}

export function renderConnected(mode: string): string {
  const icon = mode === 'direct' ? '⚡' : '🔄';
  return `\n  ✓ Peer connected (${mode}) ${icon}\n`;
}

export function renderCompleted(
  fileName: string,
  size: number,
  elapsed: number,
  verified: boolean,
): string {
  const icon = verified ? '✓' : '✗';
  const status = verified ? 'verified' : 'UNVERIFIED';
  const avgSpeed = formatSpeed(size / (elapsed / 1000));

  return [
    '',
    `  ${icon} Transfer complete`,
    `    File: ${fileName}`,
    `    Size: ${formatBytes(size)}`,
    `    Time: ${formatTime(elapsed / 1000)}`,
    `    Speed: ${avgSpeed} (average)`,
    `    Integrity: ${status}`,
    '',
  ].join('\n');
}

export function renderError(message: string): string {
  return `\n  ✗ Error: ${message}\n`;
}
