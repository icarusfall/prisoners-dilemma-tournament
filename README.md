# Prisoner's Dilemma Tournament

A web platform for the LGIM AI Club's iterated Prisoner's Dilemma tournament.

Members build "PrisonerBots" three ways — pick a preset, describe one in
natural language (compiled by Claude), or drive one live via MCP — and
compete in both a round-robin tournament (the official winner) and an
evolutionary tournament (replicator dynamics over multiple generations).
A separate graphical Mapbox arena runs the same bots as live spectacle,
zombies optional.

The full design lives in [`docs/architecture.md`](docs/architecture.md).

## Repo layout

```
prisoners-dilemma-tournament/
├── packages/
│   └── engine/        # Pure-TS IPD engine: scoring, DSL interpreter,
│                      #   match runner, tournament runners. No I/O.
├── apps/
│   ├── backend/       # Fastify + Postgres + (later) MCP server
│   └── frontend/      # Vite + vanilla TS, Mapbox arena
├── docs/
│   ├── architecture.md
│   └── explainers/    # (Phase 3) Markdown source for in-site explainer pages
└── tsconfig.base.json
```

## Stack

- **Language**: TypeScript end-to-end, Node 22+ on the backend
- **Engine**: pure TS, no I/O, deterministic given `(seed, instances, rounds)`
- **Backend**: Fastify, Postgres via the [`postgres`](https://github.com/porsager/postgres) driver
- **Frontend**: Vite + vanilla TS, Mapbox GL JS for the arena
- **Hosting**: Vercel (frontend), Railway (backend + Postgres addon)

## Phase 1 status (in progress)

| Task | Status |
|---|---|
| Engine: types, scoring, DSL interpreter | ✅ |
| Engine: match runner, round-robin tournament | ✅ |
| Engine: evolutionary tournament | ⏳ |
| Preset bot JSON files | ⏳ |
| Backend skeleton (Fastify, Postgres, /health) | ⏳ |
| Backend bot/tournament routes | ⏳ |
| Frontend skeleton + tournament-running UI | ⏳ |
| End-to-end smoke test | ⏳ |

## Local development

```bash
# Install all workspaces
npm install

# Run tests (engine unit tests; the rest land as tasks complete)
npm test

# Backend dev (requires DATABASE_URL — see .env.example)
npm run dev --workspace @pdt/backend

# Frontend dev
npm run dev --workspace @pdt/frontend
```
