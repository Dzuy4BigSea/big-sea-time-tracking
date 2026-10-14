import { describe, it, expect } from 'vitest'
import { validateArgs, toJsonSchema, obj, str, id, ids, date, num, int, bool, isValidYmd } from './schema'
import { ToolError } from './errors'

const schema = obj(
  {
    project_id: id('Project'),
    user_ids: ids('Users'),
    spent_at: date('Date'),
    hours: num('Hours', { minimum: 0 }),
    limit: int('Limit', { minimum: 1, maximum: 500 }),
    billable: bool('Billable'),
    group_by: str('Group', { enum: ['project', 'client'] }),
    time: obj({ summary_type: str('t', { enum: ['detailed', 'task'] }), from: date('from') }, ['summary_type']),
  },
  ['project_id'],
)

function errorOf(fn: () => unknown): ToolError {
  try {
    fn()
  } catch (e) {
    return e as ToolError
  }
  throw new Error('expected a ToolError')
}

describe('tool input validation', () => {
  it('accepts valid input and coerces numeric ids to strings', () => {
    const out = validateArgs(schema, { project_id: 48978888, user_ids: ['u1', 2], spent_at: '2026-10-12', hours: 1.5, limit: 10, billable: true })
    expect(out).toEqual({ project_id: '48978888', user_ids: ['u1', '2'], spent_at: '2026-10-12', hours: 1.5, limit: 10, billable: true })
  })

  it('treats null as omitted and undefined arguments as {}', () => {
    expect(() => validateArgs(obj({ a: str('a') }), undefined)).not.toThrow()
    expect(validateArgs(obj({ a: str('a') }), { a: null })).toEqual({})
  })

  it('rejects missing required fields with validation_failed and the field name', () => {
    const e = errorOf(() => validateArgs(schema, {}))
    expect(e.code).toBe('validation_failed')
    expect(e.details).toEqual({ field: 'project_id' })
  })

  it('rejects unknown parameters instead of silently ignoring them', () => {
    const e = errorOf(() => validateArgs(schema, { project_id: 'p', bogus: 1 }))
    expect(e.code).toBe('validation_failed')
    expect(e.message).toMatch(/bogus.*not a supported parameter/)
  })

  it('checks types, enums, ranges and dates', () => {
    expect(errorOf(() => validateArgs(schema, { project_id: 'p', hours: '2' })).message).toMatch(/hours: must be a number/)
    expect(errorOf(() => validateArgs(schema, { project_id: 'p', limit: 1.5 })).message).toMatch(/whole number/)
    expect(errorOf(() => validateArgs(schema, { project_id: 'p', limit: 501 })).message).toMatch(/≤ 500/)
    expect(errorOf(() => validateArgs(schema, { project_id: 'p', group_by: 'task' })).message).toMatch(/one of project, client/)
    expect(errorOf(() => validateArgs(schema, { project_id: 'p', spent_at: '2026-02-30' })).message).toMatch(/YYYY-MM-DD/)
    expect(errorOf(() => validateArgs(schema, { project_id: '  ' })).message).toMatch(/non-empty id/)
    expect(errorOf(() => validateArgs(schema, { project_id: 'p', user_ids: [] })).message).toMatch(/at least 1/)
    expect(errorOf(() => validateArgs(schema, { project_id: 'p', billable: 'yes' })).message).toMatch(/true or false/)
  })

  it('validates nested objects with dotted paths', () => {
    const e = errorOf(() => validateArgs(schema, { project_id: 'p', time: { from: '2026-10-01' } }))
    expect(e.details).toEqual({ field: 'time.summary_type' })
    expect(validateArgs(schema, { project_id: 'p', time: { summary_type: 'task' } })).toEqual({ project_id: 'p', time: { summary_type: 'task' } })
  })

  it('publishes plain JSON Schema without private keys', () => {
    const js = toJsonSchema(schema) as { properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean }
    expect(js.required).toEqual(['project_id'])
    expect(js.additionalProperties).toBe(false)
    expect(js.properties.project_id).toEqual({ type: 'string', description: 'Project' })
    expect(js.properties.user_ids).toEqual({ type: 'array', description: 'Users', items: { type: 'string' }, minItems: 1 })
    expect(JSON.stringify(js)).not.toMatch(/"id":true/)
  })

  it('isValidYmd', () => {
    expect(isValidYmd('2026-10-14')).toBe(true)
    expect(isValidYmd('2026-13-01')).toBe(false)
    expect(isValidYmd('10/14/2026')).toBe(false)
  })
})
