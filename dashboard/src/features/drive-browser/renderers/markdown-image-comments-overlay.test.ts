// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { resolveMarkdownImageCommentActionPlacement } from './markdown-image-comments-overlay'

describe('resolveMarkdownImageCommentActionPlacement', () => {
  const clip = { top: 20, right: 500, bottom: 400, left: 20 }
  const container = { top: 0, left: 0 }

  it('prefers the visible top edge when the action fits above the image', () => {
    expect(resolveMarkdownImageCommentActionPlacement(
      { top: 100, right: 300, bottom: 280, left: 100, width: 200 },
      clip,
      container,
    )).toEqual({ top: 62, left: 148 })
  })

  it('uses the visible bottom edge after the image top scrolls out of view', () => {
    expect(resolveMarkdownImageCommentActionPlacement(
      { top: -80, right: 300, bottom: 260, left: 100, width: 200 },
      clip,
      container,
    )).toEqual({ top: 266, left: 148 })
  })

  it('hides the action when neither edge can place a complete button', () => {
    expect(resolveMarkdownImageCommentActionPlacement(
      { top: -80, right: 300, bottom: 430, left: 100, width: 200 },
      clip,
      container,
    )).toBeNull()
  })
})
