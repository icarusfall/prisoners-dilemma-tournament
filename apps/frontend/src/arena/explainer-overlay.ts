// "What am I looking at?" overlay for the arena.
//
// A top-right button opens a semi-transparent overlay that explains the
// arena in plain language.  Designed so a colleague who just landed on
// the site can orient themselves without leaving the page.

export interface ExplainerOverlay {
  el: HTMLElement;
  destroy(): void;
}

export function createExplainerOverlay(): ExplainerOverlay {
  // ---- Button ----
  const btn = document.createElement('button');
  btn.textContent = '? What am I looking at?';
  btn.style.cssText =
    'position:absolute;top:12px;right:12px;z-index:15;' +
    'padding:8px 14px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;' +
    'background:rgba(0,0,0,0.7);color:#eee;font:13px/1 system-ui,sans-serif;' +
    'cursor:pointer;backdrop-filter:blur(4px);transition:background 0.15s;';
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(50,50,80,0.85)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.7)'; });

  // ---- Overlay panel ----
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute;inset:0;z-index:25;display:none;' +
    'background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);' +
    'overflow-y:auto;padding:48px 32px 32px;' +
    'color:#ddd;font:14px/1.7 system-ui,sans-serif;';

  const close = document.createElement('button');
  close.textContent = '✕';
  close.style.cssText =
    'position:absolute;top:14px;right:18px;all:unset;cursor:pointer;' +
    'font-size:22px;color:#aaa;padding:4px 8px;';
  close.addEventListener('mouseenter', () => { close.style.color = '#fff'; });
  close.addEventListener('mouseleave', () => { close.style.color = '#aaa'; });
  overlay.appendChild(close);

  const content = document.createElement('div');
  content.style.cssText = 'max-width:620px;margin:0 auto;';
  content.innerHTML = EXPLAINER_HTML;
  overlay.appendChild(content);

  // ---- Container ----
  const el = document.createElement('div');
  el.appendChild(btn);
  el.appendChild(overlay);

  // ---- Toggle logic ----
  function open(): void {
    overlay.style.display = 'block';
    btn.style.display = 'none';
  }
  function closeOverlay(): void {
    overlay.style.display = 'none';
    btn.style.display = 'block';
  }

  btn.addEventListener('click', open);
  close.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });

  // Escape key closes.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeOverlay();
  };
  document.addEventListener('keydown', onKey);

  return {
    el,
    destroy() {
      document.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Static HTML content — the "what you're looking at" explanation.
// Kept inline so the overlay is self-contained within Phase 2.
// Phase 3 will replace this with rendered explainer pages.
// ---------------------------------------------------------------------------

const EXPLAINER_HTML = `
<h2 style="margin:0 0 8px;font-size:1.5rem;color:#fff;">What am I looking at?</h2>
<p style="color:#aaa;margin:0 0 24px;font-size:0.9rem;">
  A quick guide to the arena — close this and watch it all make sense.
</p>

<h3 style="color:#7ecfff;margin:20px 0 8px;font-size:1.05rem;">🎮 The setup</h3>
<p>
  You're watching <strong>bots</strong> walk around a map of
  <em>1 Coleman Street</em> (our London office). Each bot follows a
  <strong>strategy</strong> — a set of rules for playing the
  <em>Prisoner's Dilemma</em>, one of the most famous games in maths.
</p>

<h3 style="color:#7ecfff;margin:20px 0 8px;font-size:1.05rem;">🤝 When two bots meet</h3>
<p>
  When two sprites bump into each other they play a round: each secretly
  picks <strong style="color:#6c6;">Cooperate</strong> or
  <strong style="color:#e55;">Defect</strong>.
</p>
<table style="border-collapse:collapse;margin:12px 0;width:100%;font-size:0.9rem;">
  <thead>
    <tr style="border-bottom:1px solid #555;">
      <th style="text-align:left;padding:6px 10px;color:#aaa;">Outcome</th>
      <th style="text-align:center;padding:6px 10px;color:#aaa;">You</th>
      <th style="text-align:center;padding:6px 10px;color:#aaa;">Them</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:4px 10px;">Both cooperate</td>
        <td style="text-align:center;color:#6c6;">+3</td>
        <td style="text-align:center;color:#6c6;">+3</td></tr>
    <tr><td style="padding:4px 10px;">You defect, they cooperate</td>
        <td style="text-align:center;color:#ff6;">+5</td>
        <td style="text-align:center;color:#e55;">+0</td></tr>
    <tr><td style="padding:4px 10px;">You cooperate, they defect</td>
        <td style="text-align:center;color:#e55;">+0</td>
        <td style="text-align:center;color:#ff6;">+5</td></tr>
    <tr><td style="padding:4px 10px;">Both defect</td>
        <td style="text-align:center;color:#c93;">+1</td>
        <td style="text-align:center;color:#c93;">+1</td></tr>
  </tbody>
</table>

<h3 style="color:#7ecfff;margin:20px 0 8px;font-size:1.05rem;">👀 What the colours mean</h3>
<p>
  After an interaction a <strong>line</strong> briefly connects the two bots:
</p>
<ul style="list-style:none;padding:0;margin:8px 0 0;">
  <li style="margin:4px 0;">
    <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#6c6;vertical-align:middle;margin-right:8px;"></span>
    <strong>Green line</strong> — both cooperated (mutual trust)
  </li>
  <li style="margin:4px 0;">
    <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#e55;vertical-align:middle;margin-right:8px;"></span>
    <strong>Red line</strong> — at least one defected (betrayal!)
  </li>
</ul>

<h3 style="color:#7ecfff;margin:20px 0 8px;font-size:1.05rem;">🕵️ Dig deeper</h3>
<ul style="padding-left:20px;margin:8px 0;">
  <li><strong>Click a bot</strong> to open the side panel — see its strategy, score, and match history.</li>
  <li><strong>Hover an interaction line</strong> to read why each bot made its choice.</li>
  <li><strong>Watch the caption bar</strong> at the bottom for notable events (betrayals, lead changes, streaks).</li>
  <li><strong>Check the scoreboard</strong> in the top-left to see who's winning.</li>
</ul>

<h3 style="color:#7ecfff;margin:20px 0 8px;font-size:1.05rem;">🧠 The big idea</h3>
<p>
  Defecting always beats cooperating in a <em>single</em> round — but when
  the game repeats, strategies that build trust (like <strong>Tit for Tat</strong>)
  tend to win overall. That's the insight that makes the Prisoner's Dilemma
  so fascinating: <em>nice guys don't always finish last</em>.
</p>

<p style="margin-top:24px;color:#888;font-size:0.85rem;">
  Built by the L&amp;G AI Club · full explainer pages coming soon
</p>
`;
