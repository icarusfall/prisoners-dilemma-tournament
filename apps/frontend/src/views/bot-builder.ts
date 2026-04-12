// @pdt/frontend — bot-builder view (Phase 4).
//
// Three-stage flow:
//   1. Describe: user types a natural-language strategy description.
//   2. Compile: POST /api/compile-bot, show spinner, display the
//      resulting BotSpec JSON for review.
//   3. Save: user confirms the name, optionally edits the spec, and
//      saves via POST /api/bots.
//
// The spec is shown in a readonly textarea so the user can see exactly
// what the compiler produced. An "Edit JSON" toggle makes it editable
// for power users who want to tweak a condition or add a rule.

import type { BotSpec } from '@pdt/engine';
import { ApiError, compileBot, createBotFromSpec } from '../api.js';

export function mountBotBuilder(root: HTMLElement): void {
  root.innerHTML = `
    <div style="max-width:720px;margin:0 auto;">
      <h2 style="font-size:1.2rem;margin:0 0 0.25rem;">Create a bot</h2>
      <p style="color:#888;margin:0 0 1rem;font-size:0.9rem;">
        Describe a strategy in plain English and the AI compiler will turn it
        into a tournament-ready bot. You can review and edit the compiled spec
        before saving.
      </p>

      <!-- Stage 1: describe -->
      <div id="stage-describe">
        <label for="nl-input" style="font-weight:600;font-size:0.9rem;">Strategy description</label>
        <textarea id="nl-input" rows="5" placeholder="e.g. Start by cooperating. If the opponent defects twice in a row, defect for the next 3 rounds then go back to cooperating. Forgive occasional single defections."
                  style="width:100%;margin:0.5rem 0;padding:0.5rem;font-size:0.95rem;
                         background:#1e1e2e;color:#ddd;border:1px solid #444;border-radius:4px;
                         resize:vertical;font-family:system-ui,sans-serif;box-sizing:border-box;"></textarea>
        <div style="display:flex;align-items:center;gap:1rem;">
          <button id="btn-compile" style="padding:0.5rem 1.25rem;font-size:0.95rem;cursor:pointer;
                                          background:#2f3b6e;color:#fff;border:1px solid #4a5a9e;
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
                         background:#1a1a2a;color:#cfc;border:1px solid #333;border-radius:4px;
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
                                            background:transparent;color:#888;border:1px solid #555;
                                            border-radius:4px;">
            Start over
          </button>
          <span id="save-status" style="color:#888;font-size:0.9rem;"></span>
        </div>
        <p id="save-error" style="color:crimson;margin:0.5rem 0 0;font-size:0.9rem;"></p>
      </div>

      <!-- Stage 3: saved confirmation -->
      <div id="stage-saved" style="display:none;margin-top:1.25rem;">
        <div style="border:1px solid #3a8e4b;border-radius:6px;padding:1rem;background:#1a2e1a;">
          <p style="margin:0 0 0.5rem;color:#6c6;font-weight:600;" id="saved-message"></p>
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

  const savedMessage = root.querySelector<HTMLElement>('#saved-message')!;
  const btnAnother = root.querySelector<HTMLButtonElement>('#btn-another')!;

  let currentDescription = '';

  // ---- Toggle editable ----
  toggleEdit.addEventListener('change', () => {
    specJson.readOnly = !toggleEdit.checked;
    specJson.style.background = toggleEdit.checked ? '#1e1e2e' : '#1a1a2a';
    specJson.style.color = toggleEdit.checked ? '#ddd' : '#cfc';
  });

  // ---- Compile ----
  btnCompile.addEventListener('click', () => void handleCompile());

  async function handleCompile(): Promise<void> {
    const description = nlInput.value.trim();
    if (!description) {
      compileError.textContent = 'Please describe your strategy first.';
      return;
    }

    compileError.textContent = '';
    compileStatus.textContent = 'Compiling… (this may take a few seconds)';
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
    specJson.style.background = '#1a1a2a';
    specJson.style.color = '#cfc';
    saveError.textContent = '';
    saveStatus.textContent = '';
    stageReview.style.display = '';
  }

  // ---- Start over ----
  btnRecompile.addEventListener('click', () => {
    stageReview.style.display = 'none';
    stageSaved.style.display = 'none';
  });

  // ---- Save ----
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

    // Ensure the spec name matches what the user typed
    spec.name = name;

    btnSave.disabled = true;
    saveStatus.textContent = 'Saving…';

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

  function showSavedStage(name: string, id: string): void {
    stageReview.style.display = 'none';
    savedMessage.textContent = `"${name}" saved successfully (id: ${id})`;
    stageSaved.style.display = '';
  }

  // ---- Create another ----
  btnAnother.addEventListener('click', () => {
    nlInput.value = '';
    compileError.textContent = '';
    stageReview.style.display = 'none';
    stageSaved.style.display = 'none';
    nlInput.focus();
  });
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
