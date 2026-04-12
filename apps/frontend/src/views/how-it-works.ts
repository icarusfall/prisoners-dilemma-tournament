// "How it works" view — renders explainer markdown files as in-site pages
// with prev/next navigation.
//
// Markdown files are loaded at build time via Vite's import.meta.glob
// with ?raw. Frontmatter is parsed manually (simple YAML subset). The
// HTML is rendered client-side by `marked`.

import { marked } from 'marked';

// ---------------------------------------------------------------------------
// Load explainer markdown at build time
// ---------------------------------------------------------------------------

const modules = import.meta.glob('../../../../docs/explainers/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface ExplainerPage {
  slug: string;
  title: string;
  html: string;
  /** Sort order derived from filename prefix (00, 01, ...). */
  order: number;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2]! };
}

const pages: ExplainerPage[] = Object.entries(modules)
  .map(([path, raw]) => {
    const { meta, body } = parseFrontmatter(raw);
    const filename = path.split('/').pop()!;
    const order = parseInt(filename.slice(0, 2), 10);
    return {
      slug: meta['slug'] ?? filename.replace('.md', ''),
      title: meta['title'] ?? 'Untitled',
      html: marked.parse(body, { async: false }) as string,
      order,
    };
  })
  .sort((a, b) => a.order - b.order);

const pagesBySlug = new Map(pages.map((p) => [p.slug, p]));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type NavigateCallback = (slug: string) => void;

export interface HowItWorksHandle {
  /** Navigate to a specific page by slug. */
  show(slug: string): void;
  /** Show the table of contents. */
  showToc(): void;
  destroy(): void;
}

export function mountHowItWorks(
  root: HTMLElement,
  onNavigate?: NavigateCallback,
): HowItWorksHandle {
  root.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText =
    'max-width:720px;margin:0 auto;padding:2rem 1.5rem;color:#ddd;' +
    'font:16px/1.7 system-ui,sans-serif;height:100%;overflow-y:auto;';
  root.appendChild(container);
  root.style.overflowY = 'auto';

  // Inject a scoped style for markdown content.
  const style = document.createElement('style');
  style.textContent = MARKDOWN_STYLES;
  container.appendChild(style);

  const content = document.createElement('div');
  content.className = 'explainer-content';
  container.appendChild(content);

  function renderToc(): void {
    content.innerHTML = `
      <h1 style="margin-bottom:0.3em;">How It Works</h1>
      <p style="color:#999;margin-bottom:1.5em;">
        Nine short pages covering the Prisoner's Dilemma, tournament strategies, and how to use this platform.
      </p>
      <nav>
        ${pages
          .map(
            (p, i) => `
          <a href="#" data-slug="${p.slug}" style="display:block;padding:10px 14px;margin-bottom:6px;
             background:rgba(255,255,255,0.04);border-radius:6px;color:#7ecfff;text-decoration:none;
             border-left:3px solid rgba(126,207,255,0.3);transition:background 0.15s;">
            <span style="color:#666;margin-right:8px;">${String(i + 1).padStart(2, '0')}</span>
            ${p.title}
          </a>`,
          )
          .join('')}
      </nav>
    `;
    content.querySelectorAll<HTMLAnchorElement>('a[data-slug]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const slug = a.dataset['slug']!;
        show(slug);
        onNavigate?.(slug);
      });
      a.addEventListener('mouseenter', () => { a.style.background = 'rgba(255,255,255,0.08)'; });
      a.addEventListener('mouseleave', () => { a.style.background = 'rgba(255,255,255,0.04)'; });
    });
  }

  function renderPage(page: ExplainerPage): void {
    const idx = pages.indexOf(page);
    const prev = idx > 0 ? pages[idx - 1]! : null;
    const next = idx < pages.length - 1 ? pages[idx + 1]! : null;

    content.innerHTML = `
      <a href="#" class="explainer-back" style="display:inline-block;margin-bottom:1em;color:#7ecfff;
         text-decoration:none;font-size:0.9rem;">&larr; All pages</a>
      <div class="md-body">${page.html}</div>
      <div class="explainer-nav" style="display:flex;justify-content:space-between;margin-top:2em;
           padding-top:1em;border-top:1px solid rgba(255,255,255,0.1);">
        ${prev ? `<a href="#" data-slug="${prev.slug}" style="color:#7ecfff;text-decoration:none;">&larr; ${prev.title}</a>` : '<span></span>'}
        ${next ? `<a href="#" data-slug="${next.slug}" style="color:#7ecfff;text-decoration:none;">${next.title} &rarr;</a>` : '<span></span>'}
      </div>
    `;

    // Wire up links.
    content.querySelector('.explainer-back')!.addEventListener('click', (e) => {
      e.preventDefault();
      showToc();
      onNavigate?.('');
    });
    content.querySelectorAll<HTMLAnchorElement>('.explainer-nav a[data-slug]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const slug = a.dataset['slug']!;
        show(slug);
        onNavigate?.(slug);
      });
    });

    container.scrollTop = 0;
  }

  function show(slug: string): void {
    const page = pagesBySlug.get(slug);
    if (page) renderPage(page);
    else renderToc();
  }

  function showToc(): void {
    renderToc();
  }

  // Start with the TOC.
  renderToc();

  return {
    show,
    showToc,
    destroy() {
      root.innerHTML = '';
    },
  };
}

/** All explainer slugs, in order. Useful for the arena overlay link. */
export function getExplainerSlugs(): string[] {
  return pages.map((p) => p.slug);
}

/** Get the first explainer slug. */
export function getFirstSlug(): string {
  return pages[0]?.slug ?? '';
}

// ---------------------------------------------------------------------------
// Styles for rendered markdown
// ---------------------------------------------------------------------------

const MARKDOWN_STYLES = `
  .md-body h1 { font-size:1.6rem; margin:0 0 0.5em; color:#fff; }
  .md-body h2 { font-size:1.2rem; margin:1.5em 0 0.4em; color:#e0e0e0; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.3em; }
  .md-body h3 { font-size:1.05rem; margin:1.2em 0 0.3em; color:#ccc; }
  .md-body p { margin:0.6em 0; }
  .md-body a { color:#7ecfff; }
  .md-body strong { color:#fff; }
  .md-body em { color:#ccc; }
  .md-body ul, .md-body ol { padding-left:1.5em; margin:0.6em 0; }
  .md-body li { margin:0.3em 0; }
  .md-body code { background:rgba(255,255,255,0.08); padding:2px 5px; border-radius:3px; font-size:0.9em; }
  .md-body pre { background:rgba(255,255,255,0.06); padding:12px 16px; border-radius:6px; overflow-x:auto; margin:0.8em 0; }
  .md-body pre code { background:none; padding:0; }
  .md-body table { border-collapse:collapse; width:100%; margin:0.8em 0; font-size:0.9rem; }
  .md-body th { text-align:left; padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.2); color:#aaa; font-weight:600; }
  .md-body td { padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.06); }
  .md-body blockquote { border-left:3px solid rgba(126,207,255,0.4); margin:0.8em 0; padding:0.3em 1em; color:#aaa; }
`;
