---
title: Tournament Modes
slug: tournament-modes
---

# Tournament Modes

This platform runs two kinds of tournament, each answering a different question.

## Round-robin

In a round-robin tournament, every bot plays every other bot for a fixed number of rounds (typically 200). Each pairing produces a score for both sides, and the **leaderboard** ranks bots by total points.

This is the format Axelrod used. It answers: **which strategy scores best against the whole field?**

Key details:

- Self-play is excluded by default — a bot doesn't play against itself.
- You can include multiple copies of the same strategy. Each gets a distinct instance and is tracked independently.
- Matches are seeded deterministically — run the same tournament twice with the same seed and you'll get identical results.

## Evolutionary

An evolutionary tournament starts with a **population** — say, 10 copies each of TFT, ALLD, and ALLC. Then it runs generations:

1. **Play** — every strategy plays every other (including itself) in a round-robin.
2. **Score** — each strategy's *fitness* is its expected score against a randomly chosen opponent from the current population.
3. **Reproduce** — strategies with above-average fitness grow; those below average shrink. This uses *replicator dynamics*: a strategy's population share scales by the ratio of its fitness to the mean.
4. **Extinction** — any strategy that drops below 1% of the population is eliminated.
5. **Repeat** for the next generation.

Over many generations, the population composition shifts. Strategies that thrive in diverse environments survive; strategies that only exploit specific opponents die out as those opponents disappear.

## Why the two winners can disagree

The evolutionary tournament reports two winners:

- **Generation-1 winner** — the strategy that tops the leaderboard in the very first round-robin. This is the Axelrod-style answer.
- **Dominance winner** — the strategy with the largest population share at the end.

These are often *different*. A classic example:

- ALLD wins generation 1 because it exploits naive cooperators (ALLC gets 0 against it, while ALLD gets 5).
- But as ALLC dies off, ALLD has no more suckers to exploit. It scores only 1 against other ALLDs.
- TFT, meanwhile, scores 3 against other TFTs and retaliates against ALLD. Over generations, TFT's population share grows while ALLD's collapses.

The generation-1 winner thrives in a naive world. The dominance winner thrives in the world it *creates*. That's the evolutionary insight: **the environment isn't fixed — your strategy changes it.**

Try it yourself: run an evolutionary tournament with TFT, ALLD, and ALLC (10 copies each, 150 rounds, 50 generations) and watch the population dynamics unfold.
