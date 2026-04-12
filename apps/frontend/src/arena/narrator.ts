// Persistent caption narrator — filters arena events down to the
// interesting ones and produces richer, varied captions.
//
// Design: not every interaction deserves a caption. The narrator
// prioritises notable events (first meetings, betrayals, leader
// changes, milestone scores) and uses the narration from narrate.ts
// to explain *why* things happened rather than just *what* happened.
//
// This module is pure logic — it returns caption strings but doesn't
// touch the DOM.

import type { ArenaBot, ArenaEvent, PairState } from './types.js';
import { pairKey } from './types.js';

// ---------------------------------------------------------------------
// Caption entry
// ---------------------------------------------------------------------

export interface Caption {
  text: string;
  /** Priority: higher = more interesting, shown preferentially. */
  priority: number;
}

// ---------------------------------------------------------------------
// Narrator state
// ---------------------------------------------------------------------

export interface Narrator {
  /** Process a batch of events from one tick and return captions worth showing. */
  process(events: ArenaEvent[], now: number): Caption[];
}

/**
 * Create a narrator that tracks bot state to detect notable patterns.
 */
export function createNarrator(
  getBots: () => ArenaBot[],
  getPairs: () => Map<string, PairState>,
): Narrator {
  // Track what we've already narrated to avoid repeats.
  const announcedMilestones = new Set<string>();
  let lastInteractionCaption = 0;
  const INTERACTION_THROTTLE_MS = 3000; // Don't caption routine interactions more often than this.

  function botName(instanceId: string): string {
    return getBots().find((b) => b.instanceId === instanceId)?.name ?? instanceId;
  }

  function process(events: ArenaEvent[], now: number): Caption[] {
    const captions: Caption[] = [];

    for (const ev of events) {
      switch (ev.type) {
        case 'first_meeting': {
          captions.push({
            text: `${botName(ev.aId)} meets ${botName(ev.bId)} for the first time.`,
            priority: 2,
          });
          break;
        }

        case 'first_defection': {
          const bot = getBots().find((b) => b.instanceId === ev.botId);
          // If it's GRIM, add flavour about permanent retaliation.
          const grimNote = bot?.botId === 'grim'
            ? ' — GRIM never forgives.'
            : '';
          captions.push({
            text: `${botName(ev.botId)} defected for the first time against ${botName(ev.againstId)}!${grimNote}`,
            priority: 4,
          });
          break;
        }

        case 'leader_change': {
          captions.push({
            text: `${botName(ev.newLeader)} takes the lead with ${ev.score} points!`,
            priority: 5,
          });
          break;
        }

        case 'zombie_conversion': {
          captions.push({
            text: `${botName(ev.zombieId)} converted ${botName(ev.victimId)} to the horde!`,
            priority: 5,
          });
          break;
        }

        case 'zombie_apocalypse_end': {
          if (ev.survivor) {
            const secs = (ev.survivorTime / 1000).toFixed(1);
            captions.push({
              text: `The zombie apocalypse is over — ${botName(ev.survivor)} is the last one standing! Survived ${secs}s.`,
              priority: 6,
            });
          } else {
            captions.push({
              text: 'The zombie apocalypse is complete — no survivors.',
              priority: 6,
            });
          }
          break;
        }

        case 'interaction': {
          const aName = botName(ev.aId);
          const bName = botName(ev.bId);

          // Detect notable interaction patterns.
          const isMutualCoop = ev.moveA === 'C' && ev.moveB === 'C';
          const isMutualDefect = ev.moveA === 'D' && ev.moveB === 'D';
          const isBetrayal = (ev.moveA === 'D' && ev.moveB === 'C') ||
                             (ev.moveA === 'C' && ev.moveB === 'D');

          // Check for streaks in pair history.
          const key = pairKey(ev.aId, ev.bId);
          const pair = getPairs().get(key);
          const rounds = pair ? pair.movesA.length : 0;

          // Milestone round counts.
          if (rounds === 10 && !announcedMilestones.has(`${key}:10`)) {
            announcedMilestones.add(`${key}:10`);
            captions.push({
              text: `${aName} and ${bName} have played 10 rounds together.`,
              priority: 2,
            });
          } else if (rounds === 25 && !announcedMilestones.has(`${key}:25`)) {
            announcedMilestones.add(`${key}:25`);
            const coopCount = pair!.movesA.filter((m) => m === 'C').length +
                              pair!.movesB.filter((m) => m === 'C').length;
            const coopRate = Math.round((coopCount / (rounds * 2)) * 100);
            captions.push({
              text: `${aName} and ${bName} have played 25 rounds — ${coopRate}% cooperation overall.`,
              priority: 3,
            });
          }

          // Betrayal narration with the "why" explanation.
          if (isBetrayal) {
            const betrayer = ev.moveA === 'D' ? ev.aId : ev.bId;
            const victim = ev.moveA === 'C' ? ev.aId : ev.bId;
            const narration = ev.moveA === 'D' ? ev.narrationA : ev.narrationB;
            captions.push({
              text: `${botName(betrayer)} betrayed ${botName(victim)}! ${narration}`,
              priority: 3,
            });
            break;
          }

          // Mutual defection spiral — use narration to explain.
          if (isMutualDefect && rounds >= 3) {
            // Check if it's been mutual defection for a while.
            const recentA = pair!.movesA.slice(-3);
            const recentB = pair!.movesB.slice(-3);
            const allD = recentA.every((m) => m === 'D') && recentB.every((m) => m === 'D');
            if (allD && !announcedMilestones.has(`${key}:spiral`)) {
              announcedMilestones.add(`${key}:spiral`);
              captions.push({
                text: `${aName} and ${bName} are locked in a defection spiral.`,
                priority: 3,
              });
              break;
            }
          }

          // Throttle routine interaction captions.
          if (now - lastInteractionCaption > INTERACTION_THROTTLE_MS) {
            lastInteractionCaption = now;
            if (isMutualCoop) {
              captions.push({
                text: `${aName} and ${bName} cooperated. ${ev.narrationA}`,
                priority: 1,
              });
            } else if (isMutualDefect) {
              captions.push({
                text: `${aName} and ${bName} both defected.`,
                priority: 1,
              });
            }
          }
          break;
        }
      }
    }

    // Score milestones (checked per tick, not per event).
    for (const bot of getBots()) {
      for (const milestone of [50, 100, 200, 500]) {
        const mKey = `${bot.instanceId}:score:${milestone}`;
        if (bot.score >= milestone && !announcedMilestones.has(mKey)) {
          announcedMilestones.add(mKey);
          captions.push({
            text: `${bot.name} reached ${milestone} points!`,
            priority: milestone >= 200 ? 3 : 2,
          });
        }
      }
    }

    // Sort by priority (highest first) and return.
    captions.sort((a, b) => b.priority - a.priority);
    return captions;
  }

  return { process };
}
