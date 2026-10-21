/**
 * CLI progress display — interactive, animated, Unix-friendly.
 *
 * Renders miniature wire animations for peer transfers, animated beacons
 * while waiting for pairing, and smooth status spinners.
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
// Miniature Transfer Animation & Progress Bar
// ---------------------------------------------------------------------------

const BAR_WIDTH = 18;
const WIRE_LENGTH = 10;
const FILLED = '█';
const EMPTY = '░';

let transferFrame = 0;

/** Reset the progress wire animation frame */
export function resetProgressAnimation(): void {
  transferFrame = 0;
}

export function renderProgressBar(progress: TransferProgress): string {
  const pct = Math.min(100, Math.max(0, progress.percentage));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;

  const bar = FILLED.repeat(filled) + EMPTY.repeat(empty);
  const pctStr = `${pct.toFixed(0)}%`.padStart(4);
  const speed = formatSpeed(progress.speed);
  const eta = progress.eta !== null ? formatTime(progress.eta) : '--:--';

  // Miniature wire animation: packet moves smoothly between sender and receiver
  transferFrame++;
  const pos = pct >= 100 ? WIRE_LENGTH - 1 : (transferFrame % WIRE_LENGTH);
  const wireBefore = '─'.repeat(pos);
  const wireAfter = '─'.repeat(WIRE_LENGTH - 1 - pos);
  const wire = `📤 ${wireBefore}📦${wireAfter}► 📥`;

  return `  ${wire}  ${bar} ${pctStr}  ${speed.padStart(9)}  ${eta} remaining`;
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
// Peer Waiting Animation (Beacon / Miniature Pulse)
// ---------------------------------------------------------------------------

export class PeerWaitingAnimation {
  private timer: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private frame: number = 0;
  private readonly expiresIn: number;

  constructor(expiresIn: number) {
    this.expiresIn = expiresIn;
  }

  start(): void {
    if (!process.stdout.isTTY) {
      process.stdout.write('  Waiting for peer...\n');
      return;
    }
    this.startTime = Date.now();
    this.frame = 0;
    this.render();
    this.timer = setInterval(() => {
      this.frame++;
      this.render();
    }, 90);
  }

  private render(): void {
    const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
    const remaining = Math.max(0, this.expiresIn - elapsedSec);
    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][this.frame % 10];
    const pulsePositions = 7;
    const pulseIdx = this.frame % pulsePositions;
    const pulseDots = Array(pulsePositions).fill('·');
    pulseDots[pulseIdx] = '●';
    const pulseStr = pulseDots.join(' ');

    const line = `  ${spinner} Waiting for peer...  📡 ${pulseStr} 📥  (${formatTime(remaining)})`;
    process.stdout.write(`\r${line}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stdout.isTTY) {
      clearProgress();
    }
  }
}

// ---------------------------------------------------------------------------
// Spinner Animation (Generic Connecting / Status)
// ---------------------------------------------------------------------------

export class SpinnerAnimation {
  private timer: NodeJS.Timeout | null = null;
  private frame: number = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): void {
    if (!process.stdout.isTTY) {
      process.stdout.write(`  ${this.text}\n`);
      return;
    }
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.render(frames[0]);
    this.timer = setInterval(() => {
      this.frame++;
      this.render(frames[this.frame % frames.length]);
    }, 80);
  }

  private render(spinner: string): void {
    process.stdout.write(`\r  ${spinner} ${this.text}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stdout.isTTY) {
      clearProgress();
    }
  }
}

// ---------------------------------------------------------------------------
// Status Box & Results
// ---------------------------------------------------------------------------

export function renderSessionBox(code: string, expiresIn: number): string {
  const formattedCode = code.length === 8
    ? `${code.slice(0, 4)}-${code.slice(4)}`
    : code;

  const lines = [
    '',
    '  ┌──────────────────────────────────────────────┐',
    `  │  Code: ${formattedCode.padEnd(38)}│`,
    `  │  Expires in: ${formatTime(expiresIn).padEnd(32)}│`,
    '  └──────────────────────────────────────────────┘',
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
