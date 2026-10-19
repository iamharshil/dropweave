# 🌐 Dropweave

> **Anonymous, zero-knowledge, peer-to-peer file transfer CLI.**  
> One command to send. One 8-character code to receive. No accounts, no cloud storage, no trace.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.4+-black.svg)](https://bun.sh/)
[![WebRTC](https://img.shields.io/badge/WebRTC-node--datachannel-orange.svg)](https://github.com/murat-dogan/node-datachannel)

---

## ⚡ Highlights

- 🔒 **Direct Peer-to-Peer**: File bytes travel directly between devices over encrypted WebRTC data channels.
- 👁️ **Zero-Knowledge Signaling**: The signaling server only pairs peers using temporary in-memory connection codes. It never touches, caches, or inspects file data. No IP addresses or logs are stored.
- 🔑 **8-Character Pairing Codes**: Crockford Base32 codes (`7KMP-4Q9D`) with unambiguous characters, auto-normalization, and automatic expiration.
- 🚀 **Adaptive Chunk Sizing**: Automatically tunes chunk size between 16 KiB and 256 KiB based on real-time RTT and throughput measurements.
- 🌊 **Backpressure Flow Control**: High/low watermark data channel buffer control prevents memory bloat even when transferring gigabyte files.
- 🛡️ **Streaming SHA-256 Verification**: File integrity is hashed incrementally as chunks are read and written. Transfers are marked complete only after the receiver verifies the cryptographic checksum.
- 🖥️ **Scriptable & Unix-Friendly**: Includes a `--quiet` flag for JSON output in automation pipelines.

---

## 📦 Installation

```bash
# Via npm
npm install -g dropweave

# Via bun
bun add -g dropweave
```

---

## 🚀 Quick Start

### 1. Send a File

```bash
dropweave send ./presentation.zip
```

Output:
```text
  Sending: ./presentation.zip (18.4 MB)

  ┌──────────────────────────────────────┐
  │  Code: 7KMP-4Q9D                     │
  │  Expires in: 10:00                   │
  │  Waiting for peer...                 │
  └──────────────────────────────────────┘

  ✓ Peer connected (direct)
  ████████████████████░░░░  78%  12.4 MB/s  00:03 remaining
```

### 2. Receive a File

On any other machine:

```bash
dropweave receive 7KMP4Q9D
```

Output:
```text
  Joining session: 7KMP-4Q9D
  Session approved. Connecting...
  ✓ Peer connected (direct)
  ████████████████████████  100%  14.1 MB/s  00:00 remaining

  ✓ Complete: presentation.zip (18.4 MB in 1.3s) [verified]
  Saved to: /Users/alice/Downloads/presentation.zip
```

---

## ⚙️ CLI Options

### `dropweave send <file>`

```text
Usage: dropweave send [options] <file>

Send a file to a peer

Arguments:
  file                     Path to the file to send

Options:
  -s, --signal <url>       Signaling server URL (default: "ws://localhost:8080/ws")
  -t, --timeout <seconds>  Session timeout in seconds (default: "600")
  -q, --quiet              Quiet mode — JSON output only (default: false)
  -h, --help               Display help for command
```

### `dropweave receive <code>`

```text
Usage: dropweave receive [options] <code>

Receive a file from a peer

Arguments:
  code                The 8-character session code (hyphens and casing ignored)

Options:
  -s, --signal <url>  Signaling server URL (default: "ws://localhost:8080/ws")
  -o, --output <dir>  Output directory to save file (default: ".")
  -q, --quiet         Quiet mode — JSON output only (default: false)
  -h, --help          Display help for command
```

---

## 🧩 Programmatic API

Dropweave can also be used as a TypeScript library:

```typescript
import {
  SignalingClient,
  PeerConnectionWrapper,
  sendFile,
  receiveFile,
} from 'dropweave';

// Sender:
const sendResult = await sendFile({
  filePath: './data.zip',
  dataChannel,
  onProgress: (p) => {
    console.log(`${p.percentage}% - ${p.speed} bytes/sec`);
  },
});
console.log(`Transfer complete. Verified: ${sendResult.verified}`);

// Receiver:
const receiveResult = await receiveFile({
  dataChannel,
  outputDir: './downloads',
  autoAccept: true,
  onProgress: (p) => {
    console.log(`${p.percentage}% - ETA: ${p.eta}s`);
  },
});
console.log(`Saved file to: ${receiveResult.filePath}`);
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│       Sender (dropweave)        │                 │      Receiver (dropweave)       │
│                                 │                 │                                 │
│  ┌────────────┐ ┌─────────────┐ │                 │  ┌─────────────┐ ┌────────────┐ │
│  │FileReader  │ │Adaptive     │ │                 │  │FileWriter   │ │Integrity   │ │
│  │(streaming) │ │Chunker      │ │                 │  │(safe write) │ │(SHA-256)   │ │
│  └─────┬──────┘ └──────┬──────┘ │                 │  └──────▲──────┘ └─────▲──────┘ │
│        │               │        │                 │         │              │        │
│        ▼               ▼        │                 │         │              │        │
│  ┌────────────────────────────┐ │  Signaling WSS  │  ┌────────────────────────────┐ │
│  │    PeerConnectionWrapper   ├─┼────────┬────────┼─►│    PeerConnectionWrapper   │ │
│  └─────────────┬──────────────┘ │        │        │  └──────────────┬─────────────┘ │
└────────────────┼────────────────┘        │        └─────────────────┼───────────────┘
                 │                         ▼                          │
                 │              ┌──────────────────────┐              │
                 │              │   Signaling Server   │              │
                 │              │   • Ephemeral state  │              │
                 │              │   • Zero knowledge   │              │
                 │              │   • No IPs or logs   │              │
                 │              └──────────────────────┘              │
                 │                                                    │
                 └────────────── WebRTC DataChannel ──────────────────┘
                               (Direct P2P Encrypted)
```

### Binary Packet Protocol

File data is transferred using a compact 12-byte binary envelope over WebRTC SCTP data channels:

```
┌───────────┬──────────┬───────────┬──────────┬──────────────┬──────────────────┐
│ Magic(2B) │ Type(1B) │ Flags(1B) │ Seq (4B) │ PayloadLen4B │ Payload (var)    │
│   0xDW    │  Chunk   │ None/Last │  uint32  │    uint32    │ Binary file byte │
└───────────┴──────────┴───────────┴──────────┴──────────────┴──────────────────┘
```

- **Sequence Tracking**: Every packet carries a monotonic sequence ID for latency and throughput measurement.
- **Adaptive Sizing**: Probes network capacity and scales chunk sizes dynamically between 16 KiB and 256 KiB.
- **Backpressure**: Prevents data channel buffer overflow with watermarks.

---

## 🛡️ Security & Anonymity Model

- **No File Relay**: File contents never touch the signaling server or third-party servers.
- **Ephemeral State**: Session pairings are held strictly in server RAM and permanently evicted immediately upon completion, expiration, or disconnect.
- **No IP Logging**: The signaling service associates rate limiting with WebSocket connections rather than tracking IP addresses.
- **Path Traversal Protection**: File names received over the wire are stripped of directory paths, null bytes, and dangerous characters.
- **Atomic Writes**: Incoming files are written to `.dwpart` temporary files and atomically renamed only after cryptographic SHA-256 verification succeeds. Incomplete or rejected transfers are unlinked automatically.

---

## 🖥️ Running Your Own Signaling Server

You can self-host the zero-dependency signaling server using Bun:

```bash
# Clone the repository
git clone https://github.com/harsh/dropweave.git
cd dropweave

# Start server
PORT=8080 bun run dev:signal
```

Or deploy as a Docker container or standalone Node.js process.

---

## 🧪 Testing

The repository includes a comprehensive test suite (unit, integration, and E2E):

```bash
# Run all tests
bun test

# Run type check
bun run typecheck
```

---

## 📄 License

MIT © Harsh
