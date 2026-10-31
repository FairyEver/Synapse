import { describe, expect, it } from 'vitest'

import { getCleanupBeforeDate } from './cleanup-date'

describe('getCleanupBeforeDate', () => {
  it('returns the cleanup cutoff date', () => {
    const now = Date.parse('2026-06-01T07:46:00.000Z')

    expect(getCleanupBeforeDate(now)).toEqual(
      new Date('2026-05-02T07:46:00.000Z')
    )
  })
})
