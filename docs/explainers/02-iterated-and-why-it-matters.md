---
title: Iterated and Why It Matters
slug: iterated-and-why-it-matters
---

# Iterated and Why It Matters

In a one-shot Prisoner's Dilemma, defection is the only rational move. End of story.

But what if you're going to play the same opponent again? And again? And again — for hundreds of rounds? Now the future matters. Your choices have *consequences*, because the other player can see what you did and adjust.

This is the **Iterated Prisoner's Dilemma** (IPD), and it changes everything.

## The shadow of the future

When you know you'll meet again, defecting today risks retaliation tomorrow. Cooperating today signals that you're trustworthy and invites cooperation in return. Strategies can *evolve*: retaliate against betrayal, forgive occasional mistakes, build reputations.

The IPD isn't a single decision — it's a *relationship*.

## Axelrod's tournament (1980)

In 1980, political scientist Robert Axelrod ran what became the most famous computer tournament in the social sciences. He invited game theorists, mathematicians, and computer scientists to submit strategies for a round-robin IPD tournament. Each strategy would play every other strategy for 200 rounds.

Fourteen entries arrived, ranging from deviously complex to disarmingly simple. The winner? **Tit for Tat**, submitted by psychologist Anatol Rapoport. Its entire strategy:

1. Cooperate on the first move.
2. After that, do whatever the opponent did last round.

Four lines of logic beat every sophisticated scheme in the tournament.

Axelrod ran a second tournament, this time with 63 entries — many submitted by people who'd studied the first tournament's results. Tit for Tat won again.

## Why Tit for Tat works

Axelrod identified four properties shared by the most successful strategies:

- **Nice** — never be the first to defect.
- **Retaliatory** — punish defection immediately.
- **Forgiving** — return to cooperation once the opponent does.
- **Clear** — be predictable enough that opponents can learn to cooperate with you.

Tit for Tat has all four. It's never the first to betray, it punishes instantly, it forgives instantly, and its logic is transparent.

## The Hofstadter connection

Douglas Hofstadter — of *Gödel, Escher, Bach* fame — wrote a series of columns about the IPD in *Scientific American* in 1983, later collected in his book *Metamagical Themas*. These columns (titled "Irrationality Is the Square Root of All Evil" and its sequels) are some of the most lucid writing on the subject.

Hofstadter was fascinated by a deeper question: can "rational" agents ever cooperate, even in a one-shot game, if they recognise that the other agent reasons the same way they do? He called this **superrationality** — the idea that if two identical reasoners face the same problem, they should arrive at the same answer, and therefore they should cooperate (since mutual cooperation beats mutual defection).

It's a controversial idea — mainstream game theory rejects it — but it's a beautiful thought experiment about what rationality *should* mean. Hofstadter ran his own IPD tournament among *Scientific American* readers, and the results (messy, human, irrational) made for compelling reading.

## The ecosystem view

Axelrod didn't stop at round-robin scores. He also ran **evolutionary** simulations: strategies that scored well got more copies of themselves in the next generation; strategies that scored poorly shrank. Over hundreds of generations, the population dynamics told a different story from the single-round-robin leaderboard.

In evolutionary terms, Always Defect dominates early (it exploits naive cooperators), but as cooperators die off, the defectors have no one left to exploit. Meanwhile, Tit for Tat thrives in clusters of cooperators, and over time the cooperative strategies dominate. The generation-1 winner and the long-run dominant strategy are often different — we'll see this in our own tournaments.

This is the real lesson of the IPD: in a world where interactions repeat and reputations matter, **nice guys don't finish last**.
