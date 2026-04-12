// Shared colour palette for preset bots.
//
// Keyed by the *persisted* lowercased bot id (e.g. 'tft', 'generous_tft').
// Used by both the tournament-runner leaderboard and the arena sprite
// tints so the two teach the same visual language.

export const PRESET_COLOURS: Record<string, string> = {
  tft: '#2f7dd1',
  tf2t: '#5fb6e0',
  alld: '#e04646',
  allc: '#62c46b',
  grim: '#7a1f1f',
  pavlov: '#d18a2f',
  generous_tft: '#3fae9b',
  random: '#9b9b9b',
};

// Fallback palette for non-preset bots (NL-compiled, MCP-submitted,
// etc., once Phase 4+ lands). Cycled in stable order so the same bot
// gets the same colour across renders within a single result.
export const FALLBACK_COLOURS = [
  '#9966cc',
  '#d96fa3',
  '#7c8b00',
  '#4a90e2',
  '#bd5757',
  '#3f6f4f',
  '#a8763a',
  '#566677',
];

export function colourFor(botId: string, fallbackIndex: number): string {
  return (
    PRESET_COLOURS[botId] ??
    FALLBACK_COLOURS[fallbackIndex % FALLBACK_COLOURS.length]!
  );
}
