import { expect, it } from 'vitest'
import { hubMetadataChanges } from './skill-metadata-dialog'

it('only projects changed store fields', () => {
  expect(hubMetadataChanges({ displayName: '中文', displayDescription: 'Original' },
    { displayName: 'Old', displayDescription: 'Original' })).toEqual({ displayName: '中文' })
})
