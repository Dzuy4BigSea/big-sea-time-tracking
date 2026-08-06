import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Minimal .env loader for integration tests (no dotenv dependency).
// Only sets keys not already present in the environment.
try {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url))
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
} catch {
  // No .env — integration tests will fail fast with a clear connection error.
}
