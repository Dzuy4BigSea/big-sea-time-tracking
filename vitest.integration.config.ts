import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Integration tests: hit the live DB, so they load .env and run only *.integration.test.ts.
// Kept separate from the default suite (npm test) which is DB-free.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**'],
    setupFiles: ['./test/load-env.ts'],
    // All files share one live database (and account-wide counters like invoiceNumberSeq): run them one at a time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
