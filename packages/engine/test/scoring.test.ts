import { describe, it, expect } from 'vitest';
import { PAYOFFS, scoreRound } from '../src/scoring.js';

describe('scoring', () => {
  it('mutual cooperation pays R to both', () => {
    const r = scoreRound('C', 'C');
    expect(r).toEqual({ moveA: 'C', moveB: 'C', scoreA: PAYOFFS.R, scoreB: PAYOFFS.R });
  });

  it('mutual defection pays P to both', () => {
    const r = scoreRound('D', 'D');
    expect(r).toEqual({ moveA: 'D', moveB: 'D', scoreA: PAYOFFS.P, scoreB: PAYOFFS.P });
  });

  it('sole defector gets T, sole cooperator gets S', () => {
    expect(scoreRound('D', 'C')).toEqual({
      moveA: 'D',
      moveB: 'C',
      scoreA: PAYOFFS.T,
      scoreB: PAYOFFS.S,
    });
    expect(scoreRound('C', 'D')).toEqual({
      moveA: 'C',
      moveB: 'D',
      scoreA: PAYOFFS.S,
      scoreB: PAYOFFS.T,
    });
  });

  it('payoffs satisfy the iterated-PD inequalities', () => {
    const { T, R, P, S } = PAYOFFS;
    // T > R > P > S — defection is always individually tempting
    expect(T).toBeGreaterThan(R);
    expect(R).toBeGreaterThan(P);
    expect(P).toBeGreaterThan(S);
    // 2R > T + S — mutual cooperation beats alternating exploitation
    expect(2 * R).toBeGreaterThan(T + S);
  });
});
