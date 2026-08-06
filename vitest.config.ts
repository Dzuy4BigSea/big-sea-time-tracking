import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Resolve the "@/..." path alias (tsconfig paths) so tests can import app modules.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // Integration tests (live DB) run via `npm run test:integration`, not the default suite.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
})

