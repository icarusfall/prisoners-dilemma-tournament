// @pdt/frontend — bot-directory view.
//
// Read-only listing of every bot registered on the backend. Visible
// bots appear with their full BotSpec JSON pretty-printed; hidden bots
// show only name + submitter so players can see who's entered without
// leaking strategy.

import {
  getBotDirectory,
  type DirectoryHiddenBot,
  type DirectoryVisibleBot,
} from '../api.js';

export async function mountBotDirectory(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div style="max-width:960px;margin:0 auto;">
      <h2 style="font-size:1.2rem;margin:0 0 0.25rem;">Bot Directory</h2>
      <p style="color:#888;margin:0 0 1rem;font-size:0.9rem;">
        Every bot registered on the server. Hidden bots show only their name
        and submitter — their spec stays sealed until the challenge ends.
      </p>
      <div id="directory-body" style="color:#666;">Loading…</div>
    </div>
  `;

  const body = root.querySelector<HTMLElement>('#directory-body')!;

  try {
    const { visible, hidden } = await getBotDirectory();
    body.innerHTML = '';
    body.appendChild(renderVisibleSection(visible));
    body.appendChild(renderHiddenSection(hidden));
  } catch (err) {
    body.innerHTML = `<p style="color:crimson;">Failed to load directory: ${escapeHtml(
      err instanceof Error ? err.message : String(err),
    )}</p>`;
  }
}

function renderVisibleSection(bots: DirectoryVisibleBot[]): HTMLElement {
  const section = document.createElement('section');
  section.style.marginBottom = '2rem';
  section.innerHTML = `
    <h3 style="font-size:1rem;margin:0 0 0.5rem;color:#333;">
      Visible bots <span style="color:#888;font-weight:400;">(${bots.length})</span>
    </h3>
  `;

  if (bots.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:#888;font-size:0.9rem;margin:0;';
    empty.textContent = 'No visible bots yet.';
    section.appendChild(empty);
    return section;
  }

  for (const bot of bots) {
    section.appendChild(renderVisibleCard(bot));
  }
  return section;
}

function renderVisibleCard(bot: DirectoryVisibleBot): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'border:1px solid #d0d0da;border-radius:6px;padding:0.75rem 1rem;margin-bottom:0.75rem;background:#fafaff;';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:baseline;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;';

  const submitter = bot.submitter_name
    ? ` · submitted by <strong>${escapeHtml(bot.submitter_name)}</strong>`
    : '';
  header.innerHTML = `
    <div>
      <strong style="font-size:1rem;color:#222;">${escapeHtml(bot.name)}</strong>
      <span style="color:#666;font-size:0.8rem;margin-left:0.5rem;">
        ${escapeHtml(bot.created_via)}${submitter}
      </span>
    </div>
    <code style="color:#888;font-size:0.75rem;">${escapeHtml(bot.id)}</code>
  `;
  card.appendChild(header);

  if (bot.source_description) {
    const desc = document.createElement('p');
    desc.style.cssText = 'margin:0 0 0.5rem;color:#555;font-size:0.85rem;font-style:italic;';
    desc.textContent = bot.source_description;
    card.appendChild(desc);
  }

  const pre = document.createElement('pre');
  pre.style.cssText =
    'background:#1e1e2e;color:#cfc;padding:0.75rem;border-radius:4px;overflow-x:auto;font-size:0.8rem;margin:0;';
  pre.textContent = JSON.stringify(bot.spec, null, 2);
  card.appendChild(pre);

  return card;
}

function renderHiddenSection(bots: DirectoryHiddenBot[]): HTMLElement {
  const section = document.createElement('section');
  section.innerHTML = `
    <h3 style="font-size:1rem;margin:0 0 0.5rem;color:#333;">
      Hidden bots <span style="color:#888;font-weight:400;">(${bots.length})</span>
    </h3>
  `;

  if (bots.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:#888;font-size:0.9rem;margin:0;';
    empty.textContent = 'No hidden bots yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('ul');
  list.style.cssText = 'list-style:none;padding:0;margin:0;';
  for (const bot of bots) {
    const li = document.createElement('li');
    li.style.cssText =
      'padding:0.5rem 0.75rem;border:1px solid #d0d0da;border-radius:4px;margin-bottom:0.4rem;background:#fafaff;display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;';
    const submitter = bot.submitter_name
      ? `submitted by <strong>${escapeHtml(bot.submitter_name)}</strong>`
      : '<span style="color:#888;">submitter unknown</span>';
    li.innerHTML = `
      <strong style="color:#222;">${escapeHtml(bot.name)}</strong>
      <span style="color:#555;font-size:0.85rem;">${submitter}</span>
    `;
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
