import { describe, it, expect, vi } from 'vitest'
import { handleRpc, listTools, LATEST_PROTOCOL_VERSION, RPC, type ToolDef } from './jsonrpc'
import { obj, str, id } from './schema'
import { forbidden } from './errors'
import { createTokenLimiter } from './rateLimit'

type Ctx = { userId: string; canWrite: boolean }

const tools: ToolDef<Ctx>[] = [
  {
    name: 'list_things',
    description: 'List things.',
    inputSchema: obj({ search: str('Search.') }),
    write: false,
    async handler(args, ctx) {
      return { things: [{ id: 't1', owner: ctx.userId, search: args.search ?? null }] }
    },
  },
  {
    name: 'create_thing',
    description: 'Create a thing.',
    inputSchema: obj({ name: str('Name.'), client_id: id('Client.') }, ['name']),
    write: true,
    async handler(args, ctx) {
      if (!ctx.canWrite) throw forbidden('You do not have permission to add things.')
      return { id: 'new1', name: args.name }
    },
  },
  {
    name: 'explode',
    description: 'Throws.',
    inputSchema: obj({}),
    write: false,
    async handler() {
      throw new Error('db exploded: secret connection string')
    },
  },
]

const ctx: Ctx = { userId: 'u1', canWrite: true }
const call = (body: unknown, c: Ctx = ctx, opts = {}) => handleRpc(body, c, tools, opts) as Promise<any>

describe('MCP JSON-RPC handler', () => {
  it('initialize negotiates the protocol version and advertises tools', async () => {
    const r = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    expect(r.id).toBe(1)
    expect(r.result.protocolVersion).toBe('2025-03-26')
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(r.result.serverInfo.name).toBe('track2')
    expect(typeof r.result.instructions).toBe('string')
    const latest = await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
    expect(latest.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
  })

  it('notifications get no response (HTTP 202)', async () => {
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('ping', async () => {
    expect(await call({ jsonrpc: '2.0', id: 'p', method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 'p', result: {} })
  })

  it('tools/list returns JSON Schemas and annotations', async () => {
    const r = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    const names = r.result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['list_things', 'create_thing', 'explode'])
    const create = r.result.tools[1]
    expect(create.inputSchema).toMatchObject({ type: 'object', required: ['name'], additionalProperties: false })
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(r.result.tools[0].annotations).toMatchObject({ readOnlyHint: true })
  })

  it('tools/call happy path returns text + structuredContent', async () => {
    const r = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_things', arguments: { search: 'x' } } })
    expect(r.result.isError).toBeUndefined()
    expect(r.result.structuredContent).toEqual({ things: [{ id: 't1', owner: 'u1', search: 'x' }] })
    expect(JSON.parse(r.result.content[0].text)).toEqual(r.result.structuredContent)
  })

  it('tools/call forbidden is a tool error with a structured code, and is audited', async () => {
    const onWrite = vi.fn(async () => {})
    const r = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_thing', arguments: { name: 'A' } } }, { userId: 'u2', canWrite: false }, { onWrite })
    expect(r.result.isError).toBe(true)
    expect(r.result.structuredContent).toEqual({ error: { code: 'forbidden', message: 'You do not have permission to add things.' } })
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect((onWrite.mock.calls[0] as unknown[])[2]).toMatchObject({ ok: false })
  })

  it('successful writes are audited with the result; reads are not', async () => {
    const onWrite = vi.fn(async () => {})
    await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'create_thing', arguments: { name: 'A', client_id: 7 } } }, ctx, { onWrite })
    expect(onWrite).toHaveBeenCalledTimes(1)
    const [tool, args, outcome] = onWrite.mock.calls[0] as unknown as [ToolDef<Ctx>, unknown, unknown]
    expect(tool.name).toBe('create_thing')
    expect(args).toEqual({ name: 'A', client_id: '7' })
    expect(outcome).toEqual({ ok: true, result: { id: 'new1', name: 'A' } })
    onWrite.mockClear()
    await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_things' } }, ctx, { onWrite })
    expect(onWrite).not.toHaveBeenCalled()
  })

  it('invalid arguments → validation_failed tool error', async () => {
    const r = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'create_thing', arguments: {} } })
    expect(r.result.isError).toBe(true)
    expect(r.result.structuredContent.error).toMatchObject({ code: 'validation_failed', details: { field: 'name' } })
  })

  it('unexpected errors do not leak internals', async () => {
    const onUnexpected = vi.fn()
    const r = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'explode' } }, ctx, { onUnexpected })
    expect(r.result.isError).toBe(true)
    expect(r.result.structuredContent.error.code).toBe('internal_error')
    expect(JSON.stringify(r)).not.toMatch(/secret/)
    expect(onUnexpected).toHaveBeenCalledWith('explode', expect.any(Error))
  })

  it('protocol errors', async () => {
    expect((await call({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'nope' } })).error.code).toBe(RPC.INVALID_PARAMS)
    expect((await call({ jsonrpc: '2.0', id: 11, method: 'what/ever' })).error.code).toBe(RPC.METHOD_NOT_FOUND)
    expect((await call({ id: 12, method: 'ping' })).error.code).toBe(RPC.INVALID_REQUEST)
    expect((await call('hello')).error.code).toBe(RPC.INVALID_REQUEST)
    expect((await call([])).error.code).toBe(RPC.INVALID_REQUEST)
  })

  it('batches answer requests and skip notifications', async () => {
    const r = await call([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
    expect(r.map((x: { id: number }) => x.id)).toEqual([1, 2])
  })

  it('listTools marks destructive/idempotent hints only on writes', () => {
    const [t] = listTools([{ ...tools[1], destructive: true, idempotent: true }])
    expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false })
  })
})

describe('per-token rate limit', () => {
  it('allows up to max requests per window per token', () => {
    let now = 0
    const lim = createTokenLimiter({ max: 3, windowMs: 1000, now: () => now })
    expect([lim.take('a'), lim.take('a'), lim.take('a'), lim.take('a')]).toEqual([true, true, true, false])
    expect(lim.take('b')).toBe(true)
    now = 1500
    expect(lim.take('a')).toBe(true)
  })
})
