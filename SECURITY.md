# Security Policy

Dropweave is designed from the ground up with **anonymity, privacy, and zero-knowledge transfer** as core product values. We take security vulnerabilities seriously and appreciate the responsible disclosure of security issues.

---

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

---

## Reporting a Vulnerability

If you discover a security vulnerability in Dropweave:

**Please DO NOT open a public GitHub issue.**

Instead, please send an encrypted or direct disclosure report to the maintainers:
- **Email**: [security@dropweave.dev](mailto:security@dropweave.dev) or via GitHub Private Vulnerability Reporting on the repository.

Please include:
1. Description of the vulnerability and its potential impact.
2. Step-by-step reproduction instructions or a minimal proof of concept.
3. Affected components (`packages/dropweave`, `apps/signaling-server`, etc.).
4. Suggested remediation if available.

We will acknowledge receipt of your report within 48 hours and work with you on a resolution and coordinated disclosure timeline.

---

## Threat Model & Security Design

### 1. Peer-to-Peer Encryption
File transfer occurs over WebRTC Data Channels using DTLS (Datagram Transport Layer Security) with SCTP.
- WebRTC traffic is encrypted end-to-end between peers.
- Even if traffic passes through a TURN relay, the relay only sees encrypted packets.

### 2. Zero-Knowledge Signaling
- The signaling server **never** receives, handles, relays, or stores file chunks.
- Session codes are held in memory only, without persistence to disk or databases.
- The server does not store IP addresses or connection logs. Rate limiting is scoped per WebSocket connection in RAM and immediately garbage-collected upon disconnect.

### 3. File System Protection
- **No Path Traversal**: Peer-supplied file names are strictly sanitized. Any directory delimiters (`../`, `..\`), null bytes, and dangerous characters are stripped.
- **Atomic Writing**: Chunks are written to a temporary `.dwpart` file. The final file is created atomically only after the cryptographic SHA-256 hash has been validated. Incomplete or failed transfers are unlinked immediately.
- **No Automatic Execution**: Received files are never executed automatically by the CLI.

### 4. Code Entropy and Expiration
- Connection codes are generated using cryptographically secure random bytes (`crypto.randomBytes` / CSPRNG) formatted with Crockford Base32 (40 bits of entropy).
- Codes expire automatically after a short configurable duration (default: 10 minutes) and are single-use for 1:1 pairing.
- Repeated failed guesses are rate-limited with cooldown locks to prevent enumeration.
