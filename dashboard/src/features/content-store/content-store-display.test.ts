import { describe, expect, it } from 'vitest'
import {
  formatContentStoreSize,
  getContentStoreOwnerName,
  getContentStoreTypeLabel,
} from './content-store-display'

describe('content store display helpers', () => {
  it('returns stable type labels', () => {
    expect(getContentStoreTypeLabel('skill')).toBe('Skill')
    expect(getContentStoreTypeLabel('rule')).toBe('Rule')
    expect(getContentStoreTypeLabel('prompt')).toBe('Prompt')
  })

  it('formats file sizes with neutral units', () => {
    expect(formatContentStoreSize(0)).toBe('0 B')
    expect(formatContentStoreSize(512)).toBe('512 B')
    expect(formatContentStoreSize(1536)).toBe('1.5 KB')
    expect(formatContentStoreSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('falls back when owner display name is empty', () => {
    expect(getContentStoreOwnerName({ displayName: ' Ada ' })).toBe('Ada')
    expect(getContentStoreOwnerName({ displayName: null })).toBe('-')
  })
})
