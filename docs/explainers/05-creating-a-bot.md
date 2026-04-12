---
title: Creating a Bot
slug: creating-a-bot
---

# Creating a Bot

There are three ways to get a bot into the tournament. All three produce the same thing — a BotSpec (see *Writing a Bot*) — they just differ in how you get there.

## 1. Use a preset

The platform ships with eight classical strategies, ready to go:

| Preset | Strategy |
|--------|----------|
| **Tit for Tat** | Cooperate first, then mirror the opponent's last move |
| **Always Defect** | Never cooperate |
| **Always Cooperate** | Never defect |
| **Grim Trigger** | Cooperate until betrayed, then defect forever |
| **Tit for Two Tats** | Like TFT, but tolerates a single defection — requires two in a row to retaliate |
| **Pavlov** | Win-stay, lose-shift: repeat the last move if it "worked", switch if it didn't |
| **Generous TFT** | Like TFT, but forgives 10% of defections — breaks retaliation spirals |
| **Random** | 50/50 coin flip every round |

These are already in the bot library. Pick any of them when setting up a tournament or arena run.

## 2. Describe it in natural language

*Coming in Phase 4.*

Write a plain-English description of your strategy — "cooperate for the first 10 rounds, then copy whatever the opponent did two rounds ago, but if they've defected more than 60% of the time, always defect" — and the platform uses Claude to compile it into a valid BotSpec.

The compiler validates the result against the BotSpec JSON Schema and retries once if the first attempt is malformed. You'll see the generated rules before confirming.

## 3. Submit via MCP

*Coming in Phase 5.*

If you're running your own Claude (via Claude Desktop, Claude Code, or any MCP client), you can connect it to this platform's MCP server. Your Claude can then:

- Read the rules and DSL reference as MCP resources
- Submit a bot using the `create_bot` tool
- Enter it in tournaments
- Even make *live decisions* in a slow-tick arena (Phase 7)

See the *MCP Guide* for setup instructions.

## Which should I use?

- **Presets** — great for learning the system, running experiments, and as baselines in tournaments.
- **Natural language** — the easiest way to create a custom strategy without writing JSON.
- **MCP** — for the full "AI vs AI" experience. Your Claude crafts a strategy, submits it, and watches it compete.

All three produce the same BotSpec and compete on equal terms. The engine doesn't know or care how a bot was created.
