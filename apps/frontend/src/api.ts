// @pdt/frontend — type-safe REST client for @pdt/backend.
//
// One thin wrapper per endpoint, plus a shared `request` helper that
// JSON-encodes the body, sets Content-Type, and turns non-2xx responses
// into typed `ApiError` exceptions instead of silent `undefined`s. The
// payload types here are imported directly from `@pdt/engine` wherever
// the engine already has a canonical shape — there is no second copy
// of `BotSpec` / `TournamentResult` / `RoundResult` on the frontend.
//
// Backend URL precedence (highest first):
//   1. `VITE_BACKEND_URL` from a `.env.local` (see `.env.example`)
//   2. The hardcoded Railway production URL fallback
//
// We deliberately do NOT default to `window.location.origin` because
// the frontend will live on Vercel and the backend on Railway in
// Phase 1 — same-origin is the rare case, not the common one.

import type {
  BotSpec,
  EvolutionaryResult,
  RoundResult,
  TournamentResult,
} from '@pdt/engine';

const DEFAULT_BACKEND_URL = 'https://pdtbackend-production.up.railway.app';

export const BACKEND_URL: string =
  import.meta.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL;

// ---------------------------------------------------------------------
// Shared request shape
// ---------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(`[${status} ${code}] ${message}`);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';

  // Build the URL with optional query string. Skip undefined params so
  // callers can spread an options object without dropping `if (x)` checks
  // around every entry.
  const url = new URL(path, BACKEND_URL);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  const init: RequestInit = { method };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), init);
  } catch (err) {
    // Network failure / CORS rejection / DNS — wrap as a 0/network error
    // so callers can `instanceof ApiError` uniformly.
    throw new ApiError(0, 'network_error', err instanceof Error ? err.message : String(err));
  }

  // 204 No Content has no body — return undefined cast to T. Callers
  // for delete-style endpoints declare their return type as `void`.
  if (res.status === 204) {
    return undefined as T;
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new ApiError(res.status, 'invalid_json', `non-JSON response from ${url}`);
  }

  if (!res.ok) {
    const obj = (parsed ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      res.status,
      obj.error ?? 'http_error',
      obj.message ?? `HTTP ${res.status}`,
    );
  }

  return parsed as T;
}

// ---------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  service: string;
  engineVersion: string;
  databaseUrlPresent: boolean;
  databaseOk: boolean;
  databaseError?: string;
  anthropicKeyPresent: boolean;
  uptimeSeconds: number;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

// ---------------------------------------------------------------------
// /api/bots
// ---------------------------------------------------------------------

/**
 * One row from the `bots` table as returned by the backend. `spec` is
 * the engine `BotSpec` shape, not a duplicate definition.
 */
export interface BotRecord {
  id: string;
  player_id: string | null;
  name: string;
  // `null` when the bot is hidden and the caller isn't the author.
  spec: BotSpec | null;
  created_via: string;
  source_description: string | null;
  created_at: string;
  visibility: 'visible' | 'hidden';
}

export interface ListBotsFilter {
  created_via?: 'preset' | 'nl' | 'mcp' | 'code';
  author?: string;
}

export async function listBots(filter: ListBotsFilter = {}): Promise<BotRecord[]> {
  const data = await request<{ bots: BotRecord[] }>('/api/bots', {
    query: { created_via: filter.created_via, author: filter.author },
  });
  return data.bots;
}

export function getBot(id: string): Promise<BotRecord> {
  return request<BotRecord>(`/api/bots/${encodeURIComponent(id)}`);
}

export interface CreateBotFromPresetRequest {
  presetId: string;
  name?: string;
}

export interface CreateBotFromSpecRequest {
  name: string;
  spec: BotSpec;
  source_description?: string;
  created_via?: 'nl' | 'mcp' | 'code';
  visibility?: 'visible' | 'hidden';
}

export function createBotFromPreset(body: CreateBotFromPresetRequest): Promise<BotRecord> {
  return request<BotRecord>('/api/bots', { method: 'POST', body });
}

export function createBotFromSpec(body: CreateBotFromSpecRequest): Promise<BotRecord> {
  return request<BotRecord>('/api/bots', { method: 'POST', body });
}

export function deleteBot(id: string): Promise<void> {
  return request<void>(`/api/bots/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------
// /api/bots/directory
// ---------------------------------------------------------------------

export interface DirectoryVisibleBot {
  id: string;
  name: string;
  spec: BotSpec;
  created_via: string;
  source_description: string | null;
  created_at: string;
  submitter_name: string | null;
}

export interface DirectoryHiddenBot {
  id: string;
  name: string;
  created_at: string;
  submitter_name: string | null;
}

export interface BotDirectoryResponse {
  visible: DirectoryVisibleBot[];
  hidden: DirectoryHiddenBot[];
}

export function getBotDirectory(): Promise<BotDirectoryResponse> {
  return request<BotDirectoryResponse>('/api/bots/directory');
}

// ---------------------------------------------------------------------
// /api/compile-bot
// ---------------------------------------------------------------------

export interface CompileBotResponse {
  spec: BotSpec;
}

export interface CompileBotError {
  error: string;
  message: string;
  details?: Array<{ path: string; message: string }>;
}

export function compileBot(description: string): Promise<CompileBotResponse> {
  return request<CompileBotResponse>('/api/compile-bot', {
    method: 'POST',
    body: { description },
  });
}

// ---------------------------------------------------------------------
// /api/tournaments
// ---------------------------------------------------------------------

export interface CreateTournamentInstance {
  botId: string;
  count: number;
}

export interface CreateTournamentRequest {
  name?: string;
  mode: 'round-robin' | 'evolutionary';
  roundsPerMatch: number;
  generations?: number;
  seed?: number;
  instances: CreateTournamentInstance[];
}

/**
 * Backend metadata layered on top of the engine result. Both POST and
 * GET responses include `id`; GET also fills in `name` and `createdAt`.
 * The discriminator on the union below is `mode`, identical to the
 * engine result types — so `if (t.mode === 'evolutionary') t.generations`
 * is type-safe with no extra plumbing.
 */
export interface TournamentMeta {
  id: string;
  name?: string | null;
  createdAt?: string;
}

export type TournamentRecord =
  | (TournamentResult & TournamentMeta)
  | (EvolutionaryResult & TournamentMeta);

export function createTournament(body: CreateTournamentRequest): Promise<TournamentRecord> {
  return request<TournamentRecord>('/api/tournaments', { method: 'POST', body });
}

export function getTournament(id: string): Promise<TournamentRecord> {
  return request<TournamentRecord>(`/api/tournaments/${encodeURIComponent(id)}`);
}

export interface MatchRecord {
  matchId: string;
  tournamentId: string;
  botAId: string;
  botBId: string;
  scoreA: number;
  scoreB: number;
  rounds: RoundResult[];
}

export function getMatch(tournamentId: string, matchId: string): Promise<MatchRecord> {
  return request<MatchRecord>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}`,
  );
}

// ---------------------------------------------------------------------
// /api/players
// ---------------------------------------------------------------------

export interface PlayerRecord {
  id: string;
  display_name: string;
  mcp_token: string;
  created_at: string;
}

export interface PlayerSummary {
  id: string;
  display_name: string;
  created_at: string;
}

export function createPlayer(displayName: string): Promise<PlayerRecord> {
  return request<PlayerRecord>('/api/players', {
    method: 'POST',
    body: { display_name: displayName },
  });
}

export async function listPlayers(): Promise<PlayerSummary[]> {
  const data = await request<{ players: PlayerSummary[] }>('/api/players');
  return data.players;
}

// ---------------------------------------------------------------------
// /api/arena — Live MCP decisions (Phase 7)
// ---------------------------------------------------------------------

export interface PendingDecisionRequest {
  id: string;
  botInstanceId: string;
  botId: string;
  botName: string;
  opponentInstanceId: string;
  opponentName: string;
  round: number;
  myMoves: string[];
  theirMoves: string[];
}

export interface DecisionPollResponse {
  id: string;
  botInstanceId: string;
  move: 'C' | 'D' | null;
  resolved: boolean;
  expired: boolean;
}

export function createPendingDecision(body: PendingDecisionRequest): Promise<{ id: string; timeoutMs: number }> {
  return request<{ id: string; timeoutMs: number }>('/api/arena/pending', {
    method: 'POST',
    body,
  });
}

export function pollDecision(id: string): Promise<DecisionPollResponse> {
  return request<DecisionPollResponse>(`/api/arena/decision/${encodeURIComponent(id)}`);
}

export function clearPendingDecisions(): Promise<void> {
  return request<void>('/api/arena/pending', { method: 'DELETE' });
}
