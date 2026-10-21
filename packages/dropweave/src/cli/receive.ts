/**
 * `dropweave receive` command.
 *
 * Joins a session with a code → receives file → verifies → saves.
 */

import { resolve } from 'node:path';
import { PeerConnectionWrapper, DataChannelWrapper } from '../peer/connection.js';
import { SignalingClient } from '../peer/signaling.js';
import { receiveFile } from '../transfer/receiver.js';
import type { SignalingMessage, IceServerConfig, TransferProgress } from '../core/types.js';
import { DEFAULT_ICE_SERVERS } from '../core/constants.js';
import { normalizeCode, isValidCode, formatCode } from '../core/code-gen.js';
import {
  renderConnected,
  renderCompleted,
  renderError,
  writeProgress,
  clearProgress,
  SpinnerAnimation,
  resetProgressAnimation,
} from './display.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReceiveCommandOptions {
  code: string;
  signalingUrl: string;
  outputDir?: string;
  iceServers?: IceServerConfig[];
  quiet?: boolean;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function receiveCommand(options: ReceiveCommandOptions): Promise<void> {
  const {
    code: rawCode,
    signalingUrl,
    outputDir = '.',
    iceServers = DEFAULT_ICE_SERVERS,
    quiet = false,
  } = options;

  // Normalize and validate code
  const code = normalizeCode(rawCode);
  if (!isValidCode(code)) {
    console.error(renderError(`Invalid code: ${rawCode}`));
    process.exit(1);
  }

  if (!quiet) {
    console.log(`  Joining session: ${formatCode(code)}`);
  }

  const resolvedOutputDir = resolve(outputDir);
  const signaling = new SignalingClient({ url: signalingUrl });
  signaling.on('error', () => {
    // Handled via promise rejection and try/catch
  });
  let peer: PeerConnectionWrapper | null = null;

  try {
    await signaling.connect();

    // Set up WebRTC (responder side)
    peer = new PeerConnectionWrapper({ iceServers });

    // Listen for incoming data channel (responder gets it via onDataChannel)
    const dataChannelPromise = new Promise<DataChannelWrapper>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Data channel timeout'));
      }, 30000);

      peer!.on('data-channel', (dc: DataChannelWrapper) => {
        if (dc.isOpen) {
          clearTimeout(timeout);
          resolve(dc);
          return;
        }

        dc.on('open', () => {
          clearTimeout(timeout);
          resolve(dc);
        });

        dc.on('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    // Set up signaling relay
    peer.on('local-description', (sdp, type) => {
      signaling.send('peer:answer', { sdp, type }, code);
    });

    peer.on('local-candidate', (candidate, mid) => {
      signaling.send('peer:ice-candidate', { candidate, mid }, code);
    });

    // Listen for remote signaling (registered before joining to ensure no messages are missed)
    signaling.on('message', (msg: SignalingMessage) => {
      if (msg.type === 'peer:offer' && msg.payload) {
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

    let connectingAnim: SpinnerAnimation | null = null;
    if (!quiet) {
      connectingAnim = new SpinnerAnimation(`Connecting to session ${formatCode(code)}...`);
      connectingAnim.start();
    }

    try {
      // Join session
      signaling.send('session:join', { code }, code);

      // Wait for approval
      await signaling.waitFor('session:approved', 30000);

      connectingAnim?.stop();
      if (!quiet) {
        connectingAnim = new SpinnerAnimation('Session approved. Opening data channel...');
        connectingAnim.start();
      }

      // Wait for data channel
      const dataChannel = await dataChannelPromise;

      connectingAnim?.stop();
      connectingAnim = null;

      // Detect connection mode
      const mode = peer.detectConnectionMode();
      if (!quiet) {
        process.stdout.write(renderConnected(mode));
        resetProgressAnimation();
      }

      // Receive file
      const result = await receiveFile({
        dataChannel,
        outputDir: resolvedOutputDir,
        autoAccept: true,
        onProgress: quiet ? undefined : (p: TransferProgress) => {
          writeProgress(p);
        },
      });

      if (!quiet) {
        clearProgress();
        process.stdout.write(
          renderCompleted(
            result.fileName,
            result.bytesReceived,
            result.elapsed,
            result.verified,
          ),
        );
        console.log(`  Saved to: ${result.filePath}`);
      } else {
        console.log(JSON.stringify(result));
      }
    } finally {
      connectingAnim?.stop();
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
