---
title: Writing a Bot (DSL)
slug: writing-a-bot-dsl
---

# Writing a Bot (DSL)

Every bot in this platform is defined as a **BotSpec** — a JSON object with three parts:

```
{
  "initial": "C",         // what to play on round 1
  "rules": [ ... ],       // ordered list of if-then rules
  "default": "C"          // what to play if no rule matches
}
```

On each round, the engine walks the rules top to bottom. The first rule whose condition is true determines the move. If no rule fires, the default is used.

## Example: Tit for Tat

```json
{
  "initial": "C",
  "rules": [
    { "if": { "type": "opponentLastMove", "move": "D" }, "then": "D" }
  ],
  "default": "C"
}
```

Cooperate first. If the opponent defected last round, defect. Otherwise cooperate.

## Example: Grim Trigger

```json
{
  "initial": "C",
  "rules": [
    { "if": { "type": "longestRun", "of": "opponent", "move": "D", "op": "gte", "value": 1 }, "then": "D" }
  ],
  "default": "C"
}
```

Cooperate until the opponent defects even once, then defect forever. The `longestRun` condition checks whether the opponent has *ever* had a run of 1 or more defections — once true, it stays true.

## Example: Pavlov (Win-Stay, Lose-Shift)

```json
{
  "initial": "C",
  "rules": [
    { "if": { "type": "and", "conditions": [
        { "type": "myLastMove", "move": "C" },
        { "type": "opponentLastMove", "move": "C" }
      ]}, "then": "C" },
    { "if": { "type": "and", "conditions": [
        { "type": "myLastMove", "move": "D" },
        { "type": "opponentLastMove", "move": "D" }
      ]}, "then": "C" }
  ],
  "default": "D"
}
```

If we both made the same choice last round (CC or DD), cooperate. Otherwise defect. This is the "win-stay, lose-shift" heuristic — repeat what worked, change what didn't.

## Condition reference

| Type | What it checks |
|------|---------------|
| `always` | Always true |
| `and` / `or` / `not` | Logical combinators |
| `opponentLastMove` | Opponent's last move was C or D |
| `myLastMove` | My last move was C or D |
| `round` | Current round number (with comparison operator) |
| `myScore` / `opponentScore` | Cumulative score (with comparison) |
| `opponentDefectionRate` | Fraction of opponent's moves that were D (optional rolling `window`) |
| `opponentCooperationRate` | Fraction of opponent's moves that were C |
| `myDefectionRate` / `myCooperationRate` | Same, for your own history |
| `consecutiveDefections` / `consecutiveCooperations` | Current streak length (with comparison) |
| `longestRun` | Longest consecutive run of a move by either player |
| `patternInLastN` | Match a specific sequence in recent history |
| `classifyOpponent` | Identify the opponent as a known preset strategy |
| `transitionProb` / `myTransitionProb` | Probability of switching between moves |
| `random` | Probabilistic choice (seeded RNG) |

All numeric conditions use a comparison operator (`eq`, `neq`, `lt`, `lte`, `gt`, `gte`) and a `value`.

## Moves can be random too

Both `initial` and `then` can be a random choice instead of a fixed move:

```json
{ "type": "random", "weights": { "C": 9, "D": 1 } }
```

This cooperates 90% of the time — useful for building "generous" or "noisy" strategies.

## Tips for strategy design

- **Start nice.** Strategies that cooperate on round 1 tend to outperform those that don't — they unlock mutual cooperation with other nice strategies.
- **Retaliate.** If you never punish defection, you'll be exploited.
- **Forgive.** If you never stop retaliating, you'll get stuck in mutual defection spirals.
- **Keep it simple.** Axelrod's tournaments consistently showed that simple, readable strategies beat clever ones. Your opponent can only cooperate with you if they can *learn* your pattern.
