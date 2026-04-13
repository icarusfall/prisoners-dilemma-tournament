// Arena simulation — pure logic, no Mapbox dependency.
//
// Owns movement, collision detection, single-round play via the
// engine, and per-pair match history threading. The renderer reads
// the state produced here; this module never touches the DOM.

import type { BotSpec, BotView, DecisionFn, Move } from '@pdt/engine';
import { compile, scoreRound, mulberry32, deriveInstanceSeed, type Payoffs } from '@pdt/engine';
import { narrateDecision } from './narrate.js';
import {
  COLLISION_RADIUS,
  COOLDOWN_MS,
  DEFAULT_SPEED,
  FLASH_DURATION_MS,
  WANDER_INTERVAL_MS,
  ZOMBIE_SHAMBLER_SPEED,
  ZOMBIE_INFECTED_SPEED,
  pairKey,
  type ArenaBot,
  type ArenaConfig,
  type ArenaEvent,
  type PairState,
  type ZombieVariant,
  DEFAULT_CONFIG,
} from './types.js';
import { SPRITE_NAMES } from './sprites/index.js';

// ---------------------------------------------------------------------
// Bot creation
// ---------------------------------------------------------------------

let instanceCounter = 0;

export function createArenaBot(
  botId: string,
  name: string,
  spec: BotSpec,
  bounds: [number, number, number, number],
  rng: () => number,
  buildings: BuildingPolygons = [],
): ArenaBot {
  const [west, south, east, north] = bounds;
  // Pick a random position, retrying if it lands inside a building.
  let lng = west + rng() * (east - west);
  let lat = south + rng() * (north - south);
  for (let attempt = 0; attempt < 50 && isInsideBuilding(lng, lat, buildings); attempt++) {
    lng = west + rng() * (east - west);
    lat = south + rng() * (north - south);
  }
  const angle = rng() * Math.PI * 2;
  const speed = DEFAULT_SPEED;

  return {
    instanceId: `${botId}#${instanceCounter++}`,
    botId,
    name,
    spec,
    decide: compile(spec),
    lng,
    lat,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    spriteVariant: Math.floor(rng() * SPRITE_NAMES.length),
    score: 0,
    visualState: 'idle',
    flashUntil: 0,
    isZombie: false,
    convertedAt: 0,
    wanderTarget: { lng, lat },
    lastWanderChange: 0,
  };
}

/** Reset the instance counter (useful between arena runs). */
export function resetInstanceCounter(): void {
  instanceCounter = 0;
}

// Approximate degrees-per-metre at London's latitude (~51.5 N).
const DEG_PER_METRE_LNG = 1 / 71_700;
const DEG_PER_METRE_LAT = 1 / 111_320;

// ---------------------------------------------------------------------
// Building collision (point-in-polygon via ray casting)
// ---------------------------------------------------------------------

/** Building polygons — each is a ring of [lng, lat] pairs. */
export type BuildingPolygons = number[][][];

/**
 * Ray-casting point-in-polygon test. Returns true if (lng, lat) is
 * inside the given polygon ring.
 */
function pointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!;
    const xj = ring[j]![0]!, yj = ring[j]![1]!;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Returns true if the point is inside any building polygon. */
function isInsideBuilding(lng: number, lat: number, buildings: BuildingPolygons): boolean {
  for (const ring of buildings) {
    if (pointInPolygon(lng, lat, ring)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// Zombie creation
// ---------------------------------------------------------------------

/**
 * Create a zombie bot. Zombies don't play IPD — they wander and
 * convert any bot they collide with.
 */
export function createZombieBot(
  variant: ZombieVariant,
  bounds: [number, number, number, number],
  rng: () => number,
  buildings: BuildingPolygons = [],
): ArenaBot {
  const [west, south, east, north] = bounds;
  let lng = west + rng() * (east - west);
  let lat = south + rng() * (north - south);
  for (let attempt = 0; attempt < 50 && isInsideBuilding(lng, lat, buildings); attempt++) {
    lng = west + rng() * (east - west);
    lat = south + rng() * (north - south);
  }
  const angle = rng() * Math.PI * 2;
  const speed = variant === 'infected' ? ZOMBIE_INFECTED_SPEED : ZOMBIE_SHAMBLER_SPEED;
  const name = variant === 'infected' ? 'Infected' : 'Shambler';

  // Zombies need a dummy spec/decide since they never play IPD.
  const dummySpec = { name, version: 1, kind: 'dsl' as const, initial: { type: 'move' as const, move: 'D' as const }, rules: [], default: { type: 'move' as const, move: 'D' as const } };

  return {
    instanceId: `zombie#${instanceCounter++}`,
    botId: `zombie_${variant}`,
    name,
    spec: dummySpec,
    decide: () => 'D',
    lng,
    lat,
    vx: Math.cos(angle) * speed * DEG_PER_METRE_LNG,
    vy: Math.sin(angle) * speed * DEG_PER_METRE_LAT,
    spriteVariant: Math.floor(rng() * SPRITE_NAMES.length),
    score: 0,
    visualState: 'zombie',
    flashUntil: 0,
    isZombie: true,
    zombieVariant: variant,
    convertedAt: 0,
    wanderTarget: { lng, lat },
    lastWanderChange: 0,
  };
}

/**
 * Convert a living bot into a zombie. Preserves position but changes
 * all behaviour and visuals.
 */
function convertToZombie(bot: ArenaBot, variant: ZombieVariant, now: number): void {
  bot.isZombie = true;
  bot.zombieVariant = variant;
  bot.visualState = 'zombie';
  bot.flashUntil = 0;
  bot.convertedAt = now;
  bot.decide = () => 'D';
  // Zombies keep their name but get a prefix
  bot.name = `🧟 ${bot.name}`;
  // Adjust speed to match zombie variant
  const speed = variant === 'infected' ? ZOMBIE_INFECTED_SPEED : ZOMBIE_SHAMBLER_SPEED;
  const angle = Math.atan2(bot.vy, bot.vx);
  bot.vx = Math.cos(angle) * speed * DEG_PER_METRE_LNG;
  bot.vy = Math.sin(angle) * speed * DEG_PER_METRE_LAT;
}

// ---------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------

export function moveBot(
  bot: ArenaBot,
  dt: number,
  bounds: [number, number, number, number],
  now: number,
  rng: () => number,
  config: ArenaConfig = DEFAULT_CONFIG,
  buildings: BuildingPolygons = [],
): void {
  // Lazy velocity retargeting — pick a new wander target periodically.
  if (now - bot.lastWanderChange > config.wanderIntervalMs) {
    const [west, south, east, north] = bounds;
    // Pick a target that isn't inside a building.
    let tLng = west + rng() * (east - west);
    let tLat = south + rng() * (north - south);
    for (let attempt = 0; attempt < 20 && isInsideBuilding(tLng, tLat, buildings); attempt++) {
      tLng = west + rng() * (east - west);
      tLat = south + rng() * (north - south);
    }
    bot.wanderTarget = { lng: tLng, lat: tLat };
    bot.lastWanderChange = now;
  }

  // Steer toward wander target.
  const dLng = bot.wanderTarget.lng - bot.lng;
  const dLat = bot.wanderTarget.lat - bot.lat;
  const dist = Math.sqrt(dLng * dLng + dLat * dLat);
  if (dist > 0.000001) {
    // Zombies use their own variant speed; normal bots use config speed.
    const speed = bot.isZombie
      ? (bot.zombieVariant === 'infected' ? ZOMBIE_INFECTED_SPEED : ZOMBIE_SHAMBLER_SPEED)
      : config.speed;
    bot.vx = (dLng / dist) * speed * DEG_PER_METRE_LNG;
    bot.vy = (dLat / dist) * speed * DEG_PER_METRE_LAT;
  }

  const newLng = bot.lng + bot.vx * dt;
  const newLat = bot.lat + bot.vy * dt;

  // Building collision — if next position is inside a building, bounce.
  if (buildings.length > 0 && isInsideBuilding(newLng, newLat, buildings)) {
    // Reverse velocity and pick a new wander target.
    bot.vx = -bot.vx;
    bot.vy = -bot.vy;
    bot.lastWanderChange = 0; // Force new target next tick.
  } else {
    bot.lng = newLng;
    bot.lat = newLat;
  }

  // Clamp to bounds.
  const [west, south, east, north] = bounds;
  if (bot.lng < west) { bot.lng = west; bot.vx = Math.abs(bot.vx); }
  if (bot.lng > east) { bot.lng = east; bot.vx = -Math.abs(bot.vx); }
  if (bot.lat < south) { bot.lat = south; bot.vy = Math.abs(bot.vy); }
  if (bot.lat > north) { bot.lat = north; bot.vy = -Math.abs(bot.vy); }
}

// ---------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------

function distanceMetres(a: ArenaBot, b: ArenaBot): number {
  const dLng = (a.lng - b.lng) / DEG_PER_METRE_LNG;
  const dLat = (a.lat - b.lat) / DEG_PER_METRE_LAT;
  return Math.sqrt(dLng * dLng + dLat * dLat);
}

export function findCollisions(
  bots: ArenaBot[],
  pairs: Map<string, PairState>,
  now: number,
  config: ArenaConfig = DEFAULT_CONFIG,
): [ArenaBot, ArenaBot][] {
  const collisions: [ArenaBot, ArenaBot][] = [];
  for (let i = 0; i < bots.length; i++) {
    for (let j = i + 1; j < bots.length; j++) {
      const a = bots[i]!;
      const b = bots[j]!;
      if (a.isZombie || b.isZombie) continue;

      if (distanceMetres(a, b) > config.collisionRadius) continue;

      const key = pairKey(a.instanceId, b.instanceId);
      const pair = pairs.get(key);
      if (pair && now - pair.lastInteraction < config.cooldownMs) continue;

      collisions.push([a, b]);
    }
  }
  return collisions;
}

// ---------------------------------------------------------------------
// Single-round play
// ---------------------------------------------------------------------

/**
 * Play one IPD round between two arena bots. Threads the persistent
 * per-pair history so bots "remember" earlier encounters with the same
 * opponent across collisions.
 */
export function playArenaRound(
  a: ArenaBot,
  b: ArenaBot,
  pairs: Map<string, PairState>,
  now: number,
  payoffs?: Payoffs,
): { moveA: Move; moveB: Move; scoreA: number; scoreB: number; isFirstMeeting: boolean; narrationA: string; narrationB: string } {
  const key = pairKey(a.instanceId, b.instanceId);
  const isFirstA = a.instanceId < b.instanceId;

  let pair = pairs.get(key);
  const isFirstMeeting = !pair;
  if (!pair) {
    // Derive a stable per-pair seed from the two instance ids.
    let h = 0;
    for (const ch of key) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
    pair = { movesA: [], movesB: [], lastInteraction: 0, seed: h >>> 0 };
    pairs.set(key, pair);
  }

  // The "A" side in PairState is always the lexically smaller instanceId.
  const myMovesForA = isFirstA ? pair.movesA : pair.movesB;
  const theirMovesForA = isFirstA ? pair.movesB : pair.movesA;
  const myMovesForB = isFirstA ? pair.movesB : pair.movesA;
  const theirMovesForB = isFirstA ? pair.movesA : pair.movesB;

  const round = myMovesForA.length;
  const rngA = mulberry32(deriveInstanceSeed(pair.seed, round * 2));
  const rngB = mulberry32(deriveInstanceSeed(pair.seed, round * 2 + 1));

  const viewA: BotView = {
    selfInstanceId: a.instanceId,
    opponentInstanceId: b.instanceId,
    round,
    history: { myMoves: myMovesForA, theirMoves: theirMovesForA },
    rng: rngA,
  };
  const viewB: BotView = {
    selfInstanceId: b.instanceId,
    opponentInstanceId: a.instanceId,
    round,
    history: { myMoves: myMovesForB, theirMoves: theirMovesForB },
    rng: rngB,
  };

  const moveA = a.decide(viewA);
  const moveB = b.decide(viewB);
  const result = scoreRound(moveA, moveB, payoffs);

  // Generate narrations before history is modified.
  const narrationA = narrateDecision(a.name, a.spec, viewA, moveA);
  const narrationB = narrateDecision(b.name, b.spec, viewB, moveB);

  // Append to history (from the canonical A/B perspective).
  if (isFirstA) {
    pair.movesA.push(moveA);
    pair.movesB.push(moveB);
  } else {
    pair.movesA.push(moveB);
    pair.movesB.push(moveA);
  }

  pair.lastInteraction = now;

  return { moveA, moveB, scoreA: result.scoreA, scoreB: result.scoreB, isFirstMeeting, narrationA, narrationB };
}

// ---------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------

export interface TickResult {
  events: ArenaEvent[];
}

export function tick(
  bots: ArenaBot[],
  pairs: Map<string, PairState>,
  dt: number,
  now: number,
  bounds: [number, number, number, number],
  rng: () => number,
  config: ArenaConfig = DEFAULT_CONFIG,
  payoffs?: Payoffs,
  buildings: BuildingPolygons = [],
): TickResult {
  const events: ArenaEvent[] = [];

  // Expire flashes.
  for (const bot of bots) {
    if (bot.flashUntil > 0 && now >= bot.flashUntil) {
      bot.visualState = 'idle';
      bot.flashUntil = 0;
    }
  }

  // Move all bots (including zombies — they wander too).
  for (const bot of bots) {
    moveBot(bot, dt, bounds, now, rng, config, buildings);
  }

  // Track leader for leader_change events.
  let currentLeader = '';
  let currentLeaderScore = -1;
  for (const bot of bots) {
    if (bot.score > currentLeaderScore) {
      currentLeaderScore = bot.score;
      currentLeader = bot.instanceId;
    }
  }

  // Detect collisions and play rounds.
  const collisions = findCollisions(bots, pairs, now, config);
  for (const [a, b] of collisions) {
    const result = playArenaRound(a, b, pairs, now, payoffs);

    a.score += result.scoreA;
    b.score += result.scoreB;

    // Visual flash.
    a.visualState = result.moveA === 'C' ? 'cooperate' : 'defect';
    b.visualState = result.moveB === 'C' ? 'cooperate' : 'defect';
    a.flashUntil = now + config.flashDurationMs;
    b.flashUntil = now + config.flashDurationMs;

    // Events.
    events.push({
      type: 'interaction',
      aId: a.instanceId,
      bId: b.instanceId,
      moveA: result.moveA,
      moveB: result.moveB,
      scoreA: result.scoreA,
      scoreB: result.scoreB,
      narrationA: result.narrationA,
      narrationB: result.narrationB,
    });

    if (result.isFirstMeeting) {
      events.push({ type: 'first_meeting', aId: a.instanceId, bId: b.instanceId });
    }

    // Check for first defection by each bot.
    if (result.moveA === 'D') {
      const key = pairKey(a.instanceId, b.instanceId);
      const pair = pairs.get(key)!;
      const isFirstA = a.instanceId < b.instanceId;
      const myMoves = isFirstA ? pair.movesA : pair.movesB;
      if (myMoves.filter((m) => m === 'D').length === 1) {
        events.push({ type: 'first_defection', botId: a.instanceId, againstId: b.instanceId });
      }
    }
    if (result.moveB === 'D') {
      const key = pairKey(a.instanceId, b.instanceId);
      const pair = pairs.get(key)!;
      const isFirstA = a.instanceId < b.instanceId;
      const myMoves = isFirstA ? pair.movesB : pair.movesA;
      if (myMoves.filter((m) => m === 'D').length === 1) {
        events.push({ type: 'first_defection', botId: b.instanceId, againstId: a.instanceId });
      }
    }
  }

  // Zombie collisions — zombie × non-zombie = conversion.
  const zombies = bots.filter((b) => b.isZombie);
  const living = bots.filter((b) => !b.isZombie);
  for (const z of zombies) {
    for (const victim of living) {
      if (distanceMetres(z, victim) <= config.collisionRadius) {
        const variant = z.zombieVariant ?? 'shambler';
        convertToZombie(victim, variant, now);
        events.push({ type: 'zombie_conversion', victimId: victim.instanceId, zombieId: z.instanceId });
      }
    }
  }

  // Check if zombie apocalypse is over (all converted or one survivor).
  if (zombies.length > 0) {
    const survivors = bots.filter((b) => !b.isZombie);
    if (survivors.length <= 1) {
      const survivor = survivors[0] ?? null;
      events.push({
        type: 'zombie_apocalypse_end',
        survivor: survivor?.instanceId ?? null,
        survivorTime: survivor ? now - (survivor.convertedAt || now) : 0,
      });
    }
  }

  // Check for leader change.
  let newLeader = '';
  let newLeaderScore = -1;
  for (const bot of bots) {
    if (bot.score > newLeaderScore) {
      newLeaderScore = bot.score;
      newLeader = bot.instanceId;
    }
  }
  if (newLeader !== currentLeader && newLeaderScore > 0) {
    events.push({ type: 'leader_change', newLeader, score: newLeaderScore });
  }

  return { events };
}
