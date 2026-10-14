import { describe, expect, it } from 'vitest'
import { collectCsv, csvLine, csvStreamResponse } from './csvStream'

describe('csvStreamResponse', () => {
  it('streams header + batches as RFC-4180 CSV with a BOM', async () => {
    async function* batches() {
      yield [['2026-10-01', 'Acme, Inc.', 'said "hi"']]
      yield []
      yield [['2026-10-02', 'Line\nbreak', null]]
    }
    const res = csvStreamResponse('x.csv', ['Date', 'Client', 'Notes'], batches)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('x.csv')
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer())
    expect(text).toBe('﻿Date,Client,Notes\r\n2026-10-01,"Acme, Inc.","said ""hi"""\r\n2026-10-02,"Line\nbreak",')
  })

  it('escapes cells like lib/csv.ts', () => {
    expect(csvLine(['a', 1, null, undefined, 'b"c'])).toBe('a,1,,,"b""c"')
  })
})

describe('collectCsv', () => {
  it('collects the same CSV as the stream, without the BOM', async () => {
    async function* batches() {
      yield [['2026-10-01', 'Acme, Inc.']]
      yield []
      yield [['2026-10-02', 'café']]
    }
    const r = await collectCsv(['Date', 'Client'], batches, { maxCells: 100, maxBytes: 1000 })
    const csv = 'Date,Client\r\n2026-10-01,"Acme, Inc."\r\n2026-10-02,café'
    expect(r).toEqual({ ok: true, csv, rows: 2, bytes: Buffer.byteLength(csv, 'utf8') })
  })

  it('stops pulling and refuses once a cap is passed', async () => {
    let pulled = 0
    let closed = false
    async function* batches() {
      try {
        for (;;) {
          pulled++
          yield [['a', 'b']]
        }
      } finally {
        closed = true
      }
    }
    expect(await collectCsv(['A', 'B'], batches, { maxCells: 10, maxBytes: 1e6 })).toEqual({ ok: false, reason: 'too_large' })
    expect(pulled).toBe(5)
    expect(closed).toBe(true)
    expect(await collectCsv(['A', 'B'], batches, { maxCells: 1e6, maxBytes: 20 })).toEqual({ ok: false, reason: 'too_large' })
  })
})
