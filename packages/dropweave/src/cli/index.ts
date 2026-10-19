#!/usr/bin/env node

/**
 * dropweave CLI entry point.
 *
 * Usage:
 *   dropweave send <file>          # Host a session, print the code
 *   dropweave receive <code>       # Join with a code, download the file
 */

import { Command } from 'commander';
import { sendCommand } from './send.js';
import { receiveCommand } from './receive.js';

const DEFAULT_SIGNALING_URL = 'ws://localhost:8080/ws';

const program = new Command();

program
  .name('dropweave')
  .description('Anonymous peer-to-peer file transfer. Zero-knowledge. Direct connection.')
  .version('1.0.0');

program
  .command('send')
  .description('Send a file to a peer')
  .argument('<file>', 'Path to the file to send')
  .option('-s, --signal <url>', 'Signaling server URL', DEFAULT_SIGNALING_URL)
  .option('-t, --timeout <seconds>', 'Session timeout in seconds', '600')
  .option('-q, --quiet', 'Quiet mode — JSON output only', false)
  .action(async (file: string, opts: { signal: string; timeout: string; quiet: boolean }) => {
    await sendCommand({
      filePath: file,
      signalingUrl: opts.signal,
      timeout: parseInt(opts.timeout, 10),
      quiet: opts.quiet,
    });
  });

program
  .command('receive')
  .description('Receive a file from a peer')
  .argument('<code>', 'The 8-character session code')
  .option('-s, --signal <url>', 'Signaling server URL', DEFAULT_SIGNALING_URL)
  .option('-o, --output <dir>', 'Output directory', '.')
  .option('-q, --quiet', 'Quiet mode — JSON output only', false)
  .action(async (code: string, opts: { signal: string; output: string; quiet: boolean }) => {
    await receiveCommand({
      code,
      signalingUrl: opts.signal,
      outputDir: opts.output,
      quiet: opts.quiet,
    });
  });

program.parse();
