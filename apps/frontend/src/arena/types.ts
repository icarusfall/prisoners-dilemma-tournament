// Arena-specific type definitions and constants.
//
// The arena is a client-side-only simulation that uses the same engine
// as the backend tournament runner but pairs bots via spatial collision
// on a Mapbox map rather than exhaustive round-robin.

import type { BotSpec, DecisionFn, Move } from '@pdt/engine';

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

/** Metres — two bots closer than this trigger a round. */
export const COLLISION_RADIUS = 30;

/** Milliseconds before the same pair can interact again. */
export const COOLDOWN_MS = 2000;

/** Base movement speed in metres per second. */
export const DEFAULT_SPEED = 15;

/** How often a bot picks a new wander target (ms). */
export const WANDER_INTERVAL_MS = 3000;

/** Duration of a cooperate/defect flash (ms). */
export const FLASH_DURATION_MS = 400;

/** Milliseconds between simulation ticks in auto-demo mode. */
export const DEMO_TICK_MS = 100;

/** Normal-speed tick interval (ms). */
export const NORMAL_TICK_MS = 50;

/** Duration the interaction line stays visible (ms). */
export const LINE_DURATION_MS = 3000;

// ---------------------------------------------------------------------
// Visual state
// ---------------------------------------------------------------------

export type VisualState = 'idle' | 'cooperate' | 'defect' | 'zombie';

// ---------------------------------------------------------------------
// Arena bot
// ---------------------------------------------------------------------

export interface ArenaBot {
  instanceId: string;
  botId: string;
  name: string;
  spec: BotSpec;
  decide: DecisionFn;

  // Spatial
  lng: number;
  lat: number;
  vx: number;
  vy: number;
  /** Sprite variant index (0-based, indexes into the sprite gallery). */
  spriteVariant: number;

  // State
  score: number;
  visualState: VisualState;
  /** Timestamp when the current flash expires (0 = idle). */
  flashUntil: number;
  isZombie: boolean;

  // Wander
  /** Target position for lazy velocity retargeting. */
  wanderTarget: { lng: number; lat: number };
  /** Timestamp of last wander retarget. */
  lastWanderChange: number;
}

// ---------------------------------------------------------------------
// Pair tracking
// ---------------------------------------------------------------------

/** Canonical key for a pair of bots, always sorted. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface PairState {
  /** Per-pair match history from A's perspective (sorted order). */
  movesA: Move[];
  /** Per-pair match history from B's perspective (sorted order). */
  movesB: Move[];
  /** Timestamp of last interaction. */
  lastInteraction: number;
  /** Per-pair RNG seed (derived from the pair key). */
  seed: number;
}

// ---------------------------------------------------------------------
// Arena events (fed to the caption narrator)
// ---------------------------------------------------------------------

export type ArenaEvent =
  | { type: 'interaction'; aId: string; bId: string; moveA: Move; moveB: Move; scoreA: number; scoreB: number; narrationA: string; narrationB: string }
  | { type: 'first_defection'; botId: string; againstId: string }
  | { type: 'leader_change'; newLeader: string; score: number }
  | { type: 'first_meeting'; aId: string; bId: string };

// ---------------------------------------------------------------------
// Arena config (overridable for custom runs)
// ---------------------------------------------------------------------

export interface ArenaConfig {
  collisionRadius: number;
  cooldownMs: number;
  speed: number;
  wanderIntervalMs: number;
  flashDurationMs: number;
  tickMs: number;
}

export const DEFAULT_CONFIG: ArenaConfig = {
  collisionRadius: COLLISION_RADIUS,
  cooldownMs: COOLDOWN_MS,
  speed: DEFAULT_SPEED,
  wanderIntervalMs: WANDER_INTERVAL_MS,
  flashDurationMs: FLASH_DURATION_MS,
  tickMs: NORMAL_TICK_MS,
};

export const DEMO_CONFIG: ArenaConfig = {
  ...DEFAULT_CONFIG,
  tickMs: DEMO_TICK_MS,
  speed: 10,
};
