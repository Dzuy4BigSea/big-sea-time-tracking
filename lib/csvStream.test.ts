import { describe, expect, it } from 'vitest'
import { csvLine, csvStreamResponse } from './csvStream'

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
