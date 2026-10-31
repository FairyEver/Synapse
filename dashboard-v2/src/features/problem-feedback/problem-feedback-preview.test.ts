import { describe, expect, it } from 'vitest'
import { getProblemFeedbackPreview } from './problem-feedback-preview'

describe('getProblemFeedbackPreview', () => {
  it('uses only the first 120 Unicode code points', () => {
    const preview = getProblemFeedbackPreview(`${'😀'.repeat(121)}\nsecond`)
    expect(Array.from(preview.slice(0, -1))).toHaveLength(120)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview).not.toContain('second')
  })

  it('marks additional lines without exposing them', () => {
    expect(getProblemFeedbackPreview('first\nsecret second line')).toBe('first…')
  })

  it('preserves a complete short first line', () => {
    expect(getProblemFeedbackPreview('short')).toBe('short')
  })
})
