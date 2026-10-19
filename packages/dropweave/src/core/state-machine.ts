/**
 * Session state machine with validated transitions.
 *
 * Defines which state transitions are legal and enforces them.
 * The same state machine is used by both client and signaling server.
 */

import { SessionState, TERMINAL_STATES } from './types.js';

// ---------------------------------------------------------------------------
// Transition Table
// ---------------------------------------------------------------------------

/**
 * Map of allowed transitions: from → Set<to>.
 * Any transition not in this map is illegal.
 */
const TRANSITIONS: ReadonlyMap<SessionState, ReadonlySet<SessionState>> =
  new Map<SessionState, ReadonlySet<SessionState>>([
    [
      SessionState.Waiting,
      new Set([
        SessionState.PeerRequested,
        SessionState.Expired,
        SessionState.Cancelled,
      ]),
    ],
    [
      SessionState.PeerRequested,
      new Set([
        SessionState.Approved,
        SessionState.Rejected,
        SessionState.Cancelled,
        SessionState.Expired,
      ]),
    ],
    [
      SessionState.Approved,
      new Set([
        SessionState.Negotiating,
        SessionState.Cancelled,
        SessionState.Failed,
      ]),
    ],
    [
      SessionState.Negotiating,
      new Set([
        SessionState.Connected,
        SessionState.Failed,
        SessionState.Cancelled,
      ]),
    ],
    [
      SessionState.Connected,
      new Set([
        SessionState.Transferring,
        SessionState.Failed,
        SessionState.Cancelled,
      ]),
    ],
    [
      SessionState.Transferring,
      new Set([
        SessionState.Completed,
        SessionState.Failed,
        SessionState.Cancelled,
      ]),
    ],
  ]);

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export class SessionStateMachine {
  private _state: SessionState;

  constructor(initialState: SessionState = SessionState.Waiting) {
    this._state = initialState;
  }

  /** Current state. */
  get state(): SessionState {
    return this._state;
  }

  /** Whether the session is in a terminal (final) state. */
  get isTerminal(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  /**
   * Check whether a transition to `next` is allowed from the current state.
   */
  canTransition(next: SessionState): boolean {
    if (this.isTerminal) return false;
    const allowed = TRANSITIONS.get(this._state);
    return allowed !== undefined && allowed.has(next);
  }

  /**
   * Transition to `next` state.
   *
   * @throws If the transition is illegal.
   */
  transition(next: SessionState): void {
    if (!this.canTransition(next)) {
      throw new Error(
        `Illegal session transition: ${this._state} → ${next}`,
      );
    }
    this._state = next;
  }

  /**
   * Force-transition to a terminal state without checking legality.
   * Useful for error/timeout paths that must terminate regardless of current state.
   *
   * @throws If `next` is not a terminal state.
   */
  forceTerminal(next: SessionState): void {
    if (!TERMINAL_STATES.has(next)) {
      throw new Error(
        `forceTerminal requires a terminal state, got: ${next}`,
      );
    }
    this._state = next;
  }
}
