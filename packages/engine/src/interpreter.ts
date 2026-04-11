// DSL interpreter — turns a `BotSpec` into a deterministic `DecisionFn`.
//
// On each call, the compiled function:
//   1. If round 0 (no history), play `spec.initial` unconditionally.
//   2. Build a lazily-memoised stats cache for the current view.
//   3. Walk `spec.rules` in order; the first rule whose `when` condition
//      evaluates to true fires its `do` action and returns.
//   4. If no rule matches, play `spec.default`.
//
// All numerical statistics (defection rates, transition probabilities,
// streak lengths, classifier label) are computed lazily on first access
// and cached per call so repeated references in the same round are free.
// This keeps the interpreter both expressive and cheap.
//
// See architecture.md §4 for the design rationale and §4.3 for the
// primitive list this interpreter must support.

import type {
  Action,
  BotSpec,
  BotView,
  ClassifierLabel,
  Condition,
  DecisionFn,
  Move,
  NumericOp,
  Side,
} from './types.js';
import { PAYOFFS } from './scoring.js';

/**
 * Compile a `BotSpec` into a deterministic `DecisionFn`.
 *
 * The returned function is pure given a `BotView`: same view in, same
 * move out. Randomness is supplied via `view.rng`, which the engine
 * seeds per-instance per-match so matches are reproducible.
 */
export function compile(spec: BotSpec): DecisionFn {
  return (view: BotView): Move => {
    if (view.round === 0) {
      return executeAction(spec.initial, view.rng);
    }

    const stats = makeStatsCache(view);

    for (const rule of spec.rules) {
      if (evaluateCondition(rule.when, view, stats)) {
        return executeAction(rule.do, view.rng);
      }
    }

    return executeAction(spec.default, view.rng);
  };
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

function executeAction(action: Action, rng: () => number): Move {
  if (action.type === 'move') return action.move;
  // Stochastic: weights are unnormalised; we normalise on the fly.
  const total = action.weights.C + action.weights.D;
  if (total <= 0) return 'C';
  return rng() * total < action.weights.C ? 'C' : 'D';
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(cond: Condition, view: BotView, stats: StatsCache): boolean {
  switch (cond.type) {
    case 'always':
      return true;
    case 'and':
      return cond.of.every((c) => evaluateCondition(c, view, stats));
    case 'or':
      return cond.of.some((c) => evaluateCondition(c, view, stats));
    case 'not':
      return !evaluateCondition(cond.of, view, stats);

    case 'opponentLastMove':
      return last(view.history.theirMoves) === cond.equals;
    case 'myLastMove':
      return last(view.history.myMoves) === cond.equals;

    case 'patternInLastN': {
      if (cond.pattern.length !== cond.n) return false;
      const arr = cond.side === 'me' ? view.history.myMoves : view.history.theirMoves;
      if (arr.length < cond.n) return false;
      const offset = arr.length - cond.n;
      for (let i = 0; i < cond.n; i++) {
        if (arr[offset + i] !== cond.pattern[i]) return false;
      }
      return true;
    }

    case 'classifyOpponent':
      return stats.classifyOpponent() === cond.equals;

    case 'round':
      return numericOp(cond.op, view.round, cond.value);

    case 'myScore':
      return numericOp(cond.op, stats.scores().me, cond.value);
    case 'opponentScore':
      return numericOp(cond.op, stats.scores().opponent, cond.value);

    case 'opponentDefectionRate':
      return numericOp(cond.op, stats.defectionRate('opponent', cond.window), cond.value);
    case 'opponentCooperationRate':
      return numericOp(cond.op, 1 - stats.defectionRate('opponent', cond.window), cond.value);
    case 'myDefectionRate':
      return numericOp(cond.op, stats.defectionRate('me', cond.window), cond.value);
    case 'myCooperationRate':
      return numericOp(cond.op, 1 - stats.defectionRate('me', cond.window), cond.value);

    case 'consecutiveDefections':
      return numericOp(cond.op, stats.consecutive(cond.side, 'D'), cond.value);
    case 'consecutiveCooperations':
      return numericOp(cond.op, stats.consecutive(cond.side, 'C'), cond.value);
    case 'longestRun':
      return numericOp(cond.op, stats.longestRun(cond.side, cond.move), cond.value);

    case 'transitionProb':
      return numericOp(
        cond.op,
        stats.transitionProb('opponent', cond.from, cond.to),
        cond.value,
      );
    case 'myTransitionProb':
      return numericOp(cond.op, stats.transitionProb('me', cond.from, cond.to), cond.value);

    case 'random':
      return numericOp(cond.op, view.rng(), cond.value);
  }
}

function numericOp(op: NumericOp, a: number, b: number): boolean {
  switch (op) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
  }
}

// ---------------------------------------------------------------------------
// Lazily-memoised stats cache
// ---------------------------------------------------------------------------

interface StatsCache {
  defectionRate(side: Side, window?: number): number;
  consecutive(side: Side, move: Move): number;
  longestRun(side: Side, move: Move): number;
  transitionProb(side: Side, from: Move, to: Move): number;
  classifyOpponent(): ClassifierLabel;
  scores(): { me: number; opponent: number };
}

function makeStatsCache(view: BotView): StatsCache {
  const cache = new Map<string, unknown>();
  const memo = <T>(key: string, fn: () => T): T => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key) as T;
  };

  const movesFor = (side: Side): readonly Move[] =>
    side === 'me' ? view.history.myMoves : view.history.theirMoves;

  return {
    defectionRate(side, window) {
      const key = `defectionRate:${side}:${window ?? 'all'}`;
      return memo(key, () => {
        const arr = movesFor(side);
        if (arr.length === 0) return 0;
        const start = window === undefined ? 0 : Math.max(0, arr.length - window);
        let defections = 0;
        let total = 0;
        for (let i = start; i < arr.length; i++) {
          if (arr[i] === 'D') defections++;
          total++;
        }
        return total === 0 ? 0 : defections / total;
      });
    },

    consecutive(side, move) {
      return memo(`consecutive:${side}:${move}`, () => {
        const arr = movesFor(side);
        let count = 0;
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] === move) count++;
          else break;
        }
        return count;
      });
    },

    longestRun(side, move) {
      return memo(`longestRun:${side}:${move}`, () => {
        const arr = movesFor(side);
        let best = 0;
        let current = 0;
        for (const m of arr) {
          if (m === move) {
            current++;
            if (current > best) best = current;
          } else {
            current = 0;
          }
        }
        return best;
      });
    },

    transitionProb(side, from, to) {
      return memo(`transitionProb:${side}:${from}:${to}`, () => {
        const arr = movesFor(side);
        if (arr.length < 2) return 0;
        let fromCount = 0;
        let toCount = 0;
        for (let i = 0; i < arr.length - 1; i++) {
          if (arr[i] === from) {
            fromCount++;
            if (arr[i + 1] === to) toCount++;
          }
        }
        return fromCount === 0 ? 0 : toCount / fromCount;
      });
    },

    classifyOpponent() {
      return memo('classifyOpponent', () => classifyOpponentImpl(view));
    },

    scores() {
      return memo('scores', () => {
        const mine = view.history.myMoves;
        const theirs = view.history.theirMoves;
        let myScore = 0;
        let theirScore = 0;
        const len = Math.min(mine.length, theirs.length);
        for (let i = 0; i < len; i++) {
          const m = mine[i];
          const t = theirs[i];
          if (m === 'C' && t === 'C') {
            myScore += PAYOFFS.R;
            theirScore += PAYOFFS.R;
          } else if (m === 'D' && t === 'D') {
            myScore += PAYOFFS.P;
            theirScore += PAYOFFS.P;
          } else if (m === 'D' && t === 'C') {
            myScore += PAYOFFS.T;
            theirScore += PAYOFFS.S;
          } else {
            myScore += PAYOFFS.S;
            theirScore += PAYOFFS.T;
          }
        }
        return { me: myScore, opponent: theirScore };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// classifyOpponent — frozen to the eight classical presets
// ---------------------------------------------------------------------------
//
// Compares the opponent's observed history against canonical preset
// signatures with high-confidence thresholds. Returns the first match.
// Returns 'UNKNOWN' if fewer than 5 rounds have been observed or if no
// signature matches confidently.
//
// User-submitted bots are NEVER considered (architecture §4.3): the
// label set is fixed and reproducible no matter how the bot library
// grows. This function only sees the *opponent's* moves and the bot's
// own moves; it has no access to any spec, name, or identity.

const CLASSIFY_MIN_ROUNDS = 5;
const CLASSIFY_THRESHOLD = 0.95;

function classifyOpponentImpl(view: BotView): ClassifierLabel {
  const theirs = view.history.theirMoves;
  const mine = view.history.myMoves;
  if (theirs.length < CLASSIFY_MIN_ROUNDS) return 'UNKNOWN';

  const dr = countMatching(theirs, 'D') / theirs.length;
  const cr = 1 - dr;

  // Pure strategies first.
  if (dr >= CLASSIFY_THRESHOLD) return 'ALLD';
  if (cr >= CLASSIFY_THRESHOLD) return 'ALLC';

  // GRIM: cooperated until first defection, then defected ever after.
  // Requires at least one defection (else it would have been classified
  // ALLC above) and a non-trivial cooperation prefix.
  const firstD = theirs.indexOf('D');
  if (firstD > 0) {
    let allDAfter = true;
    for (let i = firstD; i < theirs.length; i++) {
      if (theirs[i] !== 'D') {
        allDAfter = false;
        break;
      }
    }
    if (allDAfter) return 'GRIM';
  }

  // Reactive strategies — need to look at how the opponent responds to
  // *my* moves. We compare each of their moves (from round 1 onwards)
  // against the move predicted by each canonical reactive strategy.

  let tftMatches = 0;
  let gtftMatches = 0;
  let pavlovMatches = 0;
  let tf2tMatches = 0;
  let reactiveTotal = 0;

  for (let i = 1; i < theirs.length; i++) {
    const myPrev = mine[i - 1];
    const theirPrev = theirs[i - 1];
    const theirNow = theirs[i];

    // TFT: copy my previous move.
    if (theirNow === myPrev) tftMatches++;

    // GENEROUS_TFT: like TFT but cooperates after my D about 10% of
    // the time. We accept the move as a GTFT prediction if it matches
    // TFT *or* if it cooperates after my D.
    if (theirNow === myPrev || (myPrev === 'D' && theirNow === 'C')) {
      gtftMatches++;
    }

    // PAVLOV (win-stay, lose-shift): "win" for them is when they got
    // R or T (i.e. I cooperated). After a win they should stay; after
    // a loss they should switch.
    const theyWon = myPrev === 'C';
    const expectedPavlov: Move = theyWon ? theirPrev : theirPrev === 'C' ? 'D' : 'C';
    if (theirNow === expectedPavlov) pavlovMatches++;

    reactiveTotal++;

    // TF2T: cooperate unless I defected on each of the previous two
    // rounds. Needs i >= 2.
    if (i >= 2) {
      const myPrevPrev = mine[i - 2];
      const expectedTf2t: Move = myPrev === 'D' && myPrevPrev === 'D' ? 'D' : 'C';
      if (theirNow === expectedTf2t) tf2tMatches++;
    }
  }

  if (reactiveTotal === 0) return 'UNKNOWN';

  const tftRate = tftMatches / reactiveTotal;
  const gtftRate = gtftMatches / reactiveTotal;
  const pavlovRate = pavlovMatches / reactiveTotal;
  const tf2tDenom = Math.max(0, theirs.length - 2);
  const tf2tRate = tf2tDenom === 0 ? 0 : tf2tMatches / tf2tDenom;

  // TFT is the strictest of the reactive strategies — try it first.
  if (tftRate >= CLASSIFY_THRESHOLD) return 'TFT';

  // GTFT: looser than TFT but should *not* match TFT exactly (else
  // we'd already have classified it TFT above). We require it to
  // strictly tolerate the occasional forgiveness.
  if (gtftRate >= CLASSIFY_THRESHOLD && tftRate < CLASSIFY_THRESHOLD) {
    return 'GENEROUS_TFT';
  }

  if (pavlovRate >= CLASSIFY_THRESHOLD) return 'PAVLOV';
  if (tf2tRate >= CLASSIFY_THRESHOLD) return 'TF2T';

  // RANDOM: defection rate roughly balanced and no strategy fits.
  if (dr >= 0.35 && dr <= 0.65) return 'RANDOM';

  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function last<T>(arr: readonly T[]): T | undefined {
  return arr.length === 0 ? undefined : arr[arr.length - 1];
}

function countMatching<T>(arr: readonly T[], v: T): number {
  let n = 0;
  for (const x of arr) if (x === v) n++;
  return n;
}
