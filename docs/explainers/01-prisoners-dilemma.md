---
title: The Prisoner's Dilemma
slug: prisoners-dilemma
---

# The Prisoner's Dilemma

Two suspects are arrested and held in separate cells. The police offer each the same deal: betray the other, or stay silent. Neither can see what the other chooses.

That's the original story, but we don't need the crime drama. Strip it down to its essence: **two players, two choices, one simultaneous decision.**

## The payoff matrix

Each player independently picks **Cooperate** (C) or **Defect** (D). The payoffs are:

|  | They cooperate | They defect |
|--|:-:|:-:|
| **You cooperate** | You: **3**, Them: **3** | You: **0**, Them: **5** |
| **You defect** | You: **5**, Them: **0** | You: **1**, Them: **1** |

The four outcomes have traditional names:

- **Reward (R = 3)** — both cooperate. The best collective outcome.
- **Temptation (T = 5)** — you defect while they cooperate. The best *individual* outcome — for you.
- **Sucker's payoff (S = 0)** — you cooperate while they defect. The worst place to be.
- **Punishment (P = 1)** — both defect. Better than being the sucker, but worse than mutual cooperation.

## Why defection is "rational"

Look at it from your side. If they cooperate, you get 3 by cooperating or 5 by defecting — defecting is better. If they defect, you get 0 by cooperating or 1 by defecting — defecting is *still* better.

No matter what the other player does, defecting gives you a higher score. Defection is the *dominant strategy*. A coldly rational player always defects.

## The dilemma

But here's the catch: if both players reason this way, they both defect and each scores 1. If they'd both cooperated, they'd each have scored 3. **Individual rationality leads to collective disaster.**

That's the dilemma. It's not a puzzle to solve — it's a genuine tension between self-interest and mutual benefit. And it shows up everywhere: arms races, climate negotiations, office politics, open-source maintenance, even whether to vaccinate.

## A walked example

Round 1. Alice cooperates, Bob defects. Alice scores 0 (sucker), Bob scores 5 (temptation).

Round 2. Alice defects in retaliation, Bob cooperates. Alice scores 5, Bob scores 0. They're now even at 5 each.

Round 3. Both cooperate. Both score 3. Running totals: Alice 8, Bob 8.

Round 4. Both defect. Both score 1. Running totals: Alice 9, Bob 9.

Notice how rounds of mutual cooperation (3 + 3 = 6 total points created) generate more *total* value than rounds of mutual defection (1 + 1 = 2). Cooperation makes the pie bigger. The question is whether you can sustain it.

That question only gets interesting when the game *repeats* — which is the subject of the next page.
