// @pdt/frontend — connect view (Phase 5).
//
// Lets users create a player identity and get an MCP token, then
// shows them how to connect their Claude instance to the MCP server.

import { ApiError, BACKEND_URL, createPlayer, listPlayers, type PlayerSummary } from '../api.js';

export function mountConnect(root: HTMLElement): void {
  root.innerHTML = `
    <div style="max-width:720px;margin:0 auto;">
      <h2 style="font-size:1.2rem;margin:0 0 0.25rem;">Connect via MCP</h2>
      <p style="color:#888;margin:0 0 1rem;font-size:0.9rem;">
        Point your own Claude at this server's MCP endpoint to build, submit,
        and iterate on bots conversationally. First, create a player identity
        to get your token.
      </p>

      <!-- Create player -->
      <div style="border:1px solid #333;border-radius:6px;padding:1rem;margin-bottom:1.25rem;">
        <h3 style="font-size:1rem;margin:0 0 0.5rem;">1. Create a player</h3>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <input id="player-name" type="text" maxlength="80" placeholder="Your display name"
                 style="flex:1;padding:0.4rem;font-size:0.95rem;background:#1e1e2e;color:#ddd;
                        border:1px solid #444;border-radius:4px;">
          <button id="btn-create-player" style="padding:0.4rem 1rem;font-size:0.9rem;cursor:pointer;
                                                 background:#2f3b6e;color:#fff;border:1px solid #4a5a9e;
                                                 border-radius:4px;white-space:nowrap;">
            Create
          </button>
        </div>
        <p id="player-error" style="color:crimson;margin:0.5rem 0 0;font-size:0.9rem;"></p>
        <div id="player-result" style="display:none;margin-top:0.75rem;
                                       border:1px solid #3a8e4b;border-radius:4px;padding:0.75rem;
                                       background:#1a2e1a;">
          <p style="margin:0 0 0.25rem;color:#6c6;font-weight:600;">Player created!</p>
          <p style="margin:0;color:#ddd;font-size:0.9rem;">
            Your token (save this — it won't be shown again):
          </p>
          <code id="player-token" style="display:block;margin:0.5rem 0;padding:0.5rem;
                                         background:#111;border-radius:4px;color:#f0c674;
                                         word-break:break-all;font-size:0.85rem;"></code>
        </div>
      </div>

      <!-- Connection instructions -->
      <div style="border:1px solid #333;border-radius:6px;padding:1rem;margin-bottom:1.25rem;">
        <h3 style="font-size:1rem;margin:0 0 0.5rem;">2. Connect your Claude</h3>
        <p style="color:#aaa;font-size:0.9rem;margin:0 0 0.5rem;">
          Add this MCP server to your Claude Desktop or Claude Code configuration:
        </p>
        <pre id="mcp-config" style="background:#111;padding:0.75rem;border-radius:4px;
                                    overflow-x:auto;font-size:0.85rem;color:#cfc;margin:0;"></pre>
        <p style="color:#666;font-size:0.85rem;margin:0.5rem 0 0;">
          Replace <code style="color:#f0c674;">YOUR_TOKEN</code> with the token from step 1.
        </p>
      </div>

      <!-- Available tools/resources -->
      <div style="border:1px solid #333;border-radius:6px;padding:1rem;margin-bottom:1.25rem;">
        <h3 style="font-size:1rem;margin:0 0 0.5rem;">3. What's available</h3>
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:280px;">
            <h4 style="color:#8888cc;margin:0 0 0.25rem;font-size:0.9rem;">Tools</h4>
            <ul style="margin:0;padding-left:1.25rem;color:#aaa;font-size:0.85rem;line-height:1.6;">
              <li><code>validate_bot_spec</code> — dry-run validation</li>
              <li><code>submit_bot</code> — submit a new bot</li>
              <li><code>list_my_bots</code> — see your bots</li>
              <li><code>update_bot</code> / <code>delete_bot</code></li>
              <li><code>run_tournament</code> — test run (not persisted)</li>
              <li><code>get_leaderboard</code> / <code>get_match_history</code></li>
            </ul>
          </div>
          <div style="flex:1;min-width:280px;">
            <h4 style="color:#8888cc;margin:0 0 0.25rem;font-size:0.9rem;">Resources</h4>
            <ul style="margin:0;padding-left:1.25rem;color:#aaa;font-size:0.85rem;line-height:1.6;">
              <li><code>pd://docs/*</code> — rules, DSL reference, guides</li>
              <li><code>pd://schema/bot-spec.json</code> — the BotSpec schema</li>
              <li><code>pd://presets/*</code> — classical bot examples</li>
              <li><code>pd://scoring</code> — payoff matrix</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Existing players -->
      <div style="border:1px solid #333;border-radius:6px;padding:1rem;">
        <h3 style="font-size:1rem;margin:0 0 0.5rem;">Players</h3>
        <div id="players-list" style="color:#888;font-size:0.9rem;">Loading…</div>
      </div>
    </div>
  `;

  const mcpUrl = BACKEND_URL.replace(/\/$/, '') + '/mcp';
  const configEl = root.querySelector<HTMLElement>('#mcp-config')!;
  configEl.textContent = JSON.stringify({
    mcpServers: {
      'prisoners-dilemma': {
        url: mcpUrl,
        headers: {
          'x-pdt-token': 'YOUR_TOKEN',
        },
      },
    },
  }, null, 2);

  // ---- Create player ----
  const nameInput = root.querySelector<HTMLInputElement>('#player-name')!;
  const btnCreate = root.querySelector<HTMLButtonElement>('#btn-create-player')!;
  const playerError = root.querySelector<HTMLElement>('#player-error')!;
  const playerResult = root.querySelector<HTMLElement>('#player-result')!;
  const playerToken = root.querySelector<HTMLElement>('#player-token')!;

  btnCreate.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      playerError.textContent = 'Please enter a display name.';
      return;
    }

    playerError.textContent = '';
    btnCreate.disabled = true;

    try {
      const player = await createPlayer(name);
      playerToken.textContent = player.mcp_token;
      playerResult.style.display = '';
      nameInput.value = '';
      void loadPlayers();
    } catch (err) {
      playerError.textContent = err instanceof ApiError ? err.message : String(err);
    } finally {
      btnCreate.disabled = false;
    }
  });

  // ---- Load players ----
  const playersList = root.querySelector<HTMLElement>('#players-list')!;

  async function loadPlayers(): Promise<void> {
    try {
      const players = await listPlayers();
      if (players.length === 0) {
        playersList.textContent = 'No players yet. Create one above to get started.';
        return;
      }
      playersList.innerHTML = players
        .map((p: PlayerSummary) => `<div style="padding:0.25rem 0;border-bottom:1px solid #222;">
          <strong>${escapeHtml(p.display_name)}</strong>
          <span style="color:#555;font-size:0.85rem;margin-left:0.5rem;">${p.id}</span>
        </div>`)
        .join('');
    } catch {
      playersList.textContent = 'Failed to load players.';
    }
  }

  void loadPlayers();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
