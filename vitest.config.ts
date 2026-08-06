import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Resolve the "@/..." path alias (tsconfig paths) so tests can import app modules.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` is a build-time guard with no runtime impl; stub it for unit tests.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    // Integration tests (live DB) run via `npm run test:integration`, not the default suite.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
})

