// Interaction narration — explains *why* a bot played what it played.
//
// Given a bot's spec, the BotView at the time of the decision, and the
// move that was actually played, this module produces a short
// human-readable explanation suitable for a tooltip.
//
// It walks the DSL rules in the same order as the engine interpreter
// and finds the first matching rule, then translates the condition
// into natural language. This is a best-effort trace — for stochastic
// actions or `random` conditions the narration acknowledges randomness
// rather than trying to reproduce the exact RNG draw.

import type { Action, BotSpec, BotView, Condition, Move, NumericOp, Side } from '@pdt/engine';
import { PAYOFFS } from '@pdt/engine';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a one-sentence narration explaining why `botName` played `move`.
 */
export function narrateDecision(
  botName: string,
  spec: BotSpec,
  view: BotView,
  move: Move,
): string {
  const verb = move === 'C' ? 'cooperated' : 'defected';

  // Round 0: initial action.
  if (view.round === 0) {
    return `${botName} ${verb} (opening move).`;
  }

  // Walk rules to find the first match.
  for (const rule of spec.rules) {
    if (evaluateCondition(rule.when, view)) {
      const reason = rule.comment ?? conditionToEnglish(rule.when, view);
      return `${botName} ${verb} because ${reason}.`;
    }
  }

  // No rule matched → default action.
  return `${botName} ${verb} (default action).`;
}

// ---------------------------------------------------------------------------
// Condition evaluation (mirrors engine interpreter, minus RNG)
// ---------------------------------------------------------------------------

function evaluateCondition(cond: Condition, view: BotView): boolean {
  switch (cond.type) {
    case 'always': return true;
    case 'and': return cond.of.every((c) => evaluateCondition(c, view));
    case 'or': return cond.of.some((c) => evaluateCondition(c, view));
    case 'not': return !evaluateCondition(cond.of, view);
    case 'opponentLastMove': return last(view.history.theirMoves) === cond.equals;
    case 'myLastMove': return last(view.history.myMoves) === cond.equals;
    case 'round': return numOp(cond.op, view.round, cond.value);
    case 'random': return true; // Can't reproduce RNG; assume it matched.

    case 'patternInLastN': {
      const arr = cond.side === 'me' ? view.history.myMoves : view.history.theirMoves;
      if (arr.length < cond.n || cond.pattern.length !== cond.n) return false;
      const offset = arr.length - cond.n;
      for (let i = 0; i < cond.n; i++) {
        if (arr[offset + i] !== cond.pattern[i]) return false;
      }
      return true;
    }

    case 'classifyOpponent': return true; // Approximation — accept if we reach it.

    case 'opponentDefectionRate':
    case 'opponentCooperationRate':
    case 'myDefectionRate':
    case 'myCooperationRate': {
      const side: Side = cond.type.startsWith('opponent') ? 'opponent' : 'me';
      const arr = side === 'opponent' ? view.history.theirMoves : view.history.myMoves;
      const window = 'window' in cond ? cond.window : undefined;
      const start = window === undefined ? 0 : Math.max(0, arr.length - window);
      let d = 0;
      let total = 0;
      for (let i = start; i < arr.length; i++) {
        if (arr[i] === 'D') d++;
        total++;
      }
      const rate = total === 0 ? 0 : d / total;
      const actual = cond.type.includes('Cooperation') ? 1 - rate : rate;
      return numOp(cond.op, actual, cond.value);
    }

    case 'consecutiveDefections':
    case 'consecutiveCooperations': {
      const move: Move = cond.type === 'consecutiveDefections' ? 'D' : 'C';
      const arr = cond.side === 'me' ? view.history.myMoves : view.history.theirMoves;
      let count = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] === move) count++;
        else break;
      }
      return numOp(cond.op, count, cond.value);
    }

    case 'longestRun': {
      const arr = cond.side === 'me' ? view.history.myMoves : view.history.theirMoves;
      let best = 0, cur = 0;
      for (const m of arr) {
        if (m === cond.move) { cur++; if (cur > best) best = cur; }
        else cur = 0;
      }
      return numOp(cond.op, best, cond.value);
    }

    case 'transitionProb':
    case 'myTransitionProb': {
      const arr = cond.type === 'transitionProb' ? view.history.theirMoves : view.history.myMoves;
      if (arr.length < 2) return numOp(cond.op, 0, cond.value);
      let from = 0, to = 0;
      for (let i = 0; i < arr.length - 1; i++) {
        if (arr[i] === cond.from) { from++; if (arr[i + 1] === cond.to) to++; }
      }
      return numOp(cond.op, from === 0 ? 0 : to / from, cond.value);
    }

    case 'myScore':
    case 'opponentScore': {
      const scores = computeScores(view);
      const actual = cond.type === 'myScore' ? scores.me : scores.opp;
      return numOp(cond.op, actual, cond.value);
    }
  }
}

// ---------------------------------------------------------------------------
// Condition → natural language
// ---------------------------------------------------------------------------

function conditionToEnglish(cond: Condition, view: BotView): string {
  switch (cond.type) {
    case 'always':
      return 'that is its strategy';
    case 'opponentLastMove': {
      const moveWord = cond.equals === 'C' ? 'cooperated' : 'defected';
      return `opponent ${moveWord} last turn`;
    }
    case 'myLastMove': {
      const moveWord = cond.equals === 'C' ? 'cooperated' : 'defected';
      return `it ${moveWord} last turn`;
    }
    case 'round':
      return `it is round ${view.round}`;
    case 'random':
      return 'of a random decision';
    case 'classifyOpponent':
      return `opponent looks like ${cond.equals}`;
    case 'and':
      return cond.of.map((c) => conditionToEnglish(c, view)).join(' and ');
    case 'or':
      return cond.of.map((c) => conditionToEnglish(c, view)).join(' or ');
    case 'not':
      return `not (${conditionToEnglish(cond.of, view)})`;

    case 'opponentDefectionRate':
      return `opponent defection rate is ${opLabel(cond.op)} ${pct(cond.value)}`;
    case 'opponentCooperationRate':
      return `opponent cooperation rate is ${opLabel(cond.op)} ${pct(cond.value)}`;
    case 'myDefectionRate':
      return `its own defection rate is ${opLabel(cond.op)} ${pct(cond.value)}`;
    case 'myCooperationRate':
      return `its own cooperation rate is ${opLabel(cond.op)} ${pct(cond.value)}`;

    case 'consecutiveDefections':
      return `${sideLabel(cond.side)} consecutive defections ${opLabel(cond.op)} ${cond.value}`;
    case 'consecutiveCooperations':
      return `${sideLabel(cond.side)} consecutive cooperations ${opLabel(cond.op)} ${cond.value}`;
    case 'longestRun':
      return `${sideLabel(cond.side)} longest ${cond.move === 'C' ? 'cooperation' : 'defection'} run ${opLabel(cond.op)} ${cond.value}`;

    case 'patternInLastN':
      return `${sideLabel(cond.side)} last ${cond.n} moves were ${cond.pattern.join('')}`;

    case 'transitionProb':
      return `opponent ${cond.from}→${cond.to} probability is ${opLabel(cond.op)} ${pct(cond.value)}`;
    case 'myTransitionProb':
      return `its own ${cond.from}→${cond.to} probability is ${opLabel(cond.op)} ${pct(cond.value)}`;

    case 'myScore':
      return `its score is ${opLabel(cond.op)} ${cond.value}`;
    case 'opponentScore':
      return `opponent score is ${opLabel(cond.op)} ${cond.value}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numOp(op: NumericOp, a: number, b: number): boolean {
  switch (op) {
    case 'eq': return a === b;
    case 'neq': return a !== b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    case 'gt': return a > b;
    case 'gte': return a >= b;
  }
}

function opLabel(op: NumericOp): string {
  switch (op) {
    case 'eq': return 'exactly';
    case 'neq': return 'not';
    case 'lt': return 'below';
    case 'lte': return 'at most';
    case 'gt': return 'above';
    case 'gte': return 'at least';
  }
}

function sideLabel(side: Side): string {
  return side === 'me' ? "its own" : "opponent's";
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function last<T>(arr: readonly T[]): T | undefined {
  return arr.length === 0 ? undefined : arr[arr.length - 1];
}

function computeScores(view: BotView): { me: number; opp: number } {
  let me = 0, opp = 0;
  const len = Math.min(view.history.myMoves.length, view.history.theirMoves.length);
  for (let i = 0; i < len; i++) {
    const m = view.history.myMoves[i];
    const t = view.history.theirMoves[i];
    if (m === 'C' && t === 'C') { me += PAYOFFS.R; opp += PAYOFFS.R; }
    else if (m === 'D' && t === 'D') { me += PAYOFFS.P; opp += PAYOFFS.P; }
    else if (m === 'D' && t === 'C') { me += PAYOFFS.T; opp += PAYOFFS.S; }
    else { me += PAYOFFS.S; opp += PAYOFFS.T; }
  }
  return { me, opp };
}
