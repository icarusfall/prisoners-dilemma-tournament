import { describe, it, expect } from 'vitest';
import { PAYOFFS, GAME_TYPES, scoreRound } from '../src/scoring.js';

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

  it('accepts custom payoffs for alternative game types', () => {
    const chicken = GAME_TYPES['chicken'].payoffs;
    // In Chicken, mutual defection (P=0) is the worst outcome.
    const dd = scoreRound('D', 'D', chicken);
    expect(dd.scoreA).toBe(0);
    expect(dd.scoreB).toBe(0);

    const stagHunt = GAME_TYPES['stag-hunt'].payoffs;
    // In Stag Hunt, R > T — mutual cooperation beats sole defection.
    const cc = scoreRound('C', 'C', stagHunt);
    const dc = scoreRound('D', 'C', stagHunt);
    expect(cc.scoreA).toBeGreaterThan(dc.scoreA);
  });

  it('all four game types have distinct payoff orderings', () => {
    const pd = GAME_TYPES['prisoners-dilemma'].payoffs;
    const ch = GAME_TYPES['chicken'].payoffs;
    const sh = GAME_TYPES['stag-hunt'].payoffs;
    const dl = GAME_TYPES['deadlock'].payoffs;

    // PD: T > R > P > S
    expect(pd.T > pd.R && pd.R > pd.P && pd.P > pd.S).toBe(true);
    // Chicken: T > R > S > P
    expect(ch.T > ch.R && ch.R > ch.S && ch.S > ch.P).toBe(true);
    // Stag Hunt: R > T > P > S
    expect(sh.R > sh.T && sh.T > sh.P && sh.P > sh.S).toBe(true);
    // Deadlock: T > P > R > S
    expect(dl.T > dl.P && dl.P > dl.R && dl.R > dl.S).toBe(true);
  });
});
