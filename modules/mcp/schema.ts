/**
 * Tool input schemas: a small JSON-Schema subset that is both published in `tools/list` and enforced
 * on `tools/call` (no extra dependency). Validation coerces where Harvest habits differ from Track2:
 * ids are strings in Track2, but a numeric id is accepted and stringified.
 */
import { invalid } from './errors'

export type Prop =
  | { type: 'string'; description?: string; enum?: readonly string[]; minLength?: number; maxLength?: number; format?: 'date'; id?: true }
  | { type: 'number' | 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: Prop; minItems?: number; maxItems?: number }
  | ObjectSchema

export interface ObjectSchema {
  type: 'object'
  description?: string
  properties: Record<string, Prop>
  required?: readonly string[]
}

// ---------------------------------------------------------------------------
// Builders (keep tool definitions short)
// ---------------------------------------------------------------------------

/** String input; capped at 5,000 characters unless a tighter maxLength is given. */
export const str = (description: string, extra: { enum?: readonly string[]; maxLength?: number } = {}): Prop => ({ type: 'string', description, maxLength: 5000, ...extra })
export const id = (description: string): Prop => ({ type: 'string', description, id: true })
export const ids = (description: string): Prop => ({ type: 'array', description, items: { type: 'string', id: true }, minItems: 1 })
export const date = (description: string): Prop => ({ type: 'string', description, format: 'date' })
export const num = (description: string, extra: { minimum?: number; maximum?: number } = {}): Prop => ({ type: 'number', description, ...extra })
export const int = (description: string, extra: { minimum?: number; maximum?: number } = {}): Prop => ({ type: 'integer', description, ...extra })
export const bool = (description: string): Prop => ({ type: 'boolean', description })
export const obj = (properties: Record<string, Prop>, required: readonly string[] = [], description?: string): ObjectSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
})

// ---------------------------------------------------------------------------
// Publishing: strip our private keys (`id`) so clients see plain JSON Schema
// ---------------------------------------------------------------------------

export function toJsonSchema(p: Prop): Record<string, unknown> {
  if (p.type === 'object') {
    const out: Record<string, unknown> = { type: 'object', properties: Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, toJsonSchema(v)])) }
    if (p.description) out.description = p.description
    if (p.required && p.required.length) out.required = [...p.required]
    out.additionalProperties = false
    return out
  }
  if (p.type === 'array') {
    const { items, ...rest } = p
    return { ...rest, items: toJsonSchema(items) }
  }
  if (p.type === 'string') {
    const { id: _id, ...rest } = p
    return rest
  }
  return { ...p }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false
  const d = new Date(`${s}T00:00:00.000Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function fail(path: string, message: string): never {
  throw invalid(`${path}: ${message}`, { field: path })
}

function check(p: Prop, value: unknown, path: string): unknown {
  switch (p.type) {
    case 'string': {
      let v = value
      if (p.id && typeof v === 'number' && Number.isInteger(v)) v = String(v)
      if (typeof v !== 'string') fail(path, 'must be a string')
      const s = v as string
      if (p.id && !s.trim()) fail(path, 'must be a non-empty id')
      if (p.enum && !p.enum.includes(s)) fail(path, `must be one of ${p.enum.join(', ')}`)
      if (p.minLength != null && s.length < p.minLength) fail(path, `must be at least ${p.minLength} characters`)
      if (p.maxLength != null && s.length > p.maxLength) fail(path, `must be at most ${p.maxLength} characters`)
      if (p.format === 'date' && !isValidYmd(s)) fail(path, 'must be a date YYYY-MM-DD')
      return p.id ? s.trim() : s
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, `must be a ${p.type}`)
      const n = value as number
      if (p.type === 'integer' && !Number.isInteger(n)) fail(path, 'must be a whole number')
      if (p.minimum != null && n < p.minimum) fail(path, `must be ≥ ${p.minimum}`)
      if (p.maximum != null && n > p.maximum) fail(path, `must be ≤ ${p.maximum}`)
      return n
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail(path, 'must be true or false')
      return value
    case 'array': {
      if (!Array.isArray(value)) fail(path, 'must be an array')
      const arr = value as unknown[]
      if (p.minItems != null && arr.length < p.minItems) fail(path, `must have at least ${p.minItems} item(s)`)
      if (p.maxItems != null && arr.length > p.maxItems) fail(path, `must have at most ${p.maxItems} items`)
      return arr.map((v, i) => check(p.items, v, `${path}[${i}]`))
    }
    case 'object':
      return checkObject(p, value, path)
  }
}

function checkObject(schema: ObjectSchema, value: unknown, path: string): Record<string, unknown> {
  if (value === undefined || value === null) value = {}
  if (typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  const input = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const unknown = Object.keys(input).filter((k) => !(k in schema.properties))
  if (unknown.length) {
    fail(path === '' ? unknown[0] : `${path}.${unknown[0]}`, `is not a supported parameter (accepted: ${Object.keys(schema.properties).join(', ') || 'none'})`)
  }
  for (const req of schema.required ?? []) {
    if (input[req] === undefined || input[req] === null) fail(path === '' ? req : `${path}.${req}`, 'is required')
  }
  for (const [k, prop] of Object.entries(schema.properties)) {
    const v = input[k]
    if (v === undefined || v === null) continue // optional + omitted (null treated as omitted)
    out[k] = check(prop, v, path === '' ? k : `${path}.${k}`)
  }
  return out
}

/** Validate + coerce tool arguments against a tool's schema; throws ToolError('validation_failed'). */
export function validateArgs<T = Record<string, unknown>>(schema: ObjectSchema, args: unknown): T {
  return checkObject(schema, args, '') as T
}
