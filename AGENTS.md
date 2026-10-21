# AGENTS.md --- Direct Peer-to-Peer File Transfer NPM Package

## 1. Project Goal

Build a developer-friendly TypeScript npm package that lets two devices
transfer files directly between each other.

The package must support:

-   Node.js ↔ Node.js
-   Browser ↔ browser
-   Node.js ↔ browser
-   Devices on different networks over the internet
-   A simple **8-character connection code** used to join an open
    transfer session
-   Large-file transfers without loading the entire file into memory
-   Transfer progress, cancellation, integrity verification, and safe
    connection handling

The core product principle is:

> File bytes should travel directly between peers whenever possible. The
> signaling service helps peers find and connect to each other; it must
> not upload, store, or relay file contents. A TURN server may relay
> encrypted traffic when a direct connection cannot be established.

Do not promise that every internet connection can be direct. Some NATs,
firewalls, VPNs, and corporate networks prevent direct peer-to-peer
connectivity.

## 2. Core Architecture

### Peer connection

Use **WebRTC data channels** as the common transport for browser and
Node.js peers. This avoids maintaining separate file-transfer protocols
for browsers and Node.js.

WebRTC provides encrypted data transport and can send arbitrary binary
data. Browsers have built-in WebRTC APIs. Node.js requires a compatible
WebRTC implementation; evaluate installation requirements, native
dependencies, supported operating systems, and maintenance before
selecting one.

### Signaling service

A small WebSocket signaling service is needed for convenient
internet-wide pairing. It exchanges connection setup messages, including
WebRTC offers, answers, and ICE candidates.

The signaling service must not receive or store file chunks. It should
only handle pairing and connection negotiation, then allow peers to
communicate directly when possible.

### STUN and TURN

-   **STUN** helps a peer discover its public-facing network address and
    attempt a direct connection.
-   **TURN** relays encrypted WebRTC traffic when a direct connection
    cannot be established.
-   Configure STUN for connection establishment and support TURN as a
    fallback for reliability.
-   A TURN relay is not a file-storage backend, but it does carry
    traffic and therefore has bandwidth and operating costs.

### High-level flow

1.  Device A starts an open transfer session.
2.  The client obtains an 8-character connection code and displays it to
    the user.
3.  Device B enters the code to request to join.
4.  The signaling service validates the code and pairs the two peers.
5.  The peers exchange WebRTC signaling messages.
6.  ICE attempts to establish connectivity, using STUN and TURN
    configuration as needed.
7.  Once the data channel is open, the peers transfer file data directly
    over it or through a TURN relay if required.
8.  The receiving peer verifies the completed file and reports success.

## 3. The 8-Character Connection Code

The user-facing connection flow is a core product requirement.

### Expected behavior

-   A host opens a session and receives a code such as `7KMP-4Q9D` or an
    8-character equivalent without punctuation.
-   A joining peer must enter that code to request a connection.
-   The code identifies a **temporary session**, not a permanent network
    or device identity.
-   A code must not be reused indefinitely.
-   Expire codes after a configurable short period; begin with 10
    minutes as a default.
-   Invalidate the code when the host closes the session, the session
    expires, or the session is consumed if the design permits only one
    joining peer.
-   The host must explicitly approve a joining peer before file transfer
    begins.
-   Limit guesses and connection attempts by IP/session, and apply a
    cooldown or temporary lock after repeated failures.
-   Do not expose whether a code is valid in ways that make large-scale
    code enumeration easy.
-   Generate codes using a cryptographically secure random source, never
    `Math.random()`.
-   Use an alphabet that avoids ambiguous characters where practical
    (for example, Crockford Base32-style characters). Normalize user
    input consistently, including case and optional separators.
-   Store only the minimum session state needed by the signaling
    service. Do not log codes, secrets, file names, or file contents
    unnecessarily.
-   A short code is a pairing convenience, not a replacement for
    transport encryption or user consent. The code has limited entropy,
    so expiry, rate limiting, approval, and abuse controls are required.

### Suggested session states

`waiting` → `peer-requested` → `approved` → `negotiating` → `connected`
→ `transferring` → `completed`

Other terminal states include `rejected`, `expired`, `cancelled`, and
`failed`.

### Multiple peers

For the first release, prefer **one host and one joining peer per
code**. This keeps consent, transfer state, and error handling simple.
Design internal interfaces so multi-peer sessions could be added later,
but do not implement multi-peer broadcasting in the MVP.

## 4. File Transfer Protocol

### Transfer metadata

Before sending bytes, peers should exchange validated metadata such as:

-   Transfer ID
-   Safe display name
-   File size
-   MIME type, when available
-   Chunk size / protocol version
-   Optional checksum strategy

Do not trust peer-supplied file names or paths. On Node.js, prevent path
traversal and never write to arbitrary paths supplied by a remote peer.
The receiving application or user should choose or approve the
destination.

### Chunking and memory

-   Transfer files as chunks rather than a single giant message.
-   Start with a configurable chunk size, for example 64 KiB, and
    benchmark before changing it.
-   Respect WebRTC data-channel buffering limits.
-   Implement backpressure: pause sending when the channel's buffered
    amount is high, and resume when it falls below a low-water
    threshold.
-   Do not read an entire large Node.js file into memory. Use Node.js
    streams or bounded reads.
-   In browsers, use supported file/blob APIs and bounded chunks. Be
    mindful that browser save APIs differ by browser and environment.
-   Define maximum file size and resource limits as configurable policy,
    not as an assumed universal capability.

### Integrity and progress

-   Track bytes sent and received, total bytes, percentage, elapsed
    time, and transfer state.
-   Verify integrity after completion. Prefer a well-defined
    cryptographic checksum such as SHA-256 where practical.
-   Mark a transfer completed only after the receiver has
    written/assembled the file and verified it.
-   Handle disconnects, cancellation, timeouts, and partial transfers
    explicitly.
-   Resume support is a later enhancement; do not imply that transfers
    automatically resume unless it has been implemented and tested.

### Data channel behavior

-   Use a reliable, ordered data channel for the initial implementation.
-   Negotiate or document protocol limits and version messages.
-   Separate control messages (metadata, acknowledgements, cancellation,
    progress) from binary file chunks, either through a documented
    message envelope or separate channels.
-   Validate message sizes, types, sequence numbers, and state
    transitions.

## 5. Security and Privacy

-   Rely on WebRTC's transport encryption, but do not treat encryption
    alone as proof of peer identity.
-   Require host approval before accepting a peer or incoming file.
-   Show the peer's connection status and file metadata before transfer.
-   Never automatically execute received files.
-   Never write remote file names directly as filesystem paths.
-   Apply code expiry, secure randomness, rate limits, connection
    limits, message validation, and abuse controls.
-   Use HTTPS/WSS for the hosted signaling service.
-   Avoid logging connection codes, candidate details, sensitive
    metadata, or file data unless strictly necessary for debugging;
    redact sensitive fields.
-   Clearly explain when a TURN relay may carry encrypted transfer
    traffic.
-   Treat incoming files as untrusted content.
-   Add tests for invalid codes, expired codes, repeated guesses,
    oversized metadata, malformed messages, path traversal attempts,
    cancellation, and unauthorized transfer attempts.

## 6. Proposed Repository Layout

Start as one repository. A monorepo layout is useful, but do not split
into many published packages before the API is stable.

``` text
fastdrop/
├── packages/
│   └── fastdrop/
│       ├── src/
│       │   ├── core/             # Protocol, state machine, shared types
│       │   ├── peer/             # Peer connection abstraction
│       │   ├── transfer/         # Chunking, progress, integrity, backpressure
│       │   ├── adapters/
│       │   │   ├── browser/      # Browser file APIs and WebRTC
│       │   │   └── node/         # Node.js file streams and WebRTC adapter
│       │   └── index.ts
│       └── package.json
├── apps/
│   └── signaling-server/
│       └── src/
│           ├── sessions/
│           ├── websocket/
│           ├── rate-limit/
│           └── index.ts
├── examples/
│   ├── browser-to-browser/
│   ├── node-to-node/
│   └── browser-to-node/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── cross-platform/
├── README.md
├── AGENTS.md
├── package.json
└── tsconfig.json
```

Keep the signaling service independently deployable. The npm package
should allow users to configure the signaling endpoint and ICE servers
rather than hard-coding a single provider.

## 7. Public API Direction

The API should be small and promise-based. Treat the following as a
direction to refine through implementation and tests, not as a finalized
API contract.

``` ts
const transfer = createTransfer({
  signalingUrl: "wss://signal.example.com",
  iceServers: [
    { urls: "stun:stun.example.com:3478" },
    // Configure TURN credentials through a secure, short-lived mechanism.
  ],
});

// Host: create a temporary session and display its 8-character code.
const session = await transfer.openSession();

// Join: enter the host's code.
await transfer.joinSession({ code: "7KMP4Q9D" });

// Host must approve the peer before file transfer begins.
await transfer.acceptPeer();

// Send a Node.js file or browser File through platform-specific adapters.
await transfer.send(file);

// Receive events such as peer requests, progress, completion, and errors.
transfer.on("progress", (event) => {
  // event contains transferId, bytesTransferred, totalBytes, and percentage
});

// Clean up connections and resources.
await transfer.close();
```

Refine this API to suit the actual runtime and implementation. Do not
claim that this sample is executable until its methods, event types, and
platform-specific file handling exist.

The browser API should accept browser-native file objects and integrate
with browser-supported save/download behavior. The Node.js API should
support safe file-path or stream-based sending and an explicitly
selected receive destination.

## 8. Signaling Protocol Direction

Use a versioned, validated message protocol. Example message categories:

-   `session:create`
-   `session:created` --- returns the connection code and expiry
-   `session:join`
-   `session:join-requested` --- delivered to the host for approval
-   `session:approve`
-   `session:reject`
-   `peer:offer`
-   `peer:answer`
-   `peer:ice-candidate`
-   `session:close`
-   `session:error`

The server should verify that a message sender belongs to the session
and is allowed to perform the requested action. Do not blindly relay
arbitrary messages between clients.

Store session state in memory for the simplest single-instance MVP. If
deploying multiple signaling instances or requiring persistence across
restarts, introduce a shared store and coordination mechanism. Never
store file contents in this service.

## 9. Development Roadmap

Build in this order, and keep each stage runnable and testable.

### Stage 1 --- Local proof of concept

-   Choose and validate a Node.js WebRTC implementation.
-   Establish a WebRTC data channel between two test peers.
-   Exchange a short text message.
-   Use manually exchanged signaling data initially.
-   Document native dependencies and supported platforms.

### Stage 2 --- Small file transfer

-   Send a small binary file in chunks.
-   Reconstruct the file on the receiving side.
-   Add a checksum test.
-   Confirm that large files are not read fully into memory.

### Stage 3 --- Browser support

-   Implement browser WebRTC and file adapters.
-   Verify browser-to-browser and browser-to-Node.js transfers.
-   Test receiving/saving files using supported browser APIs.

### Stage 4 --- Eight-character pairing

-   Build the WebSocket signaling service.
-   Generate secure, expiring, single-session codes.
-   Add join requests and explicit host approval.
-   Validate authorization for every signaling message.
-   Add rate limiting and abuse protection.

### Stage 5 --- Internet connectivity

-   Configure STUN.
-   Add TURN fallback and secure, temporary TURN credentials.
-   Test different Wi-Fi networks, mobile hotspots, VPNs, and
    restrictive NAT/firewall conditions.
-   Report whether a connection is direct or relayed when that
    information can be determined reliably.

### Stage 6 --- Production hardening

-   Add progress, cancellation, timeout handling, backpressure, checksum
    verification, and cleanup.
-   Add unit, integration, and cross-platform tests.
-   Benchmark transfer speeds and memory use.
-   Document signaling/TURN deployment, bandwidth costs, supported
    runtimes, and limitations.
-   Add reconnection and resumable transfers only after the basic
    protocol is reliable.

## 10. Definition of Done for the MVP

The MVP is complete only when all of these work:

-   A host can open a session and display an 8-character code.
-   A second peer must provide the code to request entry.
-   The host can approve or reject that peer.
-   Expired, invalid, and repeatedly guessed codes are handled safely.
-   Node.js ↔ Node.js, browser ↔ browser, and Node.js ↔ browser
    transfers work.
-   Devices on different networks can connect when network conditions
    and configured STUN/TURN infrastructure allow it.
-   File bytes do not pass through the signaling service.
-   A TURN relay can be used when direct connectivity fails.
-   Large files transfer with bounded memory and backpressure.
-   The receiver can verify file integrity and report completion
    accurately.
-   Cancellation, disconnects, and malformed messages do not crash the
    application.
-   Documentation clearly explains that the signaling service is
    required for convenient code-based pairing and that TURN may relay
    encrypted traffic.

## 11. Engineering Rules for AI Agents and Contributors

-   Use TypeScript with strict compiler settings.
-   Keep browser-only APIs out of shared core modules.
-   Keep Node.js-only modules out of browser bundles.
-   Define shared types and protocol messages in one place.
-   Prefer small, testable modules and explicit state transitions.
-   Do not invent methods or mark incomplete features as implemented.
-   Do not introduce a database unless a real requirement needs it.
-   Never route file bytes through the signaling server.
-   Never promise direct connectivity for every network.
-   Test cross-platform behavior rather than assuming browser and
    Node.js WebRTC implementations behave identically.
-   Update the README and tests whenever the public API or protocol
    changes.
-   Prioritize a working vertical slice over speculative features.

## 12. Release and Publishing Operations (npm & GitHub)

### Package & Registry Metadata

-   **npm Package**: [`dropweave`](https://www.npmjs.com/package/dropweave) (unscoped, public).
-   **Package Location**: [`packages/dropweave/`](file:///Users/harsh/development/dropweave/packages/dropweave).
-   **CLI Binary Entry**: `"bin": { "dropweave": "./dist/cli/index.js" }`.
    *Note: The leading `./` is mandatory; npm's normalization will drop the binary script without it.*
-   **Build & Pre-publish Hook**: `"prepublishOnly": "bun run build"` ensures `dist/` is always compiled fresh before packaging.
-   **Tarball Whitelist**: Governed by `"files": ["dist", "README.md", "LICENSE"]` in `packages/dropweave/package.json`.

### Automated CI/CD Publishing Pipeline

The GitHub Actions workflow [`.github/workflows/ci.yml`](file:///Users/harsh/development/dropweave/.github/workflows/ci.yml) automates testing and publishing:

1.  **Test Matrix**: Runs `bun test`, `bun run typecheck`, and `bun run build` across **Node.js 18.x, 20.x, 22.x** and **Bun**.
2.  **Gatekeeper**: Publishing is blocked if any test fails or if the commit is on a non-main pull request.
3.  **Smart Version Detection**:
    -   Compares the local `package.json` version against the latest version on `https://registry.npmjs.org/dropweave`.
    -   If a new version is detected, it runs `npm publish --provenance` using the `NPM_TOKEN` repository secret and GitHub OIDC token.
    -   If the version matches the published registry version, publishing is skipped safely.

### Standard Release Workflow for Future Agents

To release a new version of Dropweave:

1.  **Bump Versions**:
    -   Update `"version"` in [`packages/dropweave/package.json`](file:///Users/harsh/development/dropweave/packages/dropweave/package.json).
    -   Update `"version"` in root [`package.json`](file:///Users/harsh/development/dropweave/package.json).
    -   Update `VERSION` constant in [`packages/dropweave/src/core/constants.ts`](file:///Users/harsh/development/dropweave/packages/dropweave/src/core/constants.ts).
2.  **Verify & Build**:
    ```bash
    bun run build
    bun test tests/unit
    cd packages/dropweave && npm pack --dry-run
    ```
3.  **Branch & PR**:
    -   Create a branch: `git checkout -b release/vX.Y.Z`
    -   Commit: `git commit -m "chore(release): bump version to vX.Y.Z"`
    -   Push and create PR: `gh pr create`
    -   Merge to `main`: `gh pr merge --squash --delete-branch`
4.  **Create Git Tag and GitHub Release**:
    ```bash
    git tag -a vX.Y.Z <commit-hash> -m "vX.Y.Z"
    git push origin --tags
    gh release create vX.Y.Z --title "vX.Y.Z - <Release Title>" --notes "<Release Notes>"
    ```
5.  **Direct Manual Publish (Fallback)**:
    If publishing manually from the CLI:
    ```bash
    cd packages/dropweave
    # If 2FA OTP is required:
    npm publish --otp=<code>
    # If an automation/granular token is set:
    npm publish
    ```

### Release History & Log

-   **`v1.0.0`**: Initial release. Anonymous peer-to-peer file transfer CLI over WebRTC data channels with zero-knowledge WebSocket signaling, adaptive chunking (16–256 KiB), backpressure flow control, and streaming SHA-256 verification.
-   **`v1.0.1`**: Fixed npm binary script path (`./dist/cli/index.js`), added immediate rejection on `session:error` to eliminate 30-second signaling hangs, added `DROPWEAVE_SIGNALING_URL` environment variable support, added `--no-stun` documentation, updated READMEs with beginner-friendly guides, and established GitHub Releases.

### Security Rules for Release Operations

-   **Never commit, hardcode, or display tokens**: All npm access tokens must be stored only in GitHub Secrets (`NPM_TOKEN`) or local user config (`~/.npmrc`). Never commit them to the repository or log them in outputs.
-   **Never inspect `.env` files**: Adhere to user and system privacy rules.
-   **Sync READMEs**: Always keep root [`README.md`](file:///Users/harsh/development/dropweave/README.md) and [`packages/dropweave/README.md`](file:///Users/harsh/development/dropweave/packages/dropweave/README.md) identical so npmjs.com and GitHub render the same documentation.

