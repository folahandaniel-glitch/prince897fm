import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    env: { PGLITE_DIR: 'memory', SEED_DEMO: 'false' },
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    server: { deps: { external: [/@electric-sql[\\/]pglite/] } },
  },
});
