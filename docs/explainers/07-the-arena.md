---
title: The Arena
slug: the-arena
---

# The Arena

The arena is the landing page of this site — a live, visual simulation of bots playing the Prisoner's Dilemma as they wander around a map of 1 Coleman Street, our London office.

It's not a tournament. It's a **spectacle** — designed so a colleague who lands on the site absorbs the rules of the game just by watching for sixty seconds.

## What you're seeing

Bot sprites wander the map on random walks. When two bots come within 30 metres of each other, they play a single round of the Prisoner's Dilemma. The result shows as a coloured line connecting them:

- **Green line** — both cooperated (mutual reward, 3 points each)
- **Red line** — at least one defected (someone got betrayed or both punished)

Lines persist for a few seconds so you can see the pattern of interactions.

## How to interact

- **Click a bot** — opens the side panel showing its name, strategy, score, rank, and a round-by-round history against each opponent.
- **Hover an interaction line** — shows a tooltip explaining *why* each bot made its choice: "Tit for Tat cooperated because opponent cooperated last turn."
- **Watch the caption bar** — the bottom strip narrates notable events: first betrayals, lead changes, defection spirals, score milestones.
- **Check the scoreboard** — top-left corner shows cumulative scores.

## The setup panel

Click the gear icon to configure a custom run:

- **Pick your bots** — choose which strategies to include, and how many copies of each. Want to see 5 copies of TFT vs 5 copies of ALLD? Go for it.
- **Set the speed** — from 0.5x (meditative) to 5x (fast-forward).
- **Hit Start** — the simulation restarts with your roster. The map stays; only the bots reset.

## Arena vs tournament

The arena and the tournament use the **same engine** — same decision logic, same payoff matrix, same rules. The difference is how bots are paired:

| | Tournament | Arena |
|--|-----------|-------|
| **Pairing** | Every bot plays every other bot | Bots play when they collide on the map |
| **Determinism** | Seeded, reproducible | Depends on movement, timing, collisions |
| **Purpose** | Authoritative ranking | Visual teaching tool, spectacle |

The tournament decides the winner. The arena decides the vibe.

## Why it's on a map

The map is 1 Coleman Street, London — the LGIM office where the AI Club meets. It's a bit of fun, but it also serves a purpose: the spatial layout means bots don't interact with every other bot equally. Bots that happen to be near each other play more often, creating local dynamics that a round-robin can't capture.

Future versions may add obstacles (walls, corridors) and additional office maps (Dublin, Chicago) to create different interaction patterns.
