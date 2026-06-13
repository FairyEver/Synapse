import { describe, expect, it } from 'vitest'

import { toDriveBrowserQueryKey } from './use-drive-browser'

describe('toDriveBrowserQueryKey', () => {
  it('separates share browser cache entries by initial password value without storing plaintext passwords', () => {
    const first = toDriveBrowserQueryKey({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'old-password',
    })
    const second = toDriveBrowserQueryKey({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'new-password',
    })

    expect(first).not.toEqual(second)
    expect(JSON.stringify(first)).not.toContain('old-password')
    expect(JSON.stringify(second)).not.toContain('new-password')
  })
})
