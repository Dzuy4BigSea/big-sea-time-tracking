import { describe, it, expect } from 'vitest'
import { safeHttpUrl } from './safeUrl'

describe('safeHttpUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(safeHttpUrl('https://drive.google.com/file/d/abc')).toBe('https://drive.google.com/file/d/abc')
    expect(safeHttpUrl('  http://example.com/r.pdf ')).toBe('http://example.com/r.pdf')
  })

  it('rejects script/data/relative/empty values', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeHttpUrl('/relative/path')).toBeNull()
    expect(safeHttpUrl('')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
    expect(safeHttpUrl('ftp://x.com/a')).toBeNull()
  })
})
