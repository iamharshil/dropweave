/**
 * `dropweave send` command.
 *
 * Opens a session → displays code → waits for peer → sends file → shows progress.
 */

import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { PeerConnectionWrapper } from '../peer/connection.js';
import { SignalingClient } from '../peer/signaling.js';
import { sendFile } from '../transfer/sender.js';
import type { SignalingMessage, IceServerConfig, TransferProgress } from '../core/types.js';
import { DEFAULT_ICE_SERVERS } from '../core/constants.js';
import {
  renderSessionBox,
  renderConnected,
  renderCompleted,
  renderError,
  writeProgress,
  clearProgress,
  formatBytes,
} from './display.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendCommandOptions {
  filePath: string;
  signalingUrl: string;
  timeout?: number;
  iceServers?: IceServerConfig[];
  quiet?: boolean;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function sendCommand(options: SendCommandOptions): Promise<void> {
  const {
    filePath,
    signalingUrl,
    timeout = 600,
    iceServers = DEFAULT_ICE_SERVERS,
    quiet = false,
  } = options;

  const resolvedPath = resolve(filePath);

  // Validate file exists
  try {
    const stats = await stat(resolvedPath);
    if (!stats.isFile()) {
      console.error(renderError(`Not a file: ${resolvedPath}`));
      process.exit(1);
    }
    if (!quiet) {
      console.log(`  Sending: ${filePath} (${formatBytes(stats.size)})`);
    }
  } catch {
    console.error(renderError(`File not found: ${filePath}`));
    process.exit(1);
  }

  // Connect to signaling server
  const signaling = new SignalingClient({ url: signalingUrl });
  let peer: PeerConnectionWrapper | null = null;

  try {
    await signaling.connect();

    // Create session
    signaling.send('session:create');
    const created = await signaling.waitFor('session:created', 10000);
    const code = (created.payload as { code: string }).code;
    const expiresIn = (created.payload as { expiresIn: number }).expiresIn;

    if (quiet) {
      // JSON mode for scripting
      console.log(JSON.stringify({ code, expiresIn }));
    } else {
      process.stdout.write(renderSessionBox(code, expiresIn));
    }

    // Wait for peer to join
    await signaling.waitFor('session:join-requested', timeout * 1000);

    // Auto-approve (anonymous 1:1 mode)
    signaling.send('session:approve', undefined, code);
    await signaling.waitFor('session:approved', 10000);

    if (!quiet) {
      clearProgress();
      process.stdout.write('  Connecting to peer...');
    }

    // Set up WebRTC
    peer = new PeerConnectionWrapper({ iceServers });

    // Set up signaling relay
    peer.on('local-description', (sdp, type) => {
      signaling.send('peer:offer', { sdp, type }, code);
    });

    peer.on('local-candidate', (candidate, mid) => {
      signaling.send('peer:ice-candidate', { candidate, mid }, code);
    });

    // Listen for remote signaling
    signaling.on('message', (msg: SignalingMessage) => {
      if (msg.type === 'peer:answer' && msg.payload) {
        peer!.setRemoteDescription(
          msg.payload.sdp as string,
          msg.payload.type as string,
        );
      } else if (msg.type === 'peer:ice-candidate' && msg.payload) {
        peer!.addRemoteCandidate(
          msg.payload.candidate as string,
          msg.payload.mid as string,
        );
      }
    });

    // Create data channel (triggers local-description generation)
    const dataChannel = peer.createDataChannel('transfer');

    // Wait for data channel to open
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Data channel open timeout'));
      }, 30000);

      dataChannel.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      dataChannel.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Detect connection mode
    const mode = peer.detectConnectionMode();
    if (!quiet) {
      clearProgress();
      process.stdout.write(renderConnected(mode));
    }

    // Send file
    const result = await sendFile({
      filePath: resolvedPath,
      dataChannel,
      onProgress: quiet ? undefined : (p: TransferProgress) => {
        writeProgress(p);
      },
    });

    if (!quiet) {
      clearProgress();
      process.stdout.write(
        renderCompleted(
          filePath,
          result.bytesTransferred,
          result.elapsed,
          result.verified,
        ),
      );
    } else {
      console.log(JSON.stringify(result));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (quiet) {
      console.error(JSON.stringify({ error: message }));
    } else {
      clearProgress();
      console.error(renderError(message));
    }
    process.exit(1);
  } finally {
    signaling.close();
    peer?.close();
  }
}
