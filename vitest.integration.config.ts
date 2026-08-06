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
    setupFiles: ['./test/load-env.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
