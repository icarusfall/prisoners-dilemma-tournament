import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
