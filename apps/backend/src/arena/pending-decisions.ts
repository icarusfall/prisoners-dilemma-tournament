// In-memory store for pending arena decisions.
//
// When the frontend arena detects a collision involving a "live" bot
// (one controlled by an MCP client), it POSTs the decision context here.
// The MCP client polls via get_pending_decision and responds via
// submit_decision. The frontend polls for the response.
//
// Decisions expire after DECISION_TIMEOUT_MS. The frontend should fall
// back to the bot's compiled BotSpec on timeout.

import type { Move } from '@pdt/engine';

/** How long before a pending decision expires (ms). */
export const DECISION_TIMEOUT_MS = 30_000;

/** How often we garbage-collect expired decisions (ms). */
const GC_INTERVAL_MS = 10_000;

export interface PendingDecision {
  /** Unique decision ID (frontend-generated). */
  id: string;
  /** The live bot's instance ID in the arena. */
  botInstanceId: string;
  /** The bot ID (e.g. 'tft'). */
  botId: string;
  /** The bot's name. */
  botName: string;
  /** The opponent's instance ID. */
  opponentInstanceId: string;
  /** The opponent's name. */
  opponentName: string;
  /** Current round number for this pair. */
  round: number;
  /** History of this bot's moves against this opponent. */
  myMoves: Move[];
  /** History of the opponent's moves against this bot. */
  theirMoves: Move[];
  /** When this decision was created (Date.now()). */
  createdAt: number;
  /** The submitted move, or null if still pending. */
  move: Move | null;
  /** When the move was submitted (Date.now()), or null. */
  resolvedAt: number | null;
}

/** Singleton store. */
const decisions = new Map<string, PendingDecision>();

/** Index: botInstanceId → decision ID (only the latest pending one). */
const byBot = new Map<string, string>();

let gcTimer: ReturnType<typeof setInterval> | null = null;

function ensureGc(): void {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, d] of decisions) {
      // Keep resolved decisions for 10s so frontend can pick them up.
      const expiry = d.resolvedAt
        ? d.resolvedAt + 10_000
        : d.createdAt + DECISION_TIMEOUT_MS + 5_000;
      if (now > expiry) {
        decisions.delete(id);
        if (byBot.get(d.botInstanceId) === id) byBot.delete(d.botInstanceId);
      }
    }
    if (decisions.size === 0 && gcTimer) {
      clearInterval(gcTimer);
      gcTimer = null;
    }
  }, GC_INTERVAL_MS);
}

export function createPendingDecision(
  data: Omit<PendingDecision, 'move' | 'resolvedAt' | 'createdAt'>,
): PendingDecision {
  const decision: PendingDecision = {
    ...data,
    createdAt: Date.now(),
    move: null,
    resolvedAt: null,
  };
  decisions.set(decision.id, decision);
  byBot.set(decision.botInstanceId, decision.id);
  ensureGc();
  return decision;
}

export function getPendingForBot(botInstanceId: string): PendingDecision | null {
  const id = byBot.get(botInstanceId);
  if (!id) return null;
  const d = decisions.get(id);
  if (!d) return null;
  // Check if expired.
  if (!d.move && Date.now() - d.createdAt > DECISION_TIMEOUT_MS) return null;
  return d;
}

export function getDecision(id: string): PendingDecision | null {
  return decisions.get(id) ?? null;
}

export function submitMove(id: string, move: Move): PendingDecision | null {
  const d = decisions.get(id);
  if (!d) return null;
  if (d.move) return d; // already resolved
  if (Date.now() - d.createdAt > DECISION_TIMEOUT_MS) return null; // expired
  d.move = move;
  d.resolvedAt = Date.now();
  return d;
}

/** List all currently pending (unresolved, non-expired) decisions. */
export function listPending(): PendingDecision[] {
  const now = Date.now();
  const result: PendingDecision[] = [];
  for (const d of decisions.values()) {
    if (!d.move && now - d.createdAt <= DECISION_TIMEOUT_MS) {
      result.push(d);
    }
  }
  return result;
}

/** Clear all decisions (useful for tests). */
export function clearAll(): void {
  decisions.clear();
  byBot.clear();
}
