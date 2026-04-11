import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: false,
    include: [
      'packages/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
    ],
  },
});
