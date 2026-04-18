-- @pdt/backend — bot visibility (2026-04-18).
--
-- Authors can submit a bot as "hidden" so that its logic and even its
-- name are not exposed on the MCP server or the public REST listing.
-- Only the bare fact that a hidden bot exists (id + created_at) is
-- visible to other players. This removes the last-submitter advantage
-- in the club challenge, where a late entrant could otherwise read
-- every existing bot's spec via the MCP surface and hand-tune a
-- counter.
--
-- All existing rows are taken to be 'visible' (the presets and any
-- already-submitted bots). New submissions default to 'visible' too —
-- hiding is an opt-in choice.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-applying is a no-op.

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'visible'
    CHECK (visibility IN ('visible', 'hidden'));
