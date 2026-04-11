-- @pdt/backend — initial schema (Phase 1).
--
-- Mirrors architecture.md §11. Run on backend boot via migrate.ts.
-- Idempotent: every CREATE uses IF NOT EXISTS so re-applying on the
-- same database is a no-op.
--
-- JSONB rather than TEXT on `spec`, `result`, `rounds` so we can index
-- into them later (e.g. find all bots whose spec uses transitionProb)
-- without a schema change.

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  mcp_token     TEXT UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id                 TEXT PRIMARY KEY,
  player_id          TEXT REFERENCES players(id),
  name               TEXT NOT NULL,
  spec               JSONB NOT NULL,
  created_via        TEXT NOT NULL,
  source_description TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bots_created_via_idx ON bots (created_via);

CREATE TABLE IF NOT EXISTS tournaments (
  id               TEXT PRIMARY KEY,
  name             TEXT,
  mode             TEXT NOT NULL,
  rounds_per_match INTEGER NOT NULL,
  seed             BIGINT NOT NULL,
  result           JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  bot_id        TEXT REFERENCES bots(id),
  total_score   INTEGER NOT NULL,
  rank          INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, bot_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  bot_a_id      TEXT REFERENCES bots(id),
  bot_b_id      TEXT REFERENCES bots(id),
  score_a       INTEGER NOT NULL,
  score_b       INTEGER NOT NULL,
  rounds        JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches (tournament_id);
