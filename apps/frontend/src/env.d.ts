// Vite client types + typed env vars.
//
// `vite/client` gives us `import.meta.env`, the `*.svg?url` import
// modifiers, and friends. The `ImportMetaEnv` interface extension
// declares the project-specific env vars so `import.meta.env.VITE_*`
// is type-checked instead of `string | undefined`.

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the @pdt/backend API. Defaults to the Railway production
   * deploy when not set, so a vanilla `npm run dev` works out of the box.
   * Override with a `.env.local` to point at a local backend.
   */
  readonly VITE_BACKEND_URL?: string;
  /** Mapbox GL JS access token. Required for the arena map. */
  readonly VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
