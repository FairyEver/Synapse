// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { resolveInlineToolbarPosition } from './inline-toolbar'

describe('resolveInlineToolbarPosition', () => {
  const boundary = { top: 20, right: 500, bottom: 400, left: 20 }
  const container = { top: 0, left: 0 }
  const toolbar = { width: 104, height: 32 }

  it('prefers the visible top edge when the toolbar fits above the anchor', () => {
    expect(resolveInlineToolbarPosition(
      { top: 100, right: 300, bottom: 280, left: 100 },
      boundary,
      toolbar,
      container,
    )).toEqual({ top: 62, left: 148 })
  })

  it('uses the visible bottom edge after the anchor top scrolls out of view', () => {
    expect(resolveInlineToolbarPosition(
      { top: -80, right: 300, bottom: 260, left: 100 },
      boundary,
      toolbar,
      container,
    )).toEqual({ top: 266, left: 148 })
  })

  it('keeps the toolbar inside the horizontal boundary', () => {
    expect(resolveInlineToolbarPosition(
      { top: 100, right: 50, bottom: 280, left: 10 },
      boundary,
      toolbar,
      container,
    )).toEqual({ top: 62, left: 20 })
  })

  it('hides the toolbar when neither edge can fit it', () => {
    expect(resolveInlineToolbarPosition(
      { top: -80, right: 300, bottom: 430, left: 100 },
      boundary,
      toolbar,
      container,
    )).toBeNull()
  })
})
