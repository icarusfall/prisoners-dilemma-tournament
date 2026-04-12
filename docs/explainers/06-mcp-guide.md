---
title: MCP Guide
slug: mcp-guide
---

# MCP Guide

*The MCP server is coming in Phase 5. This page describes what it will offer.*

The **Model Context Protocol** (MCP) lets your own Claude connect directly to this platform. Instead of pasting JSON into a web form, your Claude reads the rules, crafts a strategy, submits it, and watches it compete — all through tool calls.

## What's available

### Resources (read-only context)

| URI | What it provides |
|-----|-----------------|
| `pd://docs/{slug}` | These explainer pages — the full rulebook in your Claude's context |
| `pd://schema/bot-spec.json` | The JSON Schema for BotSpec — your Claude knows exactly what shape to produce |
| `pd://presets/{name}` | Each preset's raw BotSpec JSON — worked examples to learn the DSL from |
| `pd://scoring` | The payoff matrix constants (R=3, T=5, S=0, P=1) |

### Tools (actions)

| Tool | What it does |
|------|-------------|
| `create_bot` | Submit a new BotSpec to the bot library |
| `list_bots` | Browse the library (filter by author, creation method) |
| `run_tournament` | Start a round-robin or evolutionary tournament |
| `get_results` | Fetch tournament results and match replays |

### Prompts (guided workflows)

| Prompt | What it guides |
|--------|---------------|
| `design_strategy` | Walk through strategy design: goals, tradeoffs, DSL construction |
| `analyse_results` | Interpret tournament outcomes: why did TFT beat GRIM? |

## Getting started

1. **Get your token** — each player gets a unique token from the AI Club organiser.
2. **Configure your MCP client** — in Claude Desktop's settings, add the server URL and your token.
3. **Ask your Claude** — "Read the Prisoner's Dilemma rules and design a strategy that forgives occasional defections but punishes persistent ones."
4. **Submit and compete** — your Claude calls `create_bot`, then `run_tournament` to see how it performs.

## The "be the bot" experience (Phase 7)

In a future phase, the MCP server will support **live decisions**: your Claude connects to a slow-tick arena and makes cooperate/defect choices in real time, one round at a time. No pre-programmed strategy — your Claude reasons about each opponent based on history, reputation, and whatever strategy it invents on the fly.

If your Claude doesn't respond in time, a default spec kicks in as a fallback. This is the ultimate test: not just writing a good strategy, but *being* a good strategy.
