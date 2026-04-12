// @pdt/frontend — tournament-runner view (Phase 1 task 13).
//
// One vanilla-TS module that owns the entire "configure → run →
// inspect" loop. Mounted by main.ts into a single root element. The
// view is split into three logical phases:
//
//   1. mountTournamentRunner: load /api/bots once, render the form.
//   2. handleSubmit: read form state, call POST /api/tournaments,
//      hand the response off to the result renderer.
//   3. renderResult: branch on `mode` and produce either the
//      round-robin leaderboard + per-match replay or the evolutionary
//      twin-leaderboards + hand-rolled stacked-area SVG.
//
// Deliberately no framework. The page only needs to re-render in two
// places (the inline error string near the run button, and the
// `#result` panel after each successful run), so a couple of
// `innerHTML` swaps are simpler than wiring up a renderer.
//
// Block tests for this view are deferred to Phase 1 task 15 — manual
// smoke against the Railway backend is the verification surface for
// now.

import { PRESETS } from '@pdt/engine';
import type {
  EvolutionaryResult,
  Generation,
  LeaderboardEntry,
  MatchResult,
  RoundResult,
  TournamentResult,
} from '@pdt/engine';

import {
  ApiError,
  createTournament,
  listBots,
  type BotRecord,
  type CreateTournamentInstance,
  type CreateTournamentRequest,
  type TournamentRecord,
} from '../api.js';
import { colourFor } from '../palette.js';

// ---------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------

export async function mountTournamentRunner(root: HTMLElement): Promise<void> {
  root.innerHTML = `<p style="color:#555;">Loading bot library…</p>`;

  let bots: BotRecord[];
  try {
    bots = orderBots(await listBots());
  } catch (err) {
    root.innerHTML = `<p style="color: crimson;">Failed to load bots: ${escapeHtml(formatError(err))}</p>`;
    return;
  }

  renderForm(root, bots);
}

// ---------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------

function renderForm(root: HTMLElement, bots: BotRecord[]): void {
  root.innerHTML = `
    <form id="run-form" style="display:flex; flex-direction:column; gap:1rem;">
      <fieldset style="border:1px solid #ddd; padding:0.75rem 1rem;">
        <legend style="font-weight:600;">Bot library</legend>
        <p style="margin:0 0 0.5rem; color:#666; font-size:0.9rem;">
          Set a count for each bot you want in the run. In <em>round-robin</em>
          this is the number of copies; in <em>evolutionary</em> it is the
          starting population weight.
        </p>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid #ddd;">
              <th style="padding:0.25rem 0.5rem;">Bot</th>
              <th style="padding:0.25rem 0.5rem;">Description</th>
              <th style="padding:0.25rem 0.5rem; width:6rem;">Count</th>
            </tr>
          </thead>
          <tbody>
            ${bots
              .map((b, idx) => {
                const swatch = colourFor(b.id, idx);
                return `
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:0.4rem 0.5rem;">
                      <span style="display:inline-block;width:0.8rem;height:0.8rem;
                                   background:${swatch};border-radius:2px;
                                   margin-right:0.4rem;vertical-align:middle;"></span>
                      <strong>${escapeHtml(b.name)}</strong><br>
                      <code style="color:#888;font-size:0.85rem;">${escapeHtml(b.id)}</code>
                    </td>
                    <td style="padding:0.4rem 0.5rem; color:#444; font-size:0.9rem;">
                      ${escapeHtml(b.source_description ?? '')}
                    </td>
                    <td style="padding:0.4rem 0.5rem;">
                      <input type="number" data-bot-id="${escapeHtml(b.id)}"
                             min="0" max="50" step="1" value="0"
                             style="width:5rem; padding:0.25rem;">
                    </td>
                  </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </fieldset>

      <fieldset style="border:1px solid #ddd; padding:0.75rem 1rem;">
        <legend style="font-weight:600;">Mode</legend>
        <label style="margin-right:1.5rem;">
          <input type="radio" name="mode" value="round-robin" checked>
          Round-robin
        </label>
        <label>
          <input type="radio" name="mode" value="evolutionary">
          Evolutionary
        </label>
      </fieldset>

      <fieldset style="border:1px solid #ddd; padding:0.75rem 1rem;">
        <legend style="font-weight:600;">Parameters</legend>
        <div style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:center;">
          <label>
            Rounds per match:
            <input type="number" name="roundsPerMatch" min="1" max="10000"
                   step="1" value="200" style="width:6rem;">
          </label>
          <label data-evo-only style="display:none;">
            Generations:
            <input type="number" name="generations" min="1" max="1000"
                   step="1" value="50" style="width:6rem;">
          </label>
          <label>
            Seed (optional):
            <input type="number" name="seed" min="0" step="1"
                   placeholder="random" style="width:8rem;">
          </label>
        </div>
      </fieldset>

      <div style="display:flex; align-items:center; gap:1rem;">
        <button type="submit" style="padding:0.5rem 1.25rem; font-size:1rem;
                cursor:pointer;">
          Run tournament
        </button>
        <span id="run-status" style="color:#555;"></span>
      </div>
      <p id="run-error" style="color: crimson; margin:0;"></p>
    </form>

    <section id="result" style="margin-top:1.5rem;"></section>
  `;

  const form = root.querySelector<HTMLFormElement>('#run-form')!;
  const evoLabels = root.querySelectorAll<HTMLLabelElement>('[data-evo-only]');
  const modeRadios = root.querySelectorAll<HTMLInputElement>('input[name="mode"]');
  const roundsInput = root.querySelector<HTMLInputElement>('input[name="roundsPerMatch"]')!;

  // Switch the rounds-per-match default when mode changes — 200 reads
  // as the canonical Axelrod-style match length for round-robin, and
  // 150 is what the engine docs use for the evolutionary fixture. Only
  // overwrite if the user hasn't typed something else.
  let roundsTouched = false;
  roundsInput.addEventListener('input', () => {
    roundsTouched = true;
  });
  modeRadios.forEach((r) => {
    r.addEventListener('change', () => {
      const isEvo = (form.elements.namedItem('mode') as RadioNodeList).value === 'evolutionary';
      evoLabels.forEach((el) => {
        el.style.display = isEvo ? '' : 'none';
      });
      if (!roundsTouched) {
        roundsInput.value = isEvo ? '150' : '200';
      }
    });
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void handleSubmit(root, form);
  });
}

// ---------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------

async function handleSubmit(root: HTMLElement, form: HTMLFormElement): Promise<void> {
  const errorEl = root.querySelector<HTMLElement>('#run-error')!;
  const statusEl = root.querySelector<HTMLElement>('#run-status')!;
  const resultEl = root.querySelector<HTMLElement>('#result')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  errorEl.textContent = '';
  statusEl.textContent = '';

  // Read instance counts straight off the form. Skip zeros so the
  // backend never sees padding entries.
  const countInputs = form.querySelectorAll<HTMLInputElement>('input[data-bot-id]');
  const instances: CreateTournamentInstance[] = [];
  countInputs.forEach((inp) => {
    const count = Number(inp.value);
    if (Number.isFinite(count) && count > 0) {
      instances.push({ botId: inp.dataset.botId!, count });
    }
  });

  const formData = new FormData(form);
  const mode = (formData.get('mode') as 'round-robin' | 'evolutionary') ?? 'round-robin';
  const roundsPerMatch = Number(formData.get('roundsPerMatch'));
  const generationsRaw = formData.get('generations');
  const seedRaw = formData.get('seed');

  // ----- client-side validation -----
  if (instances.length === 0) {
    errorEl.textContent = 'Pick at least one bot with a non-zero count.';
    return;
  }
  if (mode === 'round-robin') {
    const total = instances.reduce((s, i) => s + i.count, 0);
    if (total < 2) {
      errorEl.textContent = 'Round-robin needs at least 2 total instances.';
      return;
    }
  } else {
    if (instances.length < 2) {
      errorEl.textContent = 'Evolutionary mode needs at least 2 distinct bots.';
      return;
    }
  }
  if (!Number.isInteger(roundsPerMatch) || roundsPerMatch < 1) {
    errorEl.textContent = 'Rounds per match must be a positive integer.';
    return;
  }

  const body: CreateTournamentRequest = {
    mode,
    roundsPerMatch,
    instances,
  };
  if (mode === 'evolutionary') {
    const generations = Number(generationsRaw);
    if (!Number.isInteger(generations) || generations < 1) {
      errorEl.textContent = 'Generations must be a positive integer.';
      return;
    }
    body.generations = generations;
  }
  if (seedRaw !== null && String(seedRaw).trim() !== '') {
    const seed = Number(seedRaw);
    if (!Number.isInteger(seed) || seed < 0) {
      errorEl.textContent = 'Seed must be a non-negative integer or blank.';
      return;
    }
    body.seed = seed;
  }

  // ----- run -----
  button.disabled = true;
  statusEl.textContent = 'Running…';
  resultEl.innerHTML = '';

  try {
    const t = await createTournament(body);
    statusEl.textContent = `Done — id ${t.id}, seed ${t.seed}`;
    renderResult(resultEl, t);
  } catch (err) {
    statusEl.textContent = '';
    errorEl.textContent = formatError(err);
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Result rendering — branch on mode
// ---------------------------------------------------------------------

function renderResult(target: HTMLElement, t: TournamentRecord): void {
  if (t.mode === 'round-robin') {
    renderRoundRobinResult(target, t);
  } else {
    renderEvolutionaryResult(target, t);
  }
}

// ----- round-robin -----

function renderRoundRobinResult(
  target: HTMLElement,
  t: TournamentResult & { id: string },
): void {
  const leaderboardHtml = renderLeaderboardTable(t.leaderboard, {
    showInstance: true,
  });
  const matchesHtml = t.matches.map(renderMatchDetails).join('');

  target.innerHTML = `
    <h2 style="font-size:1.2rem; margin-bottom:0.25rem;">
      Round-robin result
    </h2>
    <p style="color:#666; margin-top:0;">
      ${t.matches.length} match${t.matches.length === 1 ? '' : 'es'},
      ${t.roundsPerMatch} rounds each, seed ${t.seed}.
      Self-play ${t.includeSelfPlay ? 'included' : 'excluded'}.
    </p>

    <h3 style="font-size:1rem; margin-top:1rem;">Leaderboard</h3>
    ${leaderboardHtml}

    <h3 style="font-size:1rem; margin-top:1.25rem;">Matches</h3>
    <p style="color:#666; margin:0 0 0.5rem; font-size:0.9rem;">
      Click a match to expand its round-by-round replay.
    </p>
    <div>${matchesHtml}</div>
  `;
}

function renderLeaderboardTable(
  rows: readonly LeaderboardEntry[],
  opts: { showInstance: boolean },
): string {
  const headerCols = opts.showInstance
    ? `<th>Rank</th><th>Bot</th><th>Instance</th><th>Total</th><th>Avg</th><th>Matches</th>`
    : `<th>Rank</th><th>Bot</th><th>Total</th><th>Avg</th><th>Matches</th>`;
  const body = rows
    .map((r, idx) => {
      const swatch = colourFor(r.botId, idx);
      const cells = opts.showInstance
        ? `<td>${r.rank}</td>
           <td><span style="display:inline-block;width:0.7rem;height:0.7rem;
                background:${swatch};border-radius:2px;margin-right:0.4rem;
                vertical-align:middle;"></span>${escapeHtml(r.botId)}</td>
           <td><code style="color:#666;">${escapeHtml(r.instanceId)}</code></td>
           <td style="text-align:right;">${r.totalScore}</td>
           <td style="text-align:right;">${r.averageScore.toFixed(2)}</td>
           <td style="text-align:right;">${r.matchesPlayed}</td>`
        : `<td>${r.rank}</td>
           <td><span style="display:inline-block;width:0.7rem;height:0.7rem;
                background:${swatch};border-radius:2px;margin-right:0.4rem;
                vertical-align:middle;"></span>${escapeHtml(r.botId)}</td>
           <td style="text-align:right;">${r.totalScore.toFixed(2)}</td>
           <td style="text-align:right;">${r.averageScore.toFixed(2)}</td>
           <td style="text-align:right;">${r.matchesPlayed}</td>`;
      return `<tr style="border-bottom:1px solid #f0f0f0;">${cells}</tr>`;
    })
    .join('');
  return `
    <table style="width:100%; border-collapse:collapse; font-size:0.95rem;">
      <thead>
        <tr style="text-align:left; border-bottom:1px solid #ddd;">${headerCols}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderMatchDetails(m: MatchResult): string {
  const winner =
    m.totalA > m.totalB
      ? escapeHtml(m.instanceA)
      : m.totalB > m.totalA
        ? escapeHtml(m.instanceB)
        : 'tie';
  return `
    <details style="border:1px solid #eee; margin-bottom:0.25rem; padding:0.25rem 0.5rem;">
      <summary style="cursor:pointer;">
        <code>${escapeHtml(m.instanceA)}</code> vs
        <code>${escapeHtml(m.instanceB)}</code>
        — <strong>${m.totalA}</strong> – <strong>${m.totalB}</strong>
        <span style="color:#666;"> (winner: ${winner}, seed ${m.seed})</span>
      </summary>
      ${renderRoundsTable(m.rounds)}
    </details>
  `;
}

function renderRoundsTable(rounds: readonly RoundResult[]): string {
  // Cap the visible rounds — 10 000 cells of DOM is wasteful for the
  // common case of glancing at the first few rounds. Anything past
  // the cap is summarised on the final row.
  const CAP = 200;
  const shown = rounds.slice(0, CAP);
  const cellStyle = (m: 'C' | 'D'): string =>
    m === 'C'
      ? 'background:#dff5df;color:#1d621d;'
      : 'background:#fae0e0;color:#7a1f1f;';
  const body = shown
    .map(
      (r, i) => `
        <tr>
          <td style="padding:0.1rem 0.4rem; color:#888;">${i + 1}</td>
          <td style="padding:0.1rem 0.4rem; ${cellStyle(r.moveA)}">${r.moveA}</td>
          <td style="padding:0.1rem 0.4rem; ${cellStyle(r.moveB)}">${r.moveB}</td>
          <td style="padding:0.1rem 0.4rem; text-align:right;">${r.scoreA}</td>
          <td style="padding:0.1rem 0.4rem; text-align:right;">${r.scoreB}</td>
        </tr>`,
    )
    .join('');
  const truncatedNote =
    rounds.length > CAP
      ? `<p style="color:#888; font-size:0.85rem; margin:0.25rem 0;">
           Showing first ${CAP} of ${rounds.length} rounds.
         </p>`
      : '';
  return `
    <div style="margin-top:0.5rem;">
      ${truncatedNote}
      <table style="border-collapse:collapse; font-size:0.85rem; font-family:ui-monospace,monospace;">
        <thead>
          <tr style="color:#666;">
            <th style="padding:0.1rem 0.4rem;">#</th>
            <th style="padding:0.1rem 0.4rem;">A</th>
            <th style="padding:0.1rem 0.4rem;">B</th>
            <th style="padding:0.1rem 0.4rem;">+A</th>
            <th style="padding:0.1rem 0.4rem;">+B</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

// ----- evolutionary -----

function renderEvolutionaryResult(
  target: HTMLElement,
  t: EvolutionaryResult & { id: string },
): void {
  const generations = t.generations;
  const firstGen = generations[0];
  const lastGen = generations[generations.length - 1];
  if (!firstGen || !lastGen) {
    target.innerHTML = `<p style="color:crimson;">Empty evolutionary result — no generations returned.</p>`;
    return;
  }

  const finalLeaderboard = buildPopulationShareLeaderboard(lastGen);
  const extinctNote = t.extinctEver.length
    ? `<p style="color:#666; margin-top:0.5rem;">
         Extinct at some point: ${t.extinctEver
           .map((id) => `<code>${escapeHtml(id)}</code>`)
           .join(', ')}.
       </p>`
    : '';

  target.innerHTML = `
    <h2 style="font-size:1.2rem; margin-bottom:0.25rem;">Evolutionary result</h2>
    <p style="color:#666; margin-top:0;">
      ${generations.length} generations, ${t.roundsPerMatch} rounds per match,
      seed ${t.seed}.<br>
      <strong>Generation 1 winner:</strong>
      <code>${escapeHtml(t.generation1Winner)}</code> ·
      <strong>Dominance winner:</strong>
      <code>${escapeHtml(t.dominanceWinner)}</code>
    </p>

    <div style="display:flex; gap:2rem; flex-wrap:wrap; margin-top:1rem;">
      <div style="flex:1 1 320px; min-width:320px;">
        <h3 style="font-size:1rem; margin:0 0 0.5rem;">
          Generation 1 (Axelrod-faithful)
        </h3>
        ${renderLeaderboardTable(firstGen.leaderboard, { showInstance: false })}
      </div>
      <div style="flex:1 1 320px; min-width:320px;">
        <h3 style="font-size:1rem; margin:0 0 0.5rem;">
          Final population share
        </h3>
        ${renderShareTable(finalLeaderboard, t.dominanceWinner)}
      </div>
    </div>

    ${extinctNote}

    <h3 style="font-size:1rem; margin-top:1.25rem;">Population over generations</h3>
    ${renderStackedAreaChart(generations, firstGen.leaderboard)}
  `;
}

interface ShareRow {
  botId: string;
  share: number;
}

function buildPopulationShareLeaderboard(gen: Generation): ShareRow[] {
  const total = Object.values(gen.population).reduce((s, n) => s + n, 0);
  const rows: ShareRow[] = Object.entries(gen.population).map(([botId, n]) => ({
    botId,
    share: total > 0 ? n / total : 0,
  }));
  rows.sort((a, b) => b.share - a.share);
  return rows;
}

function renderShareTable(rows: ShareRow[], dominanceWinner: string): string {
  const body = rows
    .map((r, idx) => {
      const swatch = colourFor(r.botId, idx);
      const isWinner = r.botId === dominanceWinner;
      const pct = (r.share * 100).toFixed(1);
      return `
        <tr style="border-bottom:1px solid #f0f0f0; ${isWinner ? 'font-weight:600;' : ''}">
          <td style="padding:0.25rem 0.5rem;">
            <span style="display:inline-block;width:0.7rem;height:0.7rem;
                 background:${swatch};border-radius:2px;margin-right:0.4rem;
                 vertical-align:middle;"></span>
            ${escapeHtml(r.botId)}${isWinner ? ' ★' : ''}
          </td>
          <td style="padding:0.25rem 0.5rem; text-align:right;">${pct}%</td>
        </tr>
      `;
    })
    .join('');
  return `
    <table style="width:100%; border-collapse:collapse; font-size:0.95rem;">
      <thead>
        <tr style="text-align:left; border-bottom:1px solid #ddd;">
          <th style="padding:0.25rem 0.5rem;">Bot</th>
          <th style="padding:0.25rem 0.5rem; text-align:right;">Share</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------
// Stacked-area chart (hand-rolled SVG)
// ---------------------------------------------------------------------
//
// Up to ~8 strategies, ~50 generations is the typical Phase 1 case.
// A real chart library would be 50× the bundle weight for what is
// essentially:
//
//   for each strategy s, in stable order:
//     polygon = top edge of stack at this layer (left → right) +
//               bottom edge of previous layer (right → left)
//
// Layer order follows the gen-1 leaderboard: rank-1 bot is at the
// bottom of the stack (anchored to the baseline, the standard
// stacked-area convention) and rank-N at the top. This matches how
// the surrounding leaderboards rank the strategies.

function renderStackedAreaChart(
  generations: readonly Generation[],
  gen1Leaderboard: readonly LeaderboardEntry[],
): string {
  if (generations.length === 0) return '';
  const firstGen = generations[0]!;
  const allBotIds = Object.keys(firstGen.population);
  if (allBotIds.length === 0) return '';

  // Layer order: top of the leaderboard at the top of the stack.
  // Anything in the population but missing from the leaderboard
  // (shouldn't happen, but cheap to defend) goes underneath.
  const lbOrder = gen1Leaderboard
    .map((e) => e.botId)
    .filter((id) => allBotIds.includes(id));
  const trailing = allBotIds.filter((id) => !lbOrder.includes(id));
  const stackOrder = [...lbOrder, ...trailing];

  // Compute normalised shares per generation, in stack order.
  const shares: number[][] = generations.map((g) => {
    const total = Object.values(g.population).reduce((s, n) => s + n, 0);
    return stackOrder.map((id) => {
      const v = g.population[id] ?? 0;
      return total > 0 ? v / total : 0;
    });
  });

  // SVG geometry. The viewBox is fixed; the SVG itself scales to
  // the container width via width=100%.
  const W = 720;
  const H = 280;
  const M = { top: 10, right: 12, bottom: 28, left: 44 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const xAt = (genIdx: number): number => {
    if (generations.length === 1) return M.left + innerW / 2;
    return M.left + (genIdx / (generations.length - 1)) * innerW;
  };
  const yAt = (cum: number): number => M.top + (1 - cum) * innerH;

  // Build cumulative stack: for each gen, layerTops[layerIdx] is the
  // running sum of shares from layer 0 up to and including layerIdx.
  const layerTops: number[][] = shares.map((row) => {
    const out: number[] = [];
    let cum = 0;
    for (const v of row) {
      cum += v;
      out.push(cum);
    }
    return out;
  });

  // Iterate top-down so each polygon's bottom edge is the next
  // layer's top edge — overdraw order doesn't actually matter
  // because layers don't overlap, but iterating in reverse keeps
  // the SVG source order matching reading order (top → bottom).
  const polygons: string[] = [];
  for (let layer = stackOrder.length - 1; layer >= 0; layer--) {
    const botId = stackOrder[layer]!;
    const colour = colourFor(botId, layer);
    const topPts: string[] = [];
    const bottomPts: string[] = [];
    for (let g = 0; g < generations.length; g++) {
      const top = layerTops[g]![layer]!;
      const below = layer === 0 ? 0 : layerTops[g]![layer - 1]!;
      topPts.push(`${xAt(g).toFixed(2)},${yAt(top).toFixed(2)}`);
      bottomPts.push(`${xAt(g).toFixed(2)},${yAt(below).toFixed(2)}`);
    }
    const points = [...topPts, ...bottomPts.reverse()].join(' ');
    polygons.push(
      `<polygon points="${points}" fill="${colour}" fill-opacity="0.85" stroke="#fff" stroke-width="0.5">
         <title>${escapeHtml(botId)}</title>
       </polygon>`,
    );
  }

  // Y-axis grid + labels at 0/25/50/75/100%.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const y = yAt(frac).toFixed(2);
    return `
      <line x1="${M.left}" x2="${M.left + innerW}" y1="${y}" y2="${y}"
            stroke="#eee" stroke-width="1" />
      <text x="${M.left - 6}" y="${y}" font-size="11" fill="#888"
            text-anchor="end" dominant-baseline="middle">
        ${(frac * 100).toFixed(0)}%
      </text>`;
  });

  // X-axis labels: gen 1, gen N (and a midpoint if there's room).
  const xLabels: string[] = [];
  const labelGenIdxs =
    generations.length <= 2
      ? generations.map((_, i) => i)
      : [0, Math.floor((generations.length - 1) / 2), generations.length - 1];
  for (const g of labelGenIdxs) {
    xLabels.push(
      `<text x="${xAt(g).toFixed(2)}" y="${(M.top + innerH + 18).toFixed(2)}"
             font-size="11" fill="#666" text-anchor="middle">gen ${g + 1}</text>`,
    );
  }

  const legend = stackOrder
    .map((botId, idx) => {
      // Use the original layer index (0 = top) for fallback colour
      // continuity with the polygons above.
      const colour = colourFor(botId, idx);
      return `
        <span style="display:inline-flex;align-items:center;margin-right:1rem;
                     font-size:0.9rem;">
          <span style="display:inline-block;width:0.8rem;height:0.8rem;
                       background:${colour};border-radius:2px;margin-right:0.3rem;"></span>
          ${escapeHtml(botId)}
        </span>`;
    })
    .join('');

  return `
    <div style="border:1px solid #eee; padding:0.5rem; background:#fff;">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;"
           xmlns="http://www.w3.org/2000/svg">
        ${yTicks.join('\n')}
        ${polygons.join('\n')}
        <line x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${M.top + innerH}"
              stroke="#ccc" stroke-width="1" />
        <line x1="${M.left}" x2="${M.left + innerW}"
              y1="${M.top + innerH}" y2="${M.top + innerH}"
              stroke="#ccc" stroke-width="1" />
        ${xLabels.join('\n')}
      </svg>
      <div style="margin-top:0.5rem;">${legend}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function orderBots(bots: BotRecord[]): BotRecord[] {
  // Presets in canonical order first (so the picker reads in the same
  // order as the explainer / arena will), then anything else
  // alphabetically by id.
  const presetOrder = PRESETS.map((p) => p.id.toLowerCase());
  const presetIndex = new Map(presetOrder.map((id, i) => [id, i] as const));
  return [...bots].sort((a, b) => {
    const ai = presetIndex.get(a.id);
    const bi = presetIndex.get(b.id);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.id.localeCompare(b.id);
  });
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return `error: ${err.message}`;
  return `error: ${String(err)}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
