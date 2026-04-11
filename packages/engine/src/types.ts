// @pdt/engine — core type definitions.
//
// Two distinct family of types live here:
//
//   1. Runtime types — what the engine manipulates while playing matches.
//      These include the function-valued `DecisionFn` so they are NOT
//      JSON-serialisable. They are produced by compiling a `BotSpec`.
//
//   2. BotSpec / DSL types — the persistent JSON shape an author (preset
//      file, Claude compiler, or MCP-submitted bot) writes. Fully
//      JSON-serialisable. Validated against a JSON Schema before being
//      compiled to a `DecisionFn` by the interpreter.
//
// See docs/architecture.md §3 and §4.

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

/** A single move in a Prisoner's Dilemma round. */
export type Move = 'C' | 'D';

/** The outcome of a single round of a single match. */
export interface RoundResult {
  moveA: Move;
  moveB: Move;
  scoreA: number;
  scoreB: number;
}

/**
 * The only information a bot's decision function may see.
 *
 * History contains the *full* move-by-move record of the current match
 * from the bot's own perspective — nothing is hidden at the engine level.
 * The DSL primitives in §4.3 of architecture.md are derived projections
 * over this history.
 *
 * `rng` is a deterministic pseudo-random number generator seeded per
 * instance per match (§3.1) so randomness can never leak between bots
 * and matches remain reproducible from `(seed, instances, rounds)`.
 */
export interface BotView {
  selfInstanceId: string;
  opponentInstanceId: string;
  /** 0-indexed round number within the current match. */
  round: number;
  history: {
    readonly myMoves: readonly Move[];
    readonly theirMoves: readonly Move[];
  };
  rng: () => number;
}

/** Compiled bot decision function. Pure given a `BotView`. */
export type DecisionFn = (view: BotView) => Move;

/**
 * A runtime bot instance — the same `BotSpec` but with a unique
 * `instanceId` so multiple copies of the same bot (e.g. five TFTs) can
 * coexist in one tournament or arena run and be tracked independently.
 */
export interface BotInstance {
  /** Unique within a single tournament/arena run, e.g. "tft#1". */
  instanceId: string;
  /** Persistent reference to the stored `BotSpec`. */
  botId: string;
  spec: BotSpec;
  decide: DecisionFn;
}

/** The result of a single match between two bot instances. */
export interface MatchResult {
  matchId: string;
  instanceA: string;
  instanceB: string;
  rounds: RoundResult[];
  totalA: number;
  totalB: number;
  seed: number;
}

/** One row of a tournament leaderboard. */
export interface LeaderboardEntry {
  instanceId: string;
  botId: string;
  totalScore: number;
  matchesPlayed: number;
  averageScore: number;
  rank: number;
}

/** Result of a round-robin tournament (the *authoritative* one). */
export interface TournamentResult {
  mode: 'round-robin';
  matches: MatchResult[];
  leaderboard: LeaderboardEntry[];
  seed: number;
  roundsPerMatch: number;
  includeSelfPlay: boolean;
}

/** A single generation of an evolutionary tournament. */
export interface Generation {
  index: number;
  /** botId -> population share (or count if `preserveTotal`). */
  population: Record<string, number>;
  /** botId -> average score this generation. */
  fitness: Record<string, number>;
  leaderboard: LeaderboardEntry[];
}

/** Result of an evolutionary tournament. */
export interface EvolutionaryResult {
  mode: 'evolutionary';
  generations: Generation[];
  /** botId with the highest score in the first generation (classic Axelrod). */
  generation1Winner: string;
  /** botId with the largest population share at the end. */
  dominanceWinner: string;
  /** botIds that ever fell below the extinction threshold. */
  extinctEver: string[];
  seed: number;
  roundsPerMatch: number;
}

// ---------------------------------------------------------------------------
// BotSpec / DSL types
// ---------------------------------------------------------------------------
//
// The DSL is a *declarative* rule list. A bot is a sequence of `Rule`s; the
// interpreter walks them in order on each round and the first one whose
// `when` condition matches fires its `do` action. If none match, the
// `default` action is used. The `initial` action plays on round 0 before
// any history exists.
//
// Conditions are a tagged union — every variant has a `type` discriminator.
// This makes the DSL trivially validatable, trivially Claude-producible,
// and unambiguous to interpret.

/** Numeric comparison operator used by every numeric predicate. */
export type NumericOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';

/** Which side of a match a predicate refers to. */
export type Side = 'me' | 'opponent';

/**
 * Labels returned by the built-in `classifyOpponent` predicate.
 *
 * Frozen to the eight classical presets (architecture §4.3). Never
 * includes user-submitted bots — this is a deliberate design decision:
 * (a) keeps results reproducible as the bot library grows, and
 * (b) avoids a perverse incentive for authors to obscure their bot
 *     logic to fool other bots' classifiers.
 */
export type ClassifierLabel =
  | 'TFT'
  | 'TF2T'
  | 'ALLD'
  | 'ALLC'
  | 'RANDOM'
  | 'GRIM'
  | 'PAVLOV'
  | 'GENEROUS_TFT'
  | 'UNKNOWN';

/** A condition in the `when` clause of a rule. */
export type Condition =
  // ----- structural / combinators -----
  | { type: 'always' }
  | { type: 'and'; of: Condition[] }
  | { type: 'or'; of: Condition[] }
  | { type: 'not'; of: Condition }

  // ----- direct equality on the latest move -----
  | { type: 'opponentLastMove'; equals: Move }
  | { type: 'myLastMove'; equals: Move }

  // ----- pattern match on a trailing window -----
  | { type: 'patternInLastN'; side: Side; n: number; pattern: Move[] }

  // ----- the built-in opponent classifier (presets only) -----
  | { type: 'classifyOpponent'; equals: ClassifierLabel }

  // ----- numeric predicates: round counter -----
  | { type: 'round'; op: NumericOp; value: number }

  // ----- numeric predicates: scores -----
  | { type: 'myScore'; op: NumericOp; value: number }
  | { type: 'opponentScore'; op: NumericOp; value: number }

  // ----- numeric predicates: cooperation/defection rates (windowable) -----
  | { type: 'opponentDefectionRate'; op: NumericOp; value: number; window?: number }
  | { type: 'opponentCooperationRate'; op: NumericOp; value: number; window?: number }
  | { type: 'myDefectionRate'; op: NumericOp; value: number; window?: number }
  | { type: 'myCooperationRate'; op: NumericOp; value: number; window?: number }

  // ----- numeric predicates: streaks -----
  | { type: 'consecutiveDefections'; side: Side; op: NumericOp; value: number }
  | { type: 'consecutiveCooperations'; side: Side; op: NumericOp; value: number }
  | { type: 'longestRun'; side: Side; move: Move; op: NumericOp; value: number }

  // ----- numeric predicates: transition probabilities (Bayesian-lite) -----
  | { type: 'transitionProb'; from: Move; to: Move; op: NumericOp; value: number }
  | { type: 'myTransitionProb'; from: Move; to: Move; op: NumericOp; value: number }

  // ----- numeric predicate: a fresh draw from the seeded RNG -----
  | { type: 'random'; op: NumericOp; value: number };

/**
 * The action a rule (or `initial` / `default`) produces.
 *
 * Either a deterministic move or a stochastic choice with explicit
 * weights. Weights are unnormalised — the interpreter normalises them.
 */
export type Action =
  | { type: 'move'; move: Move }
  | { type: 'random'; weights: { C: number; D: number } };

/** A single rule in a `BotSpec`. The first matching rule wins. */
export interface Rule {
  /** Optional human-readable annotation; ignored by the interpreter. */
  comment?: string;
  when: Condition;
  do: Action;
}

/**
 * The persistent JSON shape of a bot.
 *
 * `kind: 'dsl'` is the only value accepted in v1. The discriminator is
 * present so a future code-tier (architecture §4.5, deferred) can be
 * added without a schema migration.
 */
export interface BotSpec {
  name: string;
  author?: string;
  /** Spec-format version. Bumped if the DSL grammar changes. */
  version: number;
  kind: 'dsl';
  /** Played on round 0 before any history exists. */
  initial: Action;
  rules: Rule[];
  /** Played when no rule's `when` matches the current round. */
  default: Action;
}
