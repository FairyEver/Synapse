import { describe, expect, it } from 'vitest'

import { logLevelOptions } from './index'

describe('logLevelOptions', () => {
  it('matches the backend-supported recent log levels', () => {
    expect(logLevelOptions.map((option) => option.value)).toEqual([
      'all',
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
    ])
  })
})
