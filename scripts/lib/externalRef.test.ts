import { describe, it, expect } from 'vitest'
import { fromHarvestReference } from '@/modules/integrations/externalRef'
import { externalRef } from './externalRef.mjs'

const NONE = { externalService: null, externalId: null, externalGroupId: null, externalPermalink: null }

describe('scripts/lib/externalRef.mjs mirrors fromHarvestReference', () => {
  const cases: unknown[] = [
    { id: '1205', group_id: '1204', permalink: 'https://app.asana.com/0/1204/1205', service: 'app.asana.com' },
    { id: 42, service: 'app.asana.com' },
    { id: '7', permalink: 'https://app.asana.com/0/1/7' },
    { id: '7', service: 'asana', permalink: 'javascript:alert(1)' },
    { id: '9', service: 'GitHub.com', group_id: ' 3 ' },
    { service: 'app.asana.com' },
    { id: '7' },
    {},
    null,
  ]
  it.each(cases)('agrees on %j', (ref) => {
    expect(externalRef(ref)).toEqual(fromHarvestReference(ref) ?? NONE)
  })
})
