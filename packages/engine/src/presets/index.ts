// Ten classical preset strategies — the canonical opening library.
//
// These are the strategies that:
//   1. The `classifyOpponent` predicate (see interpreter.ts) recognises
//      and labels — the label set is frozen to exactly these eight.
//   2. The backend seed script writes into the `bots` table on first
//      boot so a fresh deployment is never empty.
//   3. The frontend explainer references when teaching newcomers.
//
// Each preset is a `BotSpec` literal — i.e. a piece of pure JSON-shaped
// data, type-checked at compile time. We deliberately do *not* use
// `.json` files: TS literals give us full type checking, work with
// `verbatimModuleSyntax`, and can be `JSON.stringify`-ed by the seed
// script with no loss of fidelity.

import type { BotSpec, ClassifierLabel } from '../types.js';

import { ALLC } from './allc.js';
import { ALLD } from './alld.js';
import { TFT } from './tft.js';
import { TF2T } from './tf2t.js';
import { GRIM } from './grim.js';
import { PAVLOV } from './pavlov.js';
import { GENEROUS_TFT } from './generous-tft.js';
import { RANDOM } from './random.js';
import { JOSS } from './joss.js';
import { PROBER } from './prober.js';

export { ALLC, ALLD, TFT, TF2T, GRIM, PAVLOV, GENEROUS_TFT, RANDOM, JOSS, PROBER };

/**
 * A preset's stable identifier. Matches the `ClassifierLabel` set
 * (minus `'UNKNOWN'`) so a `classifyOpponent` result maps directly
 * to a preset id.
 */
export type PresetId = Exclude<ClassifierLabel, 'UNKNOWN'>;

export interface Preset {
  /** Stable identifier; used as the `botId` in the seed script. */
  id: PresetId;
  /** Human-readable name; mirrors `spec.name`. */
  name: string;
  /** One-line description for the explainer / bot picker UI. */
  description: string;
  spec: BotSpec;
}

/**
 * The canonical preset list. Order is the order they appear in the
 * UI bot picker and the order the seed script writes them.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: 'ALLC',
    name: 'Always Cooperate',
    description: 'Plays C every round. The canonical exploitable optimist.',
    spec: ALLC,
  },
  {
    id: 'ALLD',
    name: 'Always Defect',
    description: 'Plays D every round. The bogeyman of the iterated game.',
    spec: ALLD,
  },
  {
    id: 'TFT',
    name: 'Tit for Tat',
    description:
      'Cooperate first, then mirror the opponent. Winner of both Axelrod tournaments.',
    spec: TFT,
  },
  {
    id: 'TF2T',
    name: 'Tit for Two Tats',
    description: 'Like TFT but only retaliates after two consecutive defections.',
    spec: TF2T,
  },
  {
    id: 'GRIM',
    name: 'Grim Trigger',
    description: 'Cooperates until the opponent defects once, then defects forever.',
    spec: GRIM,
  },
  {
    id: 'PAVLOV',
    name: 'Pavlov',
    description: 'Win-stay, lose-shift. Strong evolutionary recoverer.',
    spec: PAVLOV,
  },
  {
    id: 'GENEROUS_TFT',
    name: 'Generous Tit for Tat',
    description: 'TFT that forgives 10% of defections — robust against noise.',
    spec: GENEROUS_TFT,
  },
  {
    id: 'RANDOM',
    name: 'Random',
    description: 'Plays C or D with equal probability every round.',
    spec: RANDOM,
  },
  {
    id: 'JOSS',
    name: 'Joss',
    description: 'Sneaky TFT — cooperates like TFT but randomly defects 10% of the time.',
    spec: JOSS,
  },
  {
    id: 'PROBER',
    name: 'Prober',
    description: 'Tests with early defections; exploits pushovers, plays TFT against retaliators.',
    spec: PROBER,
  },
];

/** Lookup a preset by id. Throws if no such preset exists. */
export function getPreset(id: PresetId): Preset {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`getPreset: unknown preset id "${id}"`);
  }
  return found;
}
