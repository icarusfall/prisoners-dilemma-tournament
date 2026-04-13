# Prisoner's Dilemma Tournament — Architecture

Draft v1.0 · 2026-04-13

## 1. Vision

A Prisoner's Dilemma tournament platform for the LGIM AI Club. Members write "PrisonerBots" — as presets, natural-language descriptions, or via an MCP server driven by their own Claude — and those bots compete in a headless round-robin tournament for an official leaderboard. A separate graphical arena, themed as a 3D map of an LGIM office (London, Dublin, or Chicago), runs the same bots as a live spectacle — funnelled through real streets by building collision — complete with zombies.

The tournament decides the winner. The arena decides the vibe.

## 2. Organising principle: one engine, two runners

The single most important architectural decision is that **match logic lives in one pure-TS package shared by both runners**. There is exactly one implementation of "what happens when two bots play an IPD round", and it has no knowledge of whether it's being called from a headless tournament loop on the server or a Mapbox-driven animation loop in the browser.

```
                      ┌──────────────────────┐
                      │   engine (pure TS)   │
                      │  - types             │
                      │  - bot spec DSL      │
                      │  - DSL interpreter   │
                      │  - match loop        │
                      │  - scoring           │
                      └──────────┬───────────┘
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
     ┌──────────▼──────────┐         ┌────────────▼────────────┐
     │  tournament runner  │         │      arena runner       │
     │  (Node, headless)   │         │  (browser, Mapbox GL)   │
     │                     │         │                         │
     │  round-robin,       │         │  random walks,          │
     │  deterministic,     │         │  spatial collisions,    │
     │  authoritative      │         │  sprites, zombies,      │
     │  leaderboard        │         │  spectacle only         │
     └─────────────────────┘         └─────────────────────────┘
```

Same bot specs, same decision logic, two match-making layers on top. The tournament runner pairs every bot against every other bot for N rounds. The arena runner pairs bots when their sprites collide on the map.

## 3. Engine layer

### 3.1 Core types

```ts
type Move = 'C' | 'D';

interface RoundResult {
  a: Move;
  b: Move;
  scoreA: number;
  scoreB: number;
}

interface MatchHistory {
  // per-opponent history — bots only see their own side of this
  opponentId: string;
  myMoves: Move[];
  theirMoves: Move[];
  myScore: number;
  theirScore: number;
}

interface BotView {
  // the only information a bot's decision function can see
  selfInstanceId: string;
  opponentInstanceId: string;
  round: number;             // 0-indexed within this match
  history: {
    // full move-by-move history of the current match, nothing hidden
    myMoves: Move[];
    theirMoves: Move[];
  };
  rng: () => number;         // seeded, for deterministic replays
}

type DecisionFn = (view: BotView) => Move;
```

### 3.2 Scoring

Classic IPD payoff matrix (v1):

|         | Opp C | Opp D |
|---------|-------|-------|
| **Me C** | R=3   | S=0   |
| **Me D** | T=5   | P=1   |

Values are constants in `engine/scoring.ts` so we can swap to money-denominated variants later (e.g. R=20, P=10, T=25, S=5 per the user's original sketch) without touching logic.

### 3.3 Match loop

```ts
function playMatch(
  a: Bot,
  b: Bot,
  rounds: number,
  seed: number
): { roundResults: RoundResult[]; totalA: number; totalB: number }
```

Deterministic given `(a, b, rounds, seed)`. Each bot's decision function receives only its own `BotView` — it cannot see the opponent's internal state, strategy, or the global RNG. History is built up round by round.

### 3.4 Bot instances

A `Bot` as stored in the database is a `BotSpec` + metadata. A `Bot` as it exists in a *running match* is a **runtime instance**: the same spec with a unique `instanceId` assigned at tournament/arena setup. This lets us put five copies of TFT into a single tournament or arena run — they share a `botId` but have distinct `instanceId`s and are tracked independently by the engine.

```ts
interface BotInstance {
  instanceId: string;        // unique per runtime (e.g. "tft#1", "tft#2")
  botId: string;             // persistent reference to stored BotSpec
  spec: BotSpec;
  decide: DecisionFn;        // compiled from spec at setup time
}
```

The `instanceId` is what appears in match logs, leaderboards, and arena sprite IDs. The `botId` is what appears in the library and the `created_via` filter.

### 3.5 Tournament runner (round-robin)

```ts
function runTournament(
  instances: BotInstance[],
  roundsPerMatch: number,
  seed: number,
  options?: { includeSelfPlay?: boolean }  // default false
): TournamentResult
```

Default is **Axelrod-faithful: self-play is excluded**. An `includeSelfPlay` flag is available for experimentation but is off by default.

Returns per-instance totals, per-pair breakdowns, and a seed so any match can be replayed.

This is authoritative. A given `(instances, roundsPerMatch, seed)` always produces the same leaderboard. No wall-clock, no global state, no I/O.

### 3.6 Evolutionary tournament runner

The headline non-trivial mode. A thin loop around `runTournament` that models population dynamics over generations.

```ts
function runEvolutionaryTournament(
  initialPopulation: Record<BotId, number>,   // e.g. { tft: 10, grim: 10, alld: 10 }
  roundsPerMatch: number,
  generations: number,
  seed: number,
  options?: {
    selection?: 'replicator' | 'proportional';  // default 'replicator'
    preserveTotal?: boolean;                     // default true
    extinctionThreshold?: number;                // default 0.01
  }
): EvolutionaryResult
```

**How a generation works:**

1. The population is represented as a *distribution over strategies*, not a bag of individuals. For each unordered pair of strategies `(i, j)` (including `i == j`) we run one `runTournament`-style match and record per-strategy average scores.
2. Each strategy's "fitness" for the generation is the expected score of one of its members against a random opponent drawn from the current population: `fitness_i = Σ_j share_j × score(i vs j)`.
3. Population shares update via replicator dynamics: `share_i' = share_i × fitness_i / mean_fitness`.
4. Strategies falling below `extinctionThreshold` are removed (optional — configurable).
5. Repeat for `generations` steps.

This is `O(k²)` per generation where `k` is the number of distinct strategies — so it stays cheap even at hundreds of generations. A per-individual mode (where each of the 10 TFTs is a separate entity) can be added later if we want stochastic noise or extinction cascades, but is not needed for v1.

**Output shape:**

```ts
interface EvolutionaryResult {
  generations: Generation[];
  generation1Winner: BotId;     // top total score on the first round-robin
  dominanceWinner: BotId;       // largest population share at the end
  extinctEver: BotId[];
}

interface Generation {
  index: number;
  population: Record<BotId, number>;   // shares (sum to 1, or to initialTotal if preserveTotal)
  fitness: Record<BotId, number>;      // average score this generation
  leaderboard: LeaderboardEntry[];
}
```

This gives us your two leaderboards natively: `generation1Winner` is the classic Axelrod result, `dominanceWinner` is "who actually thrived". The frontend can render `generations[]` as a stacked area chart of population share over time — the visual payoff is big.

## 4. Bot spec DSL

**The central safety decision: bots are data, not code.** Every bot — preset, Claude-compiled, or MCP-submitted — is a JSON document conforming to `BotSpec`. A deterministic interpreter in `engine/interpreter.ts` turns a `BotSpec` into a `DecisionFn`.

### 4.1 Why a DSL

- Safe: no `eval`, no arbitrary JS from Claude, no sandbox escape surface
- Replayable: bots can be diffed, stored as JSONB in Postgres, shared as URLs
- Debuggable: we can show a player *why* their bot defected on turn 17 (which rule fired)
- Claude-friendly: LLMs produce conformant JSON far more reliably than correct code

### 4.2 Shape (sketch — to be firmed up in Phase 1)

```jsonc
{
  "name": "Forgiving TFT",
  "author": "charl",
  "version": 1,
  "initial": "C",                         // first-move move
  "rules": [
    // first matching rule wins; fall through to "default"
    {
      "when": { "round": { "eq": 0 } },
      "do": "C"
    },
    {
      "when": { "opponentLastMove": "D", "random": { "lt": 0.1 } },
      "do": "C",
      "comment": "forgive 10% of the time"
    },
    {
      "when": { "opponentLastMove": "D" },
      "do": "D"
    }
  ],
  "default": "C"
}
```

### 4.3 Primitives available to rules

The DSL exposes the *full* match history through a set of derived statistics. Authors don't write array-indexing logic themselves — they reference named primitives that the interpreter computes on demand from the history.

**Basic state:**
- `round` — current round index
- `opponentLastMove`, `myLastMove`
- `myScore`, `opponentScore` (cumulative in this match)
- `random` — draw from the seeded RNG in `BotView`

**History summaries (optionally over a trailing window):**
- `opponentDefectionRate(window?)`, `opponentCooperationRate(window?)`
- `myDefectionRate(window?)`, `myCooperationRate(window?)`
- `consecutiveDefections(side)`, `consecutiveCooperations(side)` — current streak length on `"me"` or `"opponent"`
- `longestRun(move, side)` — longest streak of `move` so far on either side

**Bayesian-lite statistics** — the ones that let a rule reason about "what kind of opponent is this":
- `transitionProb(from, to)` — `P(opponent plays 'to' | opponent last played 'from')`. The primitive that lets rules distinguish TFT-like from RANDOM-like from ALLD-like opponents.
- `myTransitionProb(from, to)` — symmetric, for self-aware strategies (PAVLOV-ish)
- `patternInLastN(n, pattern)` — exact match of the opponent's last `n` moves against a short sequence literal (e.g. `"CDCD"`)
- `classifyOpponent()` — built-in classifier. Compares the observed transition matrix and cooperation rate against a **frozen library of the eight classical presets** (`"TFT"`, `"TF2T"`, `"ALLD"`, `"ALLC"`, `"RANDOM"`, `"GRIM"`, `"PAVLOV"`, `"GENEROUS_TFT"`) with a configurable confidence threshold. Returns the best-matching label or `"UNKNOWN"`. The classifier **never** considers user-submitted bots — this is a deliberate design decision: (a) it keeps results reproducible as the bot library grows, (b) it avoids a perverse incentive where authors obscure their bot logic to fool each other's classifiers. If users later want to build *their own* classifiers over arbitrary opponents, they can compose one out of `transitionProb`, `patternInLastN`, and window-limited rates — that flexibility is already in the DSL.

**Combinators:** `and`, `or`, `not`; numeric comparators `eq`, `lt`, `lte`, `gt`, `gte`, `between`.

**Actions (`do`):** `"C"`, `"D"`, or a stochastic choice `{ "random": { "C": 0.7, "D": 0.3 } }`.

This primitive set is deliberately designed to cover the **Bayesian-lite** case — bots that want to classify an opponent and switch strategy accordingly — without needing arbitrary computation. You can express "if the opponent looks like TFT and we're past round 50, defect to exploit the endgame" as a rule. You can't express "fit a hidden Markov model and run value iteration" — for that, see §4.5.

Every primitive is deterministic (given the seeded RNG), cheap to compute, and provably terminating. The interpreter caches history-derived stats per round so repeated access is free.

### 4.4 Presets as BotSpecs

Shipped in `engine/presets/`, each preset is a `BotSpec` JSON file in the exact same format a user would upload. This means the presets are also our interpreter test fixtures. Initial roster:

- `ALLC` — always cooperate
- `ALLD` — always defect
- `RANDOM`
- `TFT` — tit-for-tat
- `TF2T` — tit-for-two-tats
- `GRIM` — cooperate until first defection, then defect forever
- `PAVLOV` — win-stay lose-shift
- `GENEROUS_TFT` — TFT but forgives 10%

### 4.5 Future: the code tier (deferred to a later phase)

The DSL covers declarative strategies and Bayesian-lite classification. It does **not** cover genuinely computational strategies — weight updates, MCTS, neural nets, anything that needs loops or intermediate variables. For those, we commit to adding a second authoring tier in a later phase:

- `BotSpec` gains a `kind: "dsl" | "code"` discriminator (designed in from day one so no schema migration is needed)
- Code bots are a sandboxed pure function `decide(view: BotView): Move`
- Sandbox: Web Worker in the browser, `isolated-vm` in Node. No I/O, no network, no timers, no `Math.random` — RNG is injected via `view.rng`.
- Budget: wall-time timeout per decision + a hard CPU cap; timeouts default to cooperation (or configurable fallback).
- Determinism: the sandbox freezes `Date.now`, `performance.now`, and any other non-deterministic surface; matches are still reproducible from `(spec, seed)`.

This tier is **not** in the v1 scope. The expectation is that the expanded DSL primitive set in §4.3 covers ~90% of what authors actually want, and the code tier becomes a power-user escape hatch once the platform is proven. Designing the `kind` discriminator in now means we don't have to refactor `BotSpec` or the interpreter boundary when it arrives.

## 5. The shared bot library

There is one bot library, full stop. Presets, NL-compiled bots, and MCP-submitted bots all live in the same `bots` table with the same `BotSpec` shape. The engine does not know or care how a bot was created. The frontend exposes a single browsable library with a `created_via` filter (`preset` / `nl` / `mcp`) and an author filter so you can pick "my bots", "AI Club entries", or "all".

The tournament setup screen and the arena setup screen both pull from this library. Both let you:

- Add any bot from the library
- Add **multiple instances** of the same bot (each gets a distinct `instanceId` — §3.4)
- Mix freely — `{ myClaudeCompiledBot: 3, TFT: 5, charlsMCPBot: 2, ALLD: 10 }` is a valid roster

This is also exactly the shape `runEvolutionaryTournament` wants for its `initialPopulation`, so the same UI that sets up a regular tournament sets up an evolutionary run.

## 6. Bot creation flows

### 6.1 Flow A — Preset

UI dropdown → pick a preset → instance is added to the current tournament / arena. Zero backend work beyond a static JSON load.

### 6.2 Flow B — Natural language → JSON

1. User types a description into a textarea ("play TFT but forgive randomly 10% of the time, and defect forever if the opponent defects 5 times in a row")
2. Frontend calls backend `POST /api/compile-bot { description }`
3. Backend calls Anthropic API with a strict system prompt + the `BotSpec` JSON schema
4. Claude returns a JSON object; backend validates it against the schema; if invalid, it re-prompts once with the validation errors; if still invalid, it returns an error to the UI
5. Frontend shows the compiled spec for review/edit and lets the user save it

**Important**: the backend *never* runs arbitrary code from Claude. It only accepts JSON conforming to the schema, and the engine interpreter is the only thing that ever acts on it.

### 6.3 Flow C — Remote MCP bot

v1 implements **C1: policy submission**. The backend exposes an MCP server with tools the player's Claude can call:

- `submit_bot(spec: BotSpec) -> { botId }`
- `list_my_bots() -> Bot[]`
- `update_bot(botId, spec)`
- `delete_bot(botId)`
- `get_leaderboard(tournamentId?) -> LeaderboardEntry[]`
- `get_match_history(botId, opponentId?) -> Match[]`

A player points their Claude instance at `mcp.prisoners-dilemma.<domain>`, tells it "I want you to write a bot that tries to exploit TFT opponents, submit it, watch the leaderboard, and iterate until we're in the top 3". Their Claude is operating *on their behalf as an author*, not as the bot itself. The bot that runs in the tournament is still a `BotSpec` JSON object.

**C3 (live per-move decisions in the arena)** is deferred to Phase 6. It requires a slow-tick arena mode and a `get_pending_decision(botId)` / `submit_decision(botId, move)` tool pair with timeout fallback to a default `BotSpec`. Worth doing for the demo spectacle but not needed for the tournament to work.

## 7. MCP server

Co-located with the backend for v1 as a separate HTTP route group. Uses `@modelcontextprotocol/sdk` with the HTTP+SSE transport so any remote Claude can connect via a URL.

Auth model for v1: a per-player token passed as an MCP header. Tokens are issued via the frontend ("Create a player") and stored in Postgres. Simple, good enough for an internal AI Club event, no OAuth.

### 7.1 Tools

Actions the connecting Claude can take on behalf of its player:

- `submit_bot(spec: BotSpec) -> { botId }`
- `validate_bot_spec(spec: BotSpec) -> { ok: boolean, errors?: string[] }` — dry-run validation without saving, so an iterating Claude can check its work before committing
- `list_my_bots() -> Bot[]`
- `update_bot(botId, spec)`
- `delete_bot(botId)`
- `run_tournament({ instances, mode, ... }) -> TournamentResult` — run a hypothetical tournament without persisting results; lets a player's Claude test ideas
- `get_leaderboard(tournamentId?) -> LeaderboardEntry[]`
- `get_match_history(botId, opponentId?) -> Match[]`

### 7.2 Resources

Read-only content the connecting Claude can fetch via `resources/list` and `resources/read`. This is how a remote Claude discovers the rules of the game, the DSL, and worked examples **without the player having to paste anything**.

URIs:

- `pd://docs/{slug}` — every Markdown file in `docs/explainers/` (see §10). The rules of the game, the DSL reference, the MCP guide, everything.
- `pd://schema/bot-spec.json` — the authoritative JSON Schema for `BotSpec`. A connecting Claude fetches this to know exactly what shape it needs to produce.
- `pd://presets/{name}` — each of the eight classical presets as its raw `BotSpec` JSON. Worked examples a Claude can learn the DSL from by example.
- `pd://scoring` — the current payoff matrix constants.

**Single source of truth**: these resources are served directly from the same Markdown/JSON files the frontend renders as "How it works" pages. Update the DSL primitive list in `docs/explainers/04-writing-a-bot-dsl.md` and it updates on the website *and* for every MCP-connected Claude on the next read.

### 7.3 Prompts

Templated starter messages the player can invoke in their Claude client to kick off a focused session. MCP "prompts" appear as selectable commands in clients like Claude Desktop — picking one primes the conversation with a ready-made task.

v1 prompts:

- `start_building_a_bot` — primes Claude with: "Fetch `pd://docs/00-what-is-this`, `pd://docs/01-prisoners-dilemma`, and `pd://docs/04-writing-a-bot-dsl`, then ask me what kind of strategy I'd like to build and iterate with me toward a `BotSpec` you can `validate_bot_spec` and `submit_bot`."
- `analyse_my_bot_performance` — primes Claude with: "Fetch my latest leaderboard and match history via the appropriate tools, then identify which opponents my bot performs worst against and suggest a revised `BotSpec`."

The prompts are thin — they just orchestrate tool+resource calls the player could do manually. But they make the getting-started experience feel polished, and they're the canonical place to document "here's the intended workflow".

## 8. Arena rendering

### 8.1 Arena as tutorial

The arena is not only a spectacle — it's the **first teaching layer** a colleague encounters. When someone lands on the site, a small scripted demo scenario auto-runs in the arena: a handful of pre-selected classical bots (e.g. TFT, GRIM, RANDOM, ALLD) wandering the Coleman Street map, colliding, flashing cooperate/defect, accumulating scores. The landing page is the game, not a wall of text.

Supporting tutorial affordances layered over the base arena:

- **Slow default tick rate on the landing demo** so the eye can follow every interaction. Playable faster once the user starts their own run.
- **Click a sprite** → a side panel shows that bot's name, its `created_via` origin, its ruleset (for DSL bots, the compiled rules in human-readable form), and its current score and match history.
- **Click a flash** (or hover the thin connecting line during an interaction) → a tooltip narrates the round: "TFT cooperated because GRIM cooperated last turn. GRIM defected because TFT defected in round 7." This is where the intellectual content meets the visual.
- **A small persistent caption** at the bottom of the arena narrates notable events as they happen: "GRIM just defected for the first time against RANDOM and will now defect forever", "A zombie has been added", "ALLC is winning on points".
- **"What am I looking at?" button** in the top-right of the arena that opens the full explainer webpages (§10) for readers who want to go deeper.

The principle: a colleague who lands on the site and never clicks "How it works" should still absorb the rules of the game by watching the arena for sixty seconds. The explainer pages are for the ones who then want the depth.

### 8.2 Map

Mapbox GL JS centred on the selected office. Three map configurations (one per office) with appropriate zoom, bearing, and a custom dark-themed style. Reuse the patterns established in `lambeth-cyclists-visualiser`.

### 8.3 Bot sprites

A small gallery of hand-drawn SVG silhouettes (office worker, courier, barista, professor, builder, jogger, tourist, security guard — aim for 6–8). Loaded as Mapbox images and rendered via a `symbol` layer driven by a GeoJSON source of bot positions.

On spawn, each bot is assigned a random silhouette from the gallery. This is purely cosmetic; the engine doesn't know about sprites.

### 8.4 Visual states

All state changes are done via `icon-color` and a lightweight state machine per bot:

| State | `icon-color` | Duration |
|---|---|---|
| Idle | neutral grey | default |
| Cooperate flash | **light green** | ~400ms |
| Defect flash | red | ~400ms |
| Zombified | **dark desaturated green** | permanent |

A thin line is drawn between a pair for the duration of their interaction so the spectator can see "these two are playing". A translucent score halo around each sprite scales with accumulated arena points.

### 8.5 Movement and collisions

- Each bot has a `position` and `velocity`. At each tick: `position += velocity * dt`.
- Velocity is lazily retargeted to a random nearby point every few seconds (the "wander"). `SPEED` is a per-bot parameter.
- Collision = two non-zombie bots within `COLLISION_RADIUS` *and* no recent interaction between that pair (cooldown of K ticks).
- On collision, the engine plays a single round using each bot's `DecisionFn`. The match history *between this pair* is threaded through arena ticks — so the second time they collide, each remembers the first encounter.
- Points accumulate into an arena-local score, separate from the headless tournament score.

### 8.6 Arena game loop (pseudocode)

```ts
tick(dt) {
  for (const bot of liveBots) moveBot(bot, dt);
  for (const [a, b] of findCollisions(liveBots)) {
    if (a.isZombie || b.isZombie) {
      handleZombieCollision(a, b);
    } else if (!onCooldown(a, b)) {
      const round = playSingleRound(a, b);      // engine call
      applyRoundToArena(a, b, round);           // update scores, flash sprites
      markCooldown(a, b);
    }
  }
  renderFrame();
}
```

## 9. Zombies

Arena-only feature. Two variants, distinguished only by `SPEED`:

- **Shambler** (Night of the Living Dead): slow, inexorable
- **Infected** (28 Days Later): fast, terrifying

A zombie is an agent with `isZombie = true` and no `BotSpec`. Collision logic:

- Zombie × bot → bot becomes zombie (sprite swaps to a zombie variant of its current silhouette, tint → dark green, `DecisionFn` is replaced with the zombie behaviour)
- Zombie × zombie → no-op
- Bots don't get any warning — zombies don't play IPD, they just convert

A "zombie apocalypse" arena run ends when there is one or zero non-zombie bots remaining, or a time limit expires. Survival time per bot is recorded as a secondary arena stat — fun, but not tournament-bearing.

## 10. Documentation and explainers

A deliberate goal: colleagues with no background in game theory, IPD, or Axelrod should be able to land on the site and absorb the rules of the game without ever leaving it. The project is taught in three layers, each progressively more detailed:

1. **The arena itself** (§8.1) — a colleague who lands on the site watches the default demo for sixty seconds and absorbs the core rules passively: sprites collide, flash green for cooperate and red for defect, scores tick up, a caption narrates. This is the primary teaching surface.
2. **In-site explainer webpages** — "How it works" pages that go deeper for readers who want the theory and the history. These are **webpages on the site**, not downloadable files. A colleague browses them inside the app like any other page; nothing is saved to disk.
3. **MCP resources** — the same explainer content exposed as `pd://docs/*` resources (§7.2) so that a connecting Claude has the full rulebook in its context without the player pasting anything.

### 10.1 Source of truth

A single directory, `docs/explainers/`, holds Markdown files that are consumed by both the frontend webpages and the MCP resources. The frontend renders them with a Markdown-to-HTML step (Vite plugin at build time, or a small client-side renderer) and surfaces them as routed pages under `/how-it-works/{slug}`. The MCP server reads the same files and serves them verbatim. Updating a file updates both surfaces. No duplication, no drift, and nothing is offered as a download.

### 10.2 Content inventory

The nine files below are the v1 set, all drafted as of Phase 3.

- `00-what-is-this.md` — one-page project overview. What this is, why the AI Club built it, what you can do here.
- `01-prisoners-dilemma.md` — the game. Payoff matrix, C vs D, why defection is individually rational but collectively bad. Concrete walked example.
- `02-iterated-and-why-it-matters.md` — the shadow of the future. One-shot vs iterated, Axelrod's 1980 tournament, where TFT came from, Hofstadter's *Metamagical Themas* column, the Dawkins connection. Pitched at readers who haven't read these works — mention them by name, don't assume familiarity.
- `03-tournament-modes.md` — round-robin vs evolutionary. What a generation is, what replicator dynamics do, why `generation1Winner` and `dominanceWinner` can disagree. A worked toy example.
- `04-writing-a-bot-dsl.md` — the DSL with examples. TFT as three rules, GRIM as two, a "forgiving TFT that classifies opponents" as a showcase of the Bayesian-lite primitives. Full primitive reference table.
- `05-creating-a-bot.md` — the three flows (preset, natural language, MCP) with screenshots.
- `06-mcp-guide.md` — how to point your own Claude at the MCP server, which tools and resources are available, getting-started-in-five-minutes style.
- `07-the-arena.md` — what the Mapbox visualisation shows, what the coloured flashes mean, why the arena is spectacle rather than tournament, why zombies.
- `08-axelrod-and-further-reading.md` — intellectual lineage and reading list. Axelrod's *Evolution of Cooperation*, Hofstadter, Poundstone's *Prisoner's Dilemma*, game-theory writing on LessWrong. Works cited by name only — no guessed URLs.

Each explainer is short (one to two pages), friendly in tone, and ends with a "next" link to the following file.

### 10.3 Phasing

- **Phase 1** *(done)*: inventory pinned (this section), `docs/explainers/` directory created, terminology in the code aligned with what the explainers will say.
- **Phase 3** *(done)*: all nine files drafted with full prose, rendered as in-site webpages under the "How It Works" tab, prev/next navigation, arena "What am I looking at?" button links through.
- **MCP phase**: serve the same files as MCP resources with zero new content authoring.

## 11. Persistence

**Postgres via Railway's managed Postgres addon**, accessed by the backend through `DATABASE_URL`. The pure-JS [`postgres`](https://github.com/porsager/postgres) driver — no native compilation, no Windows build-tools dependency, friendly tagged-template API. Same connection string works from Railway *and* from a developer's laptop, so the dev/prod parity story is "set one env var".

We had previously planned `node:sqlite` (after `better-sqlite3` failed to build on Windows), but switched to Postgres once we settled on Railway-hosted bot storage with potentially-local tournament runners — multiple readers and a network-reachable DB make Postgres strictly better for that topology.

Schema for v1 (`migrations/001_init.sql`, applied on backend boot):

```sql
CREATE TABLE players (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  mcp_token     TEXT UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bots (
  id                 TEXT PRIMARY KEY,
  player_id          TEXT REFERENCES players(id),
  name               TEXT NOT NULL,
  spec               JSONB NOT NULL,            -- full BotSpec
  created_via        TEXT NOT NULL,             -- 'preset' | 'nl' | 'mcp'
  source_description TEXT,                      -- original NL text if created_via='nl'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tournaments (
  id               TEXT PRIMARY KEY,
  name             TEXT,
  mode             TEXT NOT NULL,               -- 'round-robin' | 'evolutionary'
  rounds_per_match INTEGER NOT NULL,
  seed             BIGINT NOT NULL,
  result           JSONB NOT NULL,              -- TournamentResult or EvolutionaryResult
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tournament_entries (
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  bot_id        TEXT REFERENCES bots(id),
  total_score   INTEGER NOT NULL,
  rank          INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, bot_id)
);

CREATE TABLE matches (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  bot_a_id      TEXT REFERENCES bots(id),
  bot_b_id      TEXT REFERENCES bots(id),
  score_a       INTEGER NOT NULL,
  score_b       INTEGER NOT NULL,
  rounds        JSONB NOT NULL                  -- full move-by-move log for replay
);
```

`spec`, `result`, and `rounds` are JSONB rather than TEXT so we can index into them later (e.g. find all bots whose spec uses `transitionProb`) without a schema change.

Arena state is intentionally *not* persisted — it's ephemeral spectacle. A "save this arena run as a replay" feature can come later if wanted.

## 12. Deployment topology

```
     Vercel                    Railway                      Anthropic
  ┌─────────┐            ┌──────────────────┐           ┌────────────┐
  │frontend │ ── HTTPS ──▶│ backend (Node)   │ ── API ──▶│ Claude API │
  │ (Vite)  │            │ - REST endpoints │           └────────────┘
  └─────────┘            │ - MCP server     │
                         │ - engine (same   │
                         │   code as FE)    │
                         └────────┬─────────┘
                                  │ DATABASE_URL
                                  ▼
                         ┌──────────────────┐
                         │ Postgres (Railway│
                         │ managed addon)   │
                         └──────────────────┘
                                  ▲
                                  │ MCP over HTTP+SSE
                                  │
                           ┌──────┴───────┐
                           │ player's     │
                           │ Claude       │
                           └──────────────┘
```

- **Frontend** on Vercel: Vite-built static bundle; Mapbox GL JS; calls backend REST for bot CRUD, tournament runs, and compilation; renders arena locally using the shared engine package.
- **Backend** on Railway: Fastify, Postgres via the managed Railway addon (`DATABASE_URL` injected by Railway), MCP server mounted as an HTTP route group, Anthropic SDK for compilation and (later) live C3 decisions.
- **Tournament execution**: tournaments run in-process inside the backend, wherever it is running. Production: on Railway. Local dev: on the developer's laptop. The same `DATABASE_URL` env var lets a local backend point at the Railway Postgres if you want to run a big batch sim against production data — no separate "local runner" code path needed.
- **Secrets**: `DATABASE_URL` and `ANTHROPIC_API_KEY` on Railway. Mapbox token on Vercel (public, scoped).

## 13. Repo layout

Monorepo with workspaces so engine can be imported by both sides without a publish step:

```
prisoners-dilemma-tournament/
├── package.json              # root workspace
├── tsconfig.base.json
├── docs/
│   ├── architecture.md       # this file
│   └── explainers/           # user-facing docs, consumed by both frontend and MCP
│       ├── 00-what-is-this.md
│       ├── 01-prisoners-dilemma.md
│       ├── 02-iterated-and-why-it-matters.md
│       ├── 03-tournament-modes.md
│       ├── 04-writing-a-bot-dsl.md
│       ├── 05-creating-a-bot.md
│       ├── 06-mcp-guide.md
│       ├── 07-the-arena.md
│       └── 08-axelrod-and-further-reading.md
├── packages/
│   └── engine/               # pure TS, zero deps, ships to both sides
│       ├── src/
│       │   ├── types.ts
│       │   ├── scoring.ts
│       │   ├── interpreter.ts
│       │   ├── match.ts
│       │   ├── tournament.ts
│       │   ├── evolution.ts
│       │   └── presets/
│       │       ├── allc.json
│       │       ├── alld.json
│       │       ├── tft.json
│       │       └── ...
│       └── test/
├── apps/
│   ├── backend/              # Node + Fastify/Hono, on Railway
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── routes/
│   │   │   │   ├── bots.ts
│   │   │   │   ├── tournaments.ts
│   │   │   │   └── compile.ts
│   │   │   ├── mcp/
│   │   │   │   └── server.ts
│   │   │   └── db/
│   │   │       └── schema.sql
│   │   └── test/
│   └── frontend/             # Vite + TS + Mapbox, on Vercel
│       ├── src/
│       │   ├── main.ts
│       │   ├── ui/
│       │   ├── arena/
│       │   │   ├── renderer.ts
│       │   │   ├── sprites/        # SVGs
│       │   │   └── offices/        # map configs
│       │   └── api-client.ts
│       └── index.html
└── README.md
```

## 14. Phase 1 task breakdown (this weekend's target)

The goal of Phase 1 is: **a working headless tournament *and* evolutionary tournament you can drive from a REST API, plus presets and a minimal UI to run one**. No arena, no Claude compilation, no MCP yet. This is the foundation everything else bolts onto.

Concrete tasks in order:

1. **Repo skeleton** — npm workspaces, `tsconfig.base.json`, `engine`, `backend`, `frontend` packages with the layout from §13. Prettier + ESLint + Vitest configured at the root.
2. **Engine types** — `types.ts` with `Move`, `BotView`, `DecisionFn`, `BotSpec`, `BotInstance`. `BotSpec` includes the `kind` discriminator from day one (§4.5).
3. **Engine scoring** — `scoring.ts` with the R/P/T/S constants and `scoreRound(moveA, moveB)`.
4. **Engine interpreter** — `interpreter.ts`: `compile(spec: BotSpec): DecisionFn`. Full DSL primitive set from §4.3 including the Bayesian-lite statistics (`transitionProb`, `classifyOpponent`, window-limited rates, pattern match). Interpreter caches per-round derived stats. Exhaustive unit tests using the preset specs as fixtures.
5. **Engine match** — `match.ts`: `playMatch(a, b, rounds, seed)`. Seeded RNG per instance derived from `(matchSeed, instanceIndex)` so randomness can't leak between opponents. Round-by-round history threading. Unit tests verifying determinism: same inputs → same output, twice.
6. **Engine tournament** — `tournament.ts`: `runTournament(instances, roundsPerMatch, seed, { includeSelfPlay: false })`. Round-robin pairing, self-play excluded by default. Unit test: classic Axelrod result sanity — TFT should beat ALLD head-to-head, ALLC wins a pool of cooperators, etc.
7. **Engine evolutionary runner** — `evolution.ts`: `runEvolutionaryTournament(...)` per §3.6. Strategy-distribution mode (`O(k²)` per generation). Unit test: a pool of `{ TFT: 10, ALLD: 10 }` should show ALLD dominating early then TFT recovering if TFTs can find each other — and `{ ALLD: 10, ALLC: 10 }` should show ALLC going extinct.
8. **Preset bot JSON files** — the initial roster from §4.4, each a `BotSpec` JSON file in `engine/src/presets/`. All eight presets expressed in the DSL, no escape hatch.
9. **Backend skeleton** — Fastify server, Postgres connection pool from `DATABASE_URL`, schema migration from §11 applied on boot, `/health` endpoint that pings the DB.
10. **Backend `bots` routes** — `POST /api/bots` (from preset id or raw spec), `GET /api/bots` (supports `?created_via=preset|nl|mcp`, `?author=`), `GET /api/bots/:id`, `DELETE /api/bots/:id`. Spec validation via JSON Schema.
11. **Backend `tournaments` routes** — `POST /api/tournaments { instances: { botId, count }[], roundsPerMatch, mode: 'round-robin' | 'evolutionary', generations?, seed? }` runs a tournament synchronously via `runTournament` or `runEvolutionaryTournament` and writes results. `GET /api/tournaments/:id` returns the result. `GET /api/tournaments/:id/matches/:matchId` returns the full round-by-round log.
12. **Frontend skeleton** — Vite project, single page, type-safe API client. Shared types imported directly from the `engine` workspace package.
13. **Frontend "run a tournament" UI** — pick bots and counts from the shared library → choose mode (round-robin or evolutionary) → start → render either a leaderboard (round-robin) or a stacked-area-chart of population over generations plus both the gen-1 and dominance leaderboards (evolutionary). Click a match row to see move-by-move replay.
14. **Explainer scaffold** — create the empty `docs/explainers/` directory with the nine filenames from §10.2 as placeholder stubs (title + one-line description, no body). This pins terminology and filenames now; full drafting is deferred to the phase that also builds the "How it works" webpage routes.
15. **End-to-end smoke test** — a script that boots the backend against an ephemeral test schema in Postgres (truncated between runs), seeds the preset bots, runs both a round-robin and a short evolutionary tournament, and asserts the result shapes. Hooked into CI later.

That's Phase 1. When it's green, we have: a working IPD engine with full DSL, presets, both tournament modes, REST API, persistence, and a UI that can run either kind of tournament. Everything else — arena, Claude compiler, MCP, zombies, code-tier bots, and the drafted explainer webpages — is additive and can each be their own phase.

#### Progress as of 2026-04-12 (Phase 1 complete)

- [x] **1–8 Engine.** Types, scoring, interpreter (full DSL incl. Bayesian-lite primitives and `classifyOpponent`), match loop, round-robin and evolutionary runners, eight presets, repo skeleton. 91 unit tests across 8 files.
- [x] **9 Backend skeleton.** Fastify on Railway, Postgres pool from `DATABASE_URL`, migration runner (`migrations/001_init.sql` is the §11 schema), preset seeder run on boot, `/health` pings the DB.
- [x] **10 Backend `bots` routes.** Full CRUD with the JSON Schema validator (15 validator tests). Preset clone path produces a fresh `{presetId}_{random}` id; deletion blocked for preset rows.
- [x] **11 Backend `tournaments` routes.** `POST` runs synchronously and persists `tournaments` + `tournament_entries` + (round-robin only) `matches` rows in a single transaction. `GET /:id` and `GET /:id/matches/:matchId` return the persisted state. Bounds-checked: rounds ∈ [1, 10000], count per entry ∈ [1, 50], generations ∈ [1, 1000], seed in 32-bit unsigned range.
- [x] **12 Frontend skeleton.** Vite + TS + type-safe API client. All payload types imported directly from `@pdt/engine` — no duplicated `BotSpec` / `TournamentResult` / `RoundResult` definitions on the frontend.
- [x] **13 Frontend tournament-running UI.** Vanilla TS, no framework. Bot picker reads `/api/bots` and orders presets first; mode toggle reveals `generations` for evolutionary; round-robin renders a leaderboard plus expandable per-match round-by-round tables; evolutionary renders the gen-1 (Axelrod-faithful) and final-population-share leaderboards side by side, lists `extinctEver`, and draws a hand-rolled stacked-area SVG of population over generations. Stable colour palette keyed off lowercased preset ids — the same hues will reappear as arena sprite tints in Phase 2.
- [x] **14 Explainer scaffold.** Nine stub files in `docs/explainers/` (00–08) with frontmatter (`title`, `slug`), H1, and one-line description. No body content — drafting deferred to Phase 3. Terminology and slugs locked in for URL paths and MCP resource URIs.
- [x] **15 End-to-end smoke test.** `apps/backend/test/tournaments-e2e.test.ts` — 17 tests. Boots Fastify with an ephemeral Postgres schema (created in `beforeAll`, dropped in `afterAll`), seeds presets, runs both a round-robin and an evolutionary tournament via `app.inject()`, asserts full response shapes, verifies `GET` retrieval and per-match lookup. Validation error paths covered: missing mode, empty instances, out-of-range rounds/generations/seed, unknown bot ids, duplicates, insufficient instance counts. Skips gracefully if `DATABASE_URL` is not set.

Live verification on the deployed Railway backend reproduces the textbook results: a TFT×2 / ALLD×2 / GRIM×1 round-robin (200 rounds, seed 42) ties TFT and GRIM at 1598 with both ALLDs at 812; an evolutionary run of TFT/ALLD/ALLC × 10 each (150 rounds × 50 generations, seed 7) gives gen-1 winner ALLD, dominance winner TFT (~79%), ALLD extinct.

**Phase 1 complete as of 2026-04-12.** Total test count: 123 across 10 files (8 engine, 1 backend validator, 1 backend e2e). All green.

#### Notable design choices made during implementation (not in the original spec)

- **Tournament `id` generation reuses the bot id helper** with a parameterised prefix (`generateBotId('tour')` → `tour_xxxxxxxx`). Same alphabet, same length; the function name is mildly misleading but keeping one helper is preferable to a duplicate.
- **Backend rounds-per-match upper bound is 10 000**, count-per-entry upper bound is 50, generations upper bound is 1000. These exist to stop a malformed POST from spinning the Railway hobby instance for minutes; bump if a real workload needs it.
- **Persisted `tournaments.result` is the raw engine result JSONB.** The `GET` endpoint spreads it onto the row metadata so the response shape is identical to the `POST` response (consumers can be agnostic about which call produced the object). The BIGINT seed comes back as a string from the postgres driver and is coerced to `Number` on the way out.
- **Evolutionary `tournament_entries` rows use the gen-1 leaderboard**, not the final-generation leaderboard. Rationale: gen-1 is the Axelrod-faithful ranking that's directly comparable across runs; the dominance winner is exposed as a top-level field on the result instead.
- **Frontend round-by-round replay is capped at the first 200 rounds per match** with a "showing first 200 of N" note. The full data is still in the result object — this is purely a DOM-weight cap for the UI.
- **Frontend client-side validation mirrors the backend bounds** so most errors surface inline next to the run button without a network round-trip. ApiError messages flow through to the same inline element on real failures.

#### Progress as of 2026-04-12 (Phase 2 in progress)

- [x] **1 Mapbox GL JS setup.** Installed mapbox-gl + types, configured `VITE_MAPBOX_TOKEN` env var. Dark-v11 style map centred on 1 Coleman Street, zoom 17.5, bearing -15.
- [x] **2 Shared colour palette.** Extracted `PRESET_COLOURS`, `FALLBACK_COLOURS`, and `colourFor()` to `src/palette.ts`, shared by tournament-runner and arena renderer.
- [x] **3 Arena type definitions.** `src/arena/types.ts` — `ArenaBot`, `PairState`, `ArenaEvent`, `ArenaConfig`, constants for collision radius, cooldown, flash duration, tick intervals.
- [x] **4 SVG bot sprites.** 14 hand-drawn SVG silhouettes (white on transparent, 64×64 viewBox, SDF-compatible for Mapbox `icon-color` tinting): office-worker, courier, barista, professor, builder, jogger, tourist, security-guard, camel, ceo, djgroove, dog-walker, maya-head, scotsman. Loaded as `?raw` imports → data URI → `map.addImage(sdf:true)`.
- [x] **5 Arena simulation core.** `src/arena/simulation.ts` — pure logic (zero Mapbox dependency). Movement with lazy wander retargeting, approximate metres-to-degrees conversion at London's latitude, O(n²) collision detection with cooldown, single-round play via engine's `compile()` + `scoreRound()`, per-pair match history threading, arena event emission. Narration hooks call into `narrate.ts` to trace DSL rules.
- [x] **6 Coleman Street map config.** `src/arena/offices/coleman-street.ts` — centre, zoom, bearing, pitch, bounds.
- [x] **7 Mapbox renderer.** `src/arena/renderer.ts` — bot symbol layer with SDF tinting, score halos (circle layer interpolating radius 4→30 by score), interaction lines (line layer, green/red/yellow by outcome), sprite loading, click handling on sprites, hover handling on interaction lines, narration tooltip overlay.
- [x] **8 Arena runner.** `src/arena/arena-runner.ts` — fetches preset bots from `/api/bots`, compiles client-side, creates `ArenaBot` instances with random positions within bounds, `requestAnimationFrame` game loop, auto-demo with TFT/GRIM/RANDOM/ALLD, caption bar + scoreboard overlays.
- [x] **9 View routing.** `src/main.ts` — arena as full-viewport landing page, nav bar with Arena/Tournament tabs, Tournament tab mounts existing tournament-runner in a scrollable container.
- [x] **10 Bot info side panel.** `src/arena/side-panel.ts` — click a sprite to slide in a panel from the right showing bot name, colour swatch, sprite type, score, rank, strategy summary (opening move, DSL rules in plain English, default action), per-opponent match history with cooperation rates and colour-coded round-by-round grid. Click again or × to close. Refreshes every 500ms while open.
- [x] **11 Interaction tooltip narration.** `src/arena/narrate.ts` — traces DSL rules in the same order as the engine interpreter to explain *why* each bot made its decision (e.g. "Tit for Tat cooperated because opponent cooperated last turn"). Narrations generated at decision time, stored with interaction events, shown as tooltip on hover over interaction lines.
- [x] **12 Persistent caption narrator.** `src/arena/narrator.ts` — smart event filter that prioritises betrayals, leader changes, defection spirals, and score milestones. Rate-limited to avoid caption spam. Fed by ArenaEvents from the simulation; outputs caption text strings rendered in the bottom overlay bar with 5s expiry.
- [x] **13 "What am I looking at?" button.** `src/arena/explainer-overlay.ts` — top-right button opens a full-viewport semi-transparent overlay explaining the arena: the Prisoner's Dilemma payoff matrix, what the colours/lines mean, how to interact (click bots, hover lines, read captions). Self-contained content for Phase 2; Phase 3 will link to the full explainer webpages.
- [x] **14 Arena setup panel.** `src/arena/setup-panel.ts` — gear button below the explainer button opens a slide-in panel with speed presets (0.5×–5×) and per-bot quantity steppers (0–10 instances each, supporting multiple instances of the same strategy per §3.4). "Start Arena" rebuilds the simulation with the chosen roster and config without destroying the Mapbox map. Quick-select buttons: "All ×1", "Clear". Names auto-disambiguated ("TFT (1)", "TFT (2)") when duplicates present.
- [x] **15 Polish pass.** Overflow truncation on bot names in setup panel, flex-shrink on panel sections to prevent footer push-off, tabular-nums on count displays.

#### Notable design choices made during Phase 2

- **Sprite assignment is random at spawn** — `spriteVariant = Math.floor(rng() * SPRITE_NAMES.length)`. Purely cosmetic; the engine doesn't know about sprites.
- **Narration is generated before history is modified** so the `BotView` faithfully represents the state at decision time. The `narrate.ts` module re-evaluates conditions (mirroring the engine interpreter) rather than modifying the engine itself — keeps the engine pure and avoids coupling.
- **Side panel refreshes on a 500ms interval** (not every frame) to avoid DOM thrashing. The game loop continues at full frame rate.
- **Interaction lines are ephemeral** (600ms default). The tooltip shows while hovering a live line; narration data is stored per-line and cleaned up on expiry.
- **Simulation restart preserves the map** — the setup panel's "Start" callback tears down only the game loop, bot state, pairs, active lines, and narrator, then rebuilds them. The Mapbox renderer and DOM scaffolding survive, avoiding an expensive map re-init.

#### Progress as of 2026-04-12 (Phase 3 complete)

- [x] **1 Install `marked` for client-side Markdown rendering.** Added to `apps/frontend` dependencies.
- [x] **2 Draft all nine explainer Markdown files.** Full prose content for 00–08 in `docs/explainers/`. Covers the game, iterated PD, Axelrod's tournaments, tournament modes, DSL reference with worked examples, bot creation flows, MCP guide (placeholder for Phase 5), the arena, and further reading. Hofstadter's *Metamagical Themas* featured prominently; Newcomb's Paradox included in the further reading.
- [x] **3 How It Works view.** `src/views/how-it-works.ts` — loads all `docs/explainers/*.md` files via `import.meta.glob('?raw')`, parses frontmatter, renders Markdown to HTML with `marked`, displays a table of contents with numbered links, and per-page view with prev/next navigation. Dark-themed styles for headings, tables, code blocks, blockquotes.
- [x] **4 Nav bar tab.** Added "How It Works" as a third tab in `main.ts` alongside Arena and Tournament.
- [x] **5 Arena → How It Works link.** The "What am I looking at?" overlay now has a "Read the full How It Works guide →" button that navigates to the How It Works view via a global navigation callback (`__pdtNavigateExplainer`).

#### Notable design choices made during Phase 3

- **Build-time glob, client-side render.** Markdown files are imported as raw strings at build time (Vite `import.meta.glob` with `?raw`), avoiding a runtime fetch. `marked` renders HTML on first mount. This keeps the explainers as the single source of truth (§10.1) while avoiding a build plugin.
- **Frontmatter parsed manually.** A 10-line parser extracts `title` and `slug` from YAML frontmatter, avoiding a dependency on a full YAML parser for two fields.
- **Global navigation callback.** The arena overlay navigates to How It Works via `window.__pdtNavigateExplainer(slug)` — a pragmatic bridge between the arena module (which doesn't know about routing) and main.ts (which does). This will be replaced with proper routing if the app grows.

#### Progress as of 2026-04-12 (Phase 6 complete)

- [x] **1 Zombie types and constants.** `ArenaBot` extended with `isZombie`, `zombieVariant`, `convertedAt`. Two new `ArenaEvent` variants: `zombie_conversion`, `zombie_apocalypse_end`. Speed constants: shambler 5 m/s, infected 35 m/s. `ZombieVariant` type.
- [x] **2 Zombie simulation logic.** `createZombieBot(variant, bounds, rng)` spawns a zombie with dummy spec and appropriate speed. `convertToZombie(bot, variant, now)` converts a living bot — sets `isZombie`, prefixes name with 🧟, replaces `decide` with `() => 'D'`, adjusts speed. `tick()` handles zombie × non-zombie collisions (conversion) and detects apocalypse end (≤1 survivors). Regular collision detection skips zombie pairs.
- [x] **3 Zombie narration.** Narrator handles `zombie_conversion` (priority 5: "X converted Y to the horde!") and `zombie_apocalypse_end` (priority 6: survivor name + survival time, or "no survivors").
- [x] **4 Zombie setup controls.** Setup panel gains a "Zombies" section between Speed and Bots with shambler/infected steppers (0–5 each). `onStart` callback extended with `ZombieSetup` parameter.
- [x] **5 Zombie spawning wired.** Arena runner imports `createZombieBot`, spawns shamblers and infected after regular bots in `startSimulation()`. Caption message includes zombie count when applicable.
- [x] **6 Vite proxy.** Added `/api` → `localhost:3000` proxy to `vite.config.ts` for local development.

#### Notable design choices made during Phase 6

- **Zombies use a dummy BotSpec** — they never play IPD, so they carry a placeholder spec with `kind: 'dsl'` and `default: D`. Their `decide` function is a simple `() => 'D'` closure.
- **Zombie movement uses the same wander logic** as regular bots — they just move at different speeds. No special AI or pathfinding.
- **Conversion is variant-preserving** — a shambler converts victims into shamblers, an infected into infected. No cross-variant conversion.
- **Zombie cap at 5 per variant** in the setup panel. Enough for dramatic effect without overwhelming the arena.

### 14.1 Later phases (sketch, not binding)

Rough order of subsequent phases, each independently shippable:

- ~~**Phase 2 — Arena.**~~ *Done.* Mapbox map, agent sprites, random walks, collisions, arena-as-tutorial landing demo, side panel, narration, setup panel with multi-instance support.
- ~~**Phase 3 — Explainer webpages.**~~ *Done.* All nine explainers drafted, rendered as "How It Works" tab with prev/next nav, arena overlay links through.
- **Phase 4 — Natural-language bot compiler.** *Done.* Anthropic API integration (`@anthropic-ai/sdk`, Sonnet model), `POST /api/compile-bot` route with JSON Schema validation and one retry on failure, frontend "Create Bot" tab with describe → compile → review/edit → save flow.
- **Phase 5 — MCP server.** *Done.* Tools (§7.1): submit_bot, validate_bot_spec, list_my_bots, update_bot, delete_bot, run_tournament, get_leaderboard, get_match_history. Resources (§7.2): pd://docs/*, pd://schema/bot-spec.json, pd://presets/*, pd://scoring — auto-served from `docs/explainers/` and engine presets. Prompts (§7.3): start_building_a_bot, analyse_my_bot_performance. Player creation API + Connect tab in frontend. Streamable HTTP transport at `/mcp`.
- **Phase 6 — Zombies.** *Done.* Shambler and infected variants, conversion mechanics, arena-mode only. See §9 and progress notes below.
- **Phase 7 — Live MCP decisions (C3).** *Done.* Slow-tick arena mode with "Live MCP Mode" toggle in setup panel, per-bot brain-icon live marking, in-memory pending-decision store on backend, REST bridge (`POST/GET /api/arena/pending`, `GET /api/arena/decision/:id`), three new MCP tools (get_pending_decision, submit_decision, list_pending_decisions), 30s timeout with BotSpec fallback, orange waiting visual state on the map.
- **Phase 8 — Code-tier bots.** *Done.* `BotSpec` discriminated union (`DslBotSpec | CodeBotSpec` on `kind` field). Code bots provide a `decide(view)` function as a string, compiled via `new Function('view', code)` with try/catch safety (errors default to C). JSON Schema updated to `oneOf` for two spec shapes. Bot builder gains "Write Code" tab with API reference, local test runner, and syntax check. Arena aesthetics overhauled: light-v11 Mapbox style, pastel theme throughout (nav, scoreboard, caption bar, setup panel, side panel, explainer overlay), uniform bot colour (#7ab8e0) with flash states (green cooperate, red defect, dark green zombie, orange waiting), wider interaction lines (width 8).

- **Phase 9 — Joss, Prober, noisy endings, alternative game types.** *Done.* Two new "occasional defector" presets (Joss: sneaky TFT with 10% random defection; Prober: tests with early defections then falls back to TFT). Noisy ending option (`noisyEnding: boolean`) varies match length ±20% so bots can't predict the last round. Alternative game types: `scoreRound()` parameterised by `Payoffs` object, four preset matrices (Prisoner's Dilemma, Chicken/Hawk-Dove, Stag Hunt, Deadlock) with `GameType` selector in setup panel, tournament API, and MCP server. 10 presets total, 132 tests passing.

- **Phase 10 — 3D buildings, collision, multi-location.** *Done.* 3D fill-extrusion building layer on Mapbox map. Building footprints extracted via `queryRenderedFeatures()` and used as collision geometry — bots bounce off buildings and are funnelled through real streets (ray-casting point-in-polygon). Wander targets and spawn positions avoid building interiors. Location dropdown in setup panel with three LGIM offices: London (1 Coleman St), Dublin (3 Dublin Landings), Chicago (71 S Wacker Dr). Map flies to selected office on arena restart with re-extracted building polygons.

Phases 2 and 3 are the ones that turn "it works" into "colleagues can actually use it". Phases 4 and 5 are what unlock the actual AI Club challenge. 6–10 are the fun.

## 15. Deferred decisions and open questions

Things I've deliberately punted on and want to revisit later, not block on now:

- ~~**Code-tier bots**~~ — *Done (Phase 8).* `BotSpec.kind = "code"` accepted and functional. Sandbox is lightweight (`new Function` with try/catch); full Web Worker / `isolated-vm` isolation deferred unless abuse becomes a concern.
- **Arena fairness for the secondary leaderboard** — collisions are random, so the arena's own ranking is luck-heavy. Acceptable because it's not authoritative, but we might want a "normalised by matches played" column so the arena leaderboard is at least informative.
- **Bot visibility of opponent identity** — `BotView` exposes `opponentInstanceId`. Should bots be able to recognise an opponent across matches (i.e. build reputation)? The classic IPD answer is no — each match is a fresh dyad. v1 ships with no cross-match memory.
- **Depletion / conman mode** — still on the table as a future mode toggle. No engine change needed up front; the scoring module is the only thing that would be touched.
- **Evolutionary variants** — per-individual mode (stochastic, extinction cascades), spatial evolution on the Mapbox arena itself (populations per neighbourhood), noise in replicator dynamics. All future fun; v1 is the strategy-distribution version only.
- **Compilation retry budget** — how many times does the NL→JSON flow re-prompt Claude on validation failure? Leaning: 1 retry, then error. Tunable via env var.
- ~~**C3 live-decision API surface**~~ — *Done (Phase 7).* Slow-tick arena mode, pending-decision polling, 30s timeout with BotSpec fallback.
- ~~**Alternative game types (Chicken, Stag Hunt, Deadlock, etc.)**~~ — *Done (Phase 9).* `scoreRound()` parameterised with `Payoffs` object, `GameType` union type, `GAME_TYPES` preset map. Threaded through `playMatch`, `runTournament`, `runEvolutionaryTournament`, arena simulation, backend API, and MCP server. Game type selector in arena setup panel. Option 2 (renamed moves e.g. Hawk/Dove) and Option 3 (3+ moves e.g. RPS) remain deferred.
- **Zombie origin** — does a zombie spawn from a bot that voluntarily "went zombie", or appear ex nihilo? Cosmetic but affects the UX. Leaning: manual add-button in the arena UI, zombie appears at a random free location.
- **Author-defined classifiers** — the built-in `classifyOpponent()` is frozen to presets (§4.3). A future nice-to-have: let authors *build their own* classifiers as standalone `BotSpec`-fragments and call them by name from another bot. Not v1 — just flagged so we remember the idea.
- ~~**Arena map aesthetics**~~ — *Done (Phase 8).* Switched to light-v11 Mapbox style, full pastel theme conversion across all UI components.
- ~~**Arena obstacles / pathfinding**~~ — *Done (Phase 10).* 3D building extrusions, building footprint collision geometry via `queryRenderedFeatures()`, ray-casting point-in-polygon bounce, multi-location support (London, Dublin, Chicago).

---

**Status**: v1.0 design signed off; **Phases 1–10 complete**. Test count: 132 passing across 9 files. Next up: further refinements, polish, or new features.
