/**
 * Tests for the session state machine.
 */

import { describe, test, expect } from 'bun:test';
import { SessionStateMachine } from '../../packages/dropweave/src/core/state-machine';
import { SessionState } from '../../packages/dropweave/src/core/types';

describe('SessionStateMachine', () => {
  test('starts in Waiting state', () => {
    const sm = new SessionStateMachine();
    expect(sm.state).toBe(SessionState.Waiting);
    expect(sm.isTerminal).toBe(false);
  });

  test('follows happy path: waiting → completed', () => {
    const sm = new SessionStateMachine();

    sm.transition(SessionState.PeerRequested);
    expect(sm.state).toBe(SessionState.PeerRequested);

    sm.transition(SessionState.Approved);
    expect(sm.state).toBe(SessionState.Approved);

    sm.transition(SessionState.Negotiating);
    expect(sm.state).toBe(SessionState.Negotiating);

    sm.transition(SessionState.Connected);
    expect(sm.state).toBe(SessionState.Connected);

    sm.transition(SessionState.Transferring);
    expect(sm.state).toBe(SessionState.Transferring);

    sm.transition(SessionState.Completed);
    expect(sm.state).toBe(SessionState.Completed);
    expect(sm.isTerminal).toBe(true);
  });

  test('rejects illegal transitions', () => {
    const sm = new SessionStateMachine();
    expect(() => sm.transition(SessionState.Connected)).toThrow(
      'Illegal session transition',
    );
  });

  test('cannot transition from terminal state', () => {
    const sm = new SessionStateMachine();
    sm.transition(SessionState.Expired);
    expect(sm.isTerminal).toBe(true);

    expect(sm.canTransition(SessionState.PeerRequested)).toBe(false);
    expect(() => sm.transition(SessionState.PeerRequested)).toThrow();
  });

  test('waiting → expired', () => {
    const sm = new SessionStateMachine();
    sm.transition(SessionState.Expired);
    expect(sm.state).toBe(SessionState.Expired);
    expect(sm.isTerminal).toBe(true);
  });

  test('waiting → cancelled', () => {
    const sm = new SessionStateMachine();
    sm.transition(SessionState.Cancelled);
    expect(sm.state).toBe(SessionState.Cancelled);
    expect(sm.isTerminal).toBe(true);
  });

  test('peer-requested → rejected', () => {
    const sm = new SessionStateMachine();
    sm.transition(SessionState.PeerRequested);
    sm.transition(SessionState.Rejected);
    expect(sm.isTerminal).toBe(true);
  });

  test('negotiating → failed', () => {
    const sm = new SessionStateMachine();
    sm.transition(SessionState.PeerRequested);
    sm.transition(SessionState.Approved);
    sm.transition(SessionState.Negotiating);
    sm.transition(SessionState.Failed);
    expect(sm.isTerminal).toBe(true);
  });

  test('transferring → cancelled', () => {
    const sm = new SessionStateMachine();
    sm.transition(SessionState.PeerRequested);
    sm.transition(SessionState.Approved);
    sm.transition(SessionState.Negotiating);
    sm.transition(SessionState.Connected);
    sm.transition(SessionState.Transferring);
    sm.transition(SessionState.Cancelled);
    expect(sm.isTerminal).toBe(true);
  });

  test('forceTerminal works from any state', () => {
    const sm = new SessionStateMachine();
    sm.transition(SessionState.PeerRequested);
    sm.transition(SessionState.Approved);

    // Force to failed from approved (not a normal transition)
    sm.forceTerminal(SessionState.Failed);
    expect(sm.state).toBe(SessionState.Failed);
    expect(sm.isTerminal).toBe(true);
  });

  test('forceTerminal rejects non-terminal state', () => {
    const sm = new SessionStateMachine();
    expect(() => sm.forceTerminal(SessionState.Approved)).toThrow(
      'forceTerminal requires a terminal state',
    );
  });

  test('canTransition returns correct values', () => {
    const sm = new SessionStateMachine();
    expect(sm.canTransition(SessionState.PeerRequested)).toBe(true);
    expect(sm.canTransition(SessionState.Expired)).toBe(true);
    expect(sm.canTransition(SessionState.Cancelled)).toBe(true);
    expect(sm.canTransition(SessionState.Approved)).toBe(false);
    expect(sm.canTransition(SessionState.Connected)).toBe(false);
  });
});
