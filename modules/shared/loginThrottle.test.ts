import { describe, it, expect } from 'vitest'
import { createMemoryLimiter, failureDelayMs, isLockedOut, LOGIN_MAX_FAILURES } from './loginThrottle'

describe('loginThrottle', () => {
  it('locks out at the failure threshold', () => {
    expect(isLockedOut(LOGIN_MAX_FAILURES - 1)).toBe(false)
    expect(isLockedOut(LOGIN_MAX_FAILURES)).toBe(true)
  })

  it('failure delay stays within 400–800ms', () => {
    expect(failureDelayMs(0)).toBe(400)
    expect(failureDelayMs(0.9999)).toBeLessThan(800)
    expect(failureDelayMs(5)).toBeLessThan(800)
  })

  it('memory limiter blocks after max failures and forgets after the window', () => {
    let t = 0
    const lim = createMemoryLimiter({ max: 3, windowMs: 1000, now: () => t })
    lim.recordFailure('a@x.co')
    lim.recordFailure('a@x.co')
    expect(lim.isBlocked('a@x.co')).toBe(false)
    lim.recordFailure('a@x.co')
    expect(lim.isBlocked('a@x.co')).toBe(true)
    expect(lim.isBlocked('b@x.co')).toBe(false)
    t = 1500
    expect(lim.isBlocked('a@x.co')).toBe(false)
  })

  it('reset clears a key; size stays bounded', () => {
    const lim = createMemoryLimiter({ max: 1, maxKeys: 2 })
    lim.recordFailure('a')
    expect(lim.isBlocked('a')).toBe(true)
    lim.reset('a')
    expect(lim.isBlocked('a')).toBe(false)
    lim.recordFailure('b')
    lim.recordFailure('c')
    lim.recordFailure('d')
    expect(lim.isBlocked('b')).toBe(false) // evicted
    expect(lim.isBlocked('d')).toBe(true)
  })
})
