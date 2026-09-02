// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { resolveCommentComposerPosition } from './markdown-comment-composer-popover'

describe('resolveCommentComposerPosition', () => {
  const boundary = { top: 20, right: 800, bottom: 600, left: 20, width: 780, height: 580 }
  const composer = { width: 288, height: 148 }

  it('places the composer beside the anchor when the right side fits', () => {
    expect(resolveCommentComposerPosition(
      { top: 180, right: 380, bottom: 204, left: 280, width: 100, height: 24 },
      boundary,
      composer,
    )).toEqual({ top: 118, left: 388 })
  })

  it('uses the left side when the right side is crowded', () => {
    expect(resolveCommentComposerPosition(
      { top: 180, right: 740, bottom: 204, left: 640, width: 100, height: 24 },
      boundary,
      composer,
    )).toEqual({ top: 118, left: 344 })
  })

  it('uses the lower edge when neither horizontal side fits', () => {
    expect(resolveCommentComposerPosition(
      { top: 120, right: 530, bottom: 144, left: 430, width: 100, height: 24 },
      { top: 20, right: 620, bottom: 600, left: 320, width: 300, height: 580 },
      composer,
    )).toEqual({ top: 152, left: 332 })
  })

  it('keeps the composer inside the visible boundary when no side fully fits', () => {
    const narrowBoundary = { top: 20, right: 340, bottom: 190, left: 20, width: 320, height: 170 }
    expect(resolveCommentComposerPosition(
      { top: 80, right: 190, bottom: 110, left: 160, width: 30, height: 30 },
      narrowBoundary,
      { width: 288, height: 148 },
    )).toEqual({ top: 21, left: 52 })
  })
})
