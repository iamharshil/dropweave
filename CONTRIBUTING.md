# Contributing to Dropweave

Thank you for your interest in contributing to **Dropweave**! We welcome contributions from developers of all skill levels. Whether you are fixing a bug, improving documentation, adding new protocol features, or optimizing transfer performance, your help is appreciated.

---

## Code of Conduct

Dropweave has adopted the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating in this project, you agree to abide by its terms.

---

## Development Setup

Dropweave is structured as a monorepo managed with [Bun](https://bun.sh).

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- [Node.js](https://nodejs.org) (v18.20+ or v20+)
- Git

### 1. Clone the repository

```bash
git clone https://github.com/iamharshil/dropweave.git
cd dropweave
```

### 2. Install dependencies

```bash
bun install
```

### 3. Build the CLI package

```bash
bun run build
```

### 4. Run tests

Dropweave has comprehensive test coverage across unit, integration, and E2E layers:

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Type check all packages
bun run typecheck
```

---

## Project Structure

```
dropweave/
├── packages/
│   └── dropweave/           # Published npm package & CLI executable
│       ├── src/
│       │   ├── core/        # Binary protocol, state machine, Crockford Base32
│       │   ├── peer/        # WebRTC PeerConnection & WebSocket signaling client
│       │   ├── transfer/    # Chunker, backpressure, streaming SHA-256, packet tracker
│       │   ├── adapters/    # Node.js bounded streaming reader & atomic safe writer
│       │   └── cli/         # Commander subcommands (`send`, `receive`) & display
├── apps/
│   └── signaling-server/    # Zero-knowledge, zero-dependency Bun WebSocket server
├── tests/
│   ├── unit/                # Pure logic unit tests (protocol, hasher, chunker, etc.)
│   ├── integration/         # Signaling, small/large file transfers, cancellation
│   └── e2e/                 # Full node-to-node transfer over signaling & WebRTC
└── .github/
    └── workflows/           # Continuous Integration (CI)
```

---

## Core Engineering Principles

When contributing code, please keep Dropweave's foundational principles in mind:

1. **Zero-Knowledge Signaling**: Never store or log IP addresses, connection codes, or user identifiers on the signaling server. All state is held in ephemeral RAM and evicted on session close.
2. **Never Route File Bytes Through the Signaling Server**: File bytes travel strictly peer-to-peer over WebRTC data channels (or encrypted TURN relays when firewalls mandate).
3. **Bounded Memory**: Never load entire files into memory. Always stream chunk-by-chunk using backpressure and file handles.
4. **Defensive Path Handling**: Remote file names are untrusted input. Always sanitize paths to prevent directory traversal.
5. **Strict Typing**: All code must pass TypeScript `strict` type-checking (`bun run typecheck`) without errors or unwarranted `any` casts.

---

## Submitting Pull Requests

1. Fork the repository and create your feature branch from `main`:
   ```bash
   git checkout -b feature/amazing-feature
   ```
2. Commit your changes with clear, descriptive commit messages:
   ```bash
   git commit -m "feat(chunker): improve probe ramp-up under low RTT"
   ```
3. Ensure all tests and type checks pass:
   ```bash
   bun test
   bun run typecheck
   ```
4. Push to your fork:
   ```bash
   git push origin feature/amazing-feature
   ```
5. Open a Pull Request on GitHub. Be sure to link any related issues and provide a clear description of your changes.

---

## Reporting Issues

- **Bug Reports**: Open an issue using the Bug Report template. Please include Node/Bun versions, OS, reproducible steps, and terminal logs.
- **Security Vulnerabilities**: Please review our [Security Policy](SECURITY.md) before reporting security issues. Do not report security vulnerabilities via public GitHub issues.

---

## Questions?

Feel free to open an issue or discussion on GitHub. Thank you for making Dropweave faster, safer, and better! 🚀
