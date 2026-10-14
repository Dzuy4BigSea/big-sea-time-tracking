import { describe, it, expect } from 'vitest'
import { classifyViewer, shouldTraceView, viewDetail, VIEW_TRACE_INTERVAL_MS } from './invoiceViews'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const base = { method: 'GET', userAgent: CHROME, invoiceAccountId: 'acc_1' }

describe('classifyViewer', () => {
  it('a normal browser with no session is the client', () => {
    expect(classifyViewer(base)).toBe('client')
  })
  it('a signed-in user of a different account still counts as a client view', () => {
    expect(classifyViewer({ ...base, viewerAccountId: 'acc_2' })).toBe('client')
  })
  it('signed-in users of the same account are internal (Preview)', () => {
    expect(classifyViewer({ ...base, viewerAccountId: 'acc_1' })).toBe('internal')
  })
  it('HEAD requests are ignored', () => {
    expect(classifyViewer({ ...base, method: 'HEAD' })).toBe('head')
  })
  it.each([
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1',
    'Mozilla/5.0 (compatible; SomeCrawler/1.0)',
    'LinkPreview/2.0',
    '',
  ])('bots / unfurlers are ignored: %s', (ua) => {
    expect(classifyViewer({ ...base, userAgent: ua })).toBe('bot')
  })
  it('browser and Next.js prefetches are ignored', () => {
    expect(classifyViewer({ ...base, purpose: 'prefetch' })).toBe('prefetch')
    expect(classifyViewer({ ...base, nextPrefetch: true })).toBe('prefetch')
  })
})

describe('shouldTraceView', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  it('first view → trace', () => {
    expect(shouldTraceView(null, now)).toBe(true)
  })
  it('at most once per 30 minutes', () => {
    expect(shouldTraceView(new Date(now.getTime() - 5 * 60_000), now)).toBe(false)
    expect(shouldTraceView(new Date(now.getTime() - VIEW_TRACE_INTERVAL_MS), now)).toBe(true)
  })
})

describe('viewDetail', () => {
  it('keeps only a coarse user-agent family', () => {
    expect(viewDetail(CHROME)).toEqual({ userAgent: 'Chrome (desktop)' })
  })
})
