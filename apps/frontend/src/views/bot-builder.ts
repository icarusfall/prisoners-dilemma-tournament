// @pdt/frontend — bot-builder view (Phase 4 + Phase 8 code-tier).
//
// Two creation modes, toggled at the top:
//   A. Describe: user types a natural-language strategy description,
//      AI compiles it to DSL, user reviews and saves.
//   B. Write Code: user writes a JavaScript function body that receives
//      `view` (a BotView) and returns 'C' or 'D'. Saved as a code-tier
//      bot directly.
//
// Both flows share the same save logic — POST /api/bots with the spec.

import type { BotSpec } from '@pdt/engine';
import { ApiError, compileBot, createBotFromSpec } from '../api.js';

export function mountBotBuilder(root: HTMLElement): void {
  root.innerHTML = `
    <div style="max-width:720px;margin:0 auto;">
      <h2 style="font-size:1.2rem;margin:0 0 0.25rem;">Create a bot</h2>
      <p style="color:#888;margin:0 0 1rem;font-size:0.9rem;">
        Describe a strategy in plain English, or write code directly.
      </p>

      <!-- Mode toggle -->
      <div style="display:flex;gap:0;margin-bottom:1rem;">
        <button id="tab-describe" class="bot-tab bot-tab-active" style="flex:1;padding:0.5rem;font-size:0.9rem;cursor:pointer;
                background:#5a6abf;color:#fff;border:1px solid #4a5aaf;border-radius:4px 0 0 4px;">
          Describe with AI
        </button>
        <button id="tab-code" class="bot-tab" style="flex:1;padding:0.5rem;font-size:0.9rem;cursor:pointer;
                background:transparent;color:#666;border:1px solid #ccc;border-radius:0 4px 4px 0;">
          Write Code
        </button>
      </div>

      <!-- ====== Mode A: Describe ====== -->
      <div id="mode-describe">
        <div id="stage-describe">
          <label for="nl-input" style="font-weight:600;font-size:0.9rem;">Strategy description</label>
          <textarea id="nl-input" rows="5" placeholder="e.g. Start by cooperating. If the opponent defects twice in a row, defect for the next 3 rounds then go back to cooperating. Forgive occasional single defections."
                    style="width:100%;margin:0.5rem 0;padding:0.5rem;font-size:0.95rem;
                           background:#f8f8fc;color:#333;border:1px solid #ccc;border-radius:4px;
                           resize:vertical;font-family:system-ui,sans-serif;box-sizing:border-box;"></textarea>
          <div style="display:flex;align-items:center;gap:1rem;">
            <button id="btn-compile" style="padding:0.5rem 1.25rem;font-size:0.95rem;cursor:pointer;
                                            background:#5a6abf;color:#fff;border:1px solid #4a5aaf;
                                            border-radius:4px;">
              Compile bot
            </button>
            <span id="compile-status" style="color:#888;font-size:0.9rem;"></span>
          </div>
          <p id="compile-error" style="color:crimson;margin:0.5rem 0 0;font-size:0.9rem;"></p>
        </div>

        <!-- Stage 2: review (hidden until compiled) -->
        <div id="stage-review" style="display:none;margin-top:1.25rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
            <h3 style="font-size:1rem;margin:0;">Compiled spec</h3>
            <label style="font-size:0.85rem;color:#888;cursor:pointer;">
              <input type="checkbox" id="toggle-edit"> Edit JSON
            </label>
          </div>
          <textarea id="spec-json" rows="18" readonly
                    style="width:100%;padding:0.5rem;font-size:0.85rem;
                           font-family:ui-monospace,monospace;
                           background:#f0f0f8;color:#2a6040;border:1px solid #ccc;border-radius:4px;
                           resize:vertical;box-sizing:border-box;"></textarea>

          <div style="margin-top:0.75rem;">
            <label for="bot-name" style="font-weight:600;font-size:0.9rem;">Bot name</label>
            <input id="bot-name" type="text" maxlength="80"
                   style="display:block;width:100%;margin:0.25rem 0 0.75rem;padding:0.4rem;
                          font-size:0.95rem;background:#1e1e2e;color:#ddd;
                          border:1px solid #444;border-radius:4px;box-sizing:border-box;">
          </div>

          <div style="display:flex;align-items:center;gap:1rem;">
            <button id="btn-save" style="padding:0.5rem 1.25rem;font-size:0.95rem;cursor:pointer;
                                         background:#2a6e3b;color:#fff;border:1px solid #3a8e4b;
                                         border-radius:4px;">
              Save bot
            </button>
            <button id="btn-recompile" style="padding:0.5rem 1rem;font-size:0.9rem;cursor:pointer;
                                              background:transparent;color:#666;border:1px solid #ccc;
                                              border-radius:4px;">
              Start over
            </button>
            <span id="save-status" style="color:#888;font-size:0.9rem;"></span>
          </div>
          <p id="save-error" style="color:crimson;margin:0.5rem 0 0;font-size:0.9rem;"></p>
        </div>
      </div>

      <!-- ====== Mode B: Write Code ====== -->
      <div id="mode-code" style="display:none;">
        <p style="color:#aaa;font-size:0.85rem;margin:0 0 0.5rem;">
          Write a JavaScript function body. It receives <code style="color:#4a7abf;">view</code> and must return <code style="color:#4a7abf;">'C'</code> or <code style="color:#4a7abf;">'D'</code>.
        </p>
        <details style="margin-bottom:0.75rem;color:#888;font-size:0.85rem;">
          <summary style="cursor:pointer;color:#aaa;">view API reference</summary>
          <pre style="margin:0.5rem 0;padding:0.5rem;background:#f0f0f8;border:1px solid #ccc;border-radius:4px;font-size:0.8rem;color:#2a6040;overflow-x:auto;">view.round              // 0-indexed round number
view.history.myMoves    // readonly Move[] ('C'|'D')
view.history.theirMoves // readonly Move[]
view.rng()              // deterministic random [0,1)
view.selfInstanceId     // string
view.opponentInstanceId // string</pre>
        </details>

        <label for="code-input" style="font-weight:600;font-size:0.9rem;">Function body</label>
        <textarea id="code-input" rows="14" spellcheck="false"
                  placeholder="// Example: Tit-for-Tat&#10;if (view.round === 0) return 'C';&#10;return view.history.theirMoves[view.round - 1];"
                  style="width:100%;margin:0.5rem 0;padding:0.5rem;font-size:0.9rem;
                         font-family:ui-monospace,monospace;tab-size:2;
                         background:#f8f8fc;color:#333;border:1px solid #ccc;border-radius:4px;
                         resize:vertical;box-sizing:border-box;"></textarea>

        <div style="margin-top:0.25rem;">
          <label for="code-bot-name" style="font-weight:600;font-size:0.9rem;">Bot name</label>
          <input id="code-bot-name" type="text" maxlength="80"
                 style="display:block;width:100%;margin:0.25rem 0 0.75rem;padding:0.4rem;
                        font-size:0.95rem;background:#1e1e2e;color:#ddd;
                        border:1px solid #444;border-radius:4px;box-sizing:border-box;">
        </div>

        <div style="display:flex;align-items:center;gap:1rem;">
          <button id="btn-test-code" style="padding:0.5rem 1rem;font-size:0.9rem;cursor:pointer;
                                            background:#5a6abf;color:#fff;border:1px solid #4a5aaf;
                                            border-radius:4px;">
            Test locally
          </button>
          <button id="btn-save-code" style="padding:0.5rem 1.25rem;font-size:0.95rem;cursor:pointer;
                                            background:#2a6e3b;color:#fff;border:1px solid #3a8e4b;
                                            border-radius:4px;">
            Save bot
          </button>
          <span id="code-status" style="color:#888;font-size:0.9rem;"></span>
        </div>
        <p id="code-error" style="color:crimson;margin:0.5rem 0 0;font-size:0.9rem;"></p>
        <pre id="code-test-output" style="display:none;margin:0.75rem 0 0;padding:0.5rem;
             background:#f0f0f8;border:1px solid #ccc;border-radius:4px;font-size:0.85rem;
             color:#2a6040;white-space:pre-wrap;max-height:200px;overflow-y:auto;"></pre>
      </div>

      <!-- Stage 3: saved confirmation (shared) -->
      <div id="stage-saved" style="display:none;margin-top:1.25rem;">
        <div style="border:1px solid #3a8e4b;border-radius:6px;padding:1rem;background:#e8f5e8;">
          <p style="margin:0 0 0.5rem;color:#2a8040;font-weight:600;" id="saved-message"></p>
          <p style="margin:0;color:#888;font-size:0.9rem;">
            Your bot is now in the library and can be used in tournaments.
          </p>
        </div>
        <button id="btn-another" style="margin-top:0.75rem;padding:0.5rem 1rem;font-size:0.9rem;
                                        cursor:pointer;background:transparent;color:#888;
                                        border:1px solid #555;border-radius:4px;">
          Create another bot
        </button>
      </div>
    </div>
  `;

  // ---- Element refs ----
  const tabDescribe = root.querySelector<HTMLButtonElement>('#tab-describe')!;
  const tabCode = root.querySelector<HTMLButtonElement>('#tab-code')!;
  const modeDescribe = root.querySelector<HTMLElement>('#mode-describe')!;
  const modeCode = root.querySelector<HTMLElement>('#mode-code')!;

  const nlInput = root.querySelector<HTMLTextAreaElement>('#nl-input')!;
  const btnCompile = root.querySelector<HTMLButtonElement>('#btn-compile')!;
  const compileStatus = root.querySelector<HTMLElement>('#compile-status')!;
  const compileError = root.querySelector<HTMLElement>('#compile-error')!;

  const stageDescribe = root.querySelector<HTMLElement>('#stage-describe')!;
  const stageReview = root.querySelector<HTMLElement>('#stage-review')!;
  const stageSaved = root.querySelector<HTMLElement>('#stage-saved')!;

  const toggleEdit = root.querySelector<HTMLInputElement>('#toggle-edit')!;
  const specJson = root.querySelector<HTMLTextAreaElement>('#spec-json')!;
  const botNameInput = root.querySelector<HTMLInputElement>('#bot-name')!;
  const btnSave = root.querySelector<HTMLButtonElement>('#btn-save')!;
  const btnRecompile = root.querySelector<HTMLButtonElement>('#btn-recompile')!;
  const saveStatus = root.querySelector<HTMLElement>('#save-status')!;
  const saveError = root.querySelector<HTMLElement>('#save-error')!;

  const codeInput = root.querySelector<HTMLTextAreaElement>('#code-input')!;
  const codeBotName = root.querySelector<HTMLInputElement>('#code-bot-name')!;
  const btnTestCode = root.querySelector<HTMLButtonElement>('#btn-test-code')!;
  const btnSaveCode = root.querySelector<HTMLButtonElement>('#btn-save-code')!;
  const codeStatus = root.querySelector<HTMLElement>('#code-status')!;
  const codeError = root.querySelector<HTMLElement>('#code-error')!;
  const codeTestOutput = root.querySelector<HTMLPreElement>('#code-test-output')!;

  const savedMessage = root.querySelector<HTMLElement>('#saved-message')!;
  const btnAnother = root.querySelector<HTMLButtonElement>('#btn-another')!;

  let currentDescription = '';
  void stageDescribe; // used implicitly via display

  // ---- Tab switching ----
  function activateTab(tab: 'describe' | 'code'): void {
    stageSaved.style.display = 'none';
    if (tab === 'describe') {
      tabDescribe.style.background = '#2f3b6e';
      tabDescribe.style.color = '#fff';
      tabCode.style.background = 'transparent';
      tabCode.style.color = '#666';
      modeDescribe.style.display = '';
      modeCode.style.display = 'none';
    } else {
      tabCode.style.background = '#5a6abf';
      tabCode.style.color = '#fff';
      tabDescribe.style.background = 'transparent';
      tabDescribe.style.color = '#666';
      modeDescribe.style.display = 'none';
      modeCode.style.display = '';
    }
  }
  tabDescribe.addEventListener('click', () => activateTab('describe'));
  tabCode.addEventListener('click', () => activateTab('code'));

  // ---- Toggle editable (Describe mode) ----
  toggleEdit.addEventListener('change', () => {
    specJson.readOnly = !toggleEdit.checked;
    specJson.style.background = toggleEdit.checked ? '#fff' : '#f0f0f8';
    specJson.style.color = toggleEdit.checked ? '#333' : '#2a6040';
  });

  // ---- Compile (Describe mode) ----
  btnCompile.addEventListener('click', () => void handleCompile());

  async function handleCompile(): Promise<void> {
    const description = nlInput.value.trim();
    if (!description) {
      compileError.textContent = 'Please describe your strategy first.';
      return;
    }

    compileError.textContent = '';
    compileStatus.textContent = 'Compiling\u2026 (this may take a few seconds)';
    btnCompile.disabled = true;

    try {
      const result = await compileBot(description);
      currentDescription = description;
      showReviewStage(result.spec);
    } catch (err) {
      compileError.textContent = formatError(err);
    } finally {
      compileStatus.textContent = '';
      btnCompile.disabled = false;
    }
  }

  function showReviewStage(spec: BotSpec): void {
    specJson.value = JSON.stringify(spec, null, 2);
    botNameInput.value = spec.name || '';
    toggleEdit.checked = false;
    specJson.readOnly = true;
    specJson.style.background = '#f0f0f8';
    specJson.style.color = '#2a6040';
    saveError.textContent = '';
    saveStatus.textContent = '';
    stageReview.style.display = '';
  }

  // ---- Start over (Describe mode) ----
  btnRecompile.addEventListener('click', () => {
    stageReview.style.display = 'none';
    stageSaved.style.display = 'none';
  });

  // ---- Save (Describe mode) ----
  btnSave.addEventListener('click', () => void handleSave());

  async function handleSave(): Promise<void> {
    saveError.textContent = '';
    saveStatus.textContent = '';

    const name = botNameInput.value.trim();
    if (!name) {
      saveError.textContent = 'Please enter a name for your bot.';
      return;
    }

    let spec: BotSpec;
    try {
      spec = JSON.parse(specJson.value) as BotSpec;
    } catch {
      saveError.textContent = 'The JSON in the spec editor is not valid JSON. Please fix it.';
      return;
    }

    spec.name = name;

    btnSave.disabled = true;
    saveStatus.textContent = 'Saving\u2026';

    try {
      const bot = await createBotFromSpec({
        name,
        spec,
        source_description: currentDescription || undefined,
        created_via: 'nl',
      });
      showSavedStage(bot.name, bot.id);
    } catch (err) {
      saveError.textContent = formatError(err);
    } finally {
      saveStatus.textContent = '';
      btnSave.disabled = false;
    }
  }

  // ---- Test locally (Code mode) ----
  btnTestCode.addEventListener('click', handleTestCode);

  function handleTestCode(): void {
    codeError.textContent = '';
    const code = codeInput.value.trim();
    if (!code) {
      codeError.textContent = 'Please write some code first.';
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function('view', code) as (view: unknown) => unknown;
      // Run 5 test rounds against a simple cooperator
      const myMoves: string[] = [];
      const theirMoves: string[] = [];
      const lines: string[] = [];
      let rngState = 42;
      const rng = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 0x100000000; };

      for (let r = 0; r < 5; r++) {
        const view = {
          selfInstanceId: 'test#0',
          opponentInstanceId: 'opponent#0',
          round: r,
          history: { myMoves: [...myMoves], theirMoves: [...theirMoves] },
          rng,
        };
        const result = fn(view);
        const move = result === 'C' || result === 'D' ? result : '?';
        myMoves.push(move === '?' ? 'C' : move);
        theirMoves.push('C'); // opponent always cooperates
        lines.push(`Round ${r}: returned ${JSON.stringify(result)} → ${move}`);
      }
      codeTestOutput.textContent = lines.join('\n');
      codeTestOutput.style.display = '';
    } catch (err) {
      codeError.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      codeTestOutput.style.display = 'none';
    }
  }

  // ---- Save (Code mode) ----
  btnSaveCode.addEventListener('click', () => void handleSaveCode());

  async function handleSaveCode(): Promise<void> {
    codeError.textContent = '';
    codeStatus.textContent = '';

    const name = codeBotName.value.trim();
    if (!name) {
      codeError.textContent = 'Please enter a name for your bot.';
      return;
    }
    const code = codeInput.value.trim();
    if (!code) {
      codeError.textContent = 'Please write some code first.';
      return;
    }
    if (code.length > 10_000) {
      codeError.textContent = 'Code exceeds the 10,000 character limit.';
      return;
    }

    // Quick syntax check
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('view', code);
    } catch (err) {
      codeError.textContent = `Syntax error: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    const spec: BotSpec = {
      name,
      version: 1,
      kind: 'code',
      code,
    };

    btnSaveCode.disabled = true;
    codeStatus.textContent = 'Saving\u2026';

    try {
      const bot = await createBotFromSpec({
        name,
        spec,
        created_via: 'code',
      });
      showSavedStage(bot.name, bot.id);
    } catch (err) {
      codeError.textContent = formatError(err);
    } finally {
      codeStatus.textContent = '';
      btnSaveCode.disabled = false;
    }
  }

  // ---- Shared: saved stage ----
  function showSavedStage(name: string, id: string): void {
    stageReview.style.display = 'none';
    modeDescribe.style.display = 'none';
    modeCode.style.display = 'none';
    savedMessage.textContent = `"${name}" saved successfully (id: ${id})`;
    stageSaved.style.display = '';
  }

  // ---- Create another ----
  btnAnother.addEventListener('click', () => {
    nlInput.value = '';
    codeInput.value = '';
    compileError.textContent = '';
    codeError.textContent = '';
    codeTestOutput.style.display = 'none';
    stageReview.style.display = 'none';
    stageSaved.style.display = 'none';
    modeDescribe.style.display = '';
    modeCode.style.display = 'none';
    activateTab('describe');
    nlInput.focus();
  });

  // ---- Handle Tab key in code editor ----
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeInput.selectionStart;
      const end = codeInput.selectionEnd;
      codeInput.value = codeInput.value.substring(0, start) + '  ' + codeInput.value.substring(end);
      codeInput.selectionStart = codeInput.selectionEnd = start + 2;
    }
  });
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
