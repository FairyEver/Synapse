// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { syncThemeColorMeta } from './theme-provider'

describe('syncThemeColorMeta', () => {
  afterEach(() => {
    document.head.querySelector("meta[name='theme-color']")?.remove()
    document.documentElement.removeAttribute('style')
  })

  it('creates theme-color meta from the background token', () => {
    document.documentElement.style.setProperty('--background', 'oklch(1 0 0)')

    syncThemeColorMeta(document.documentElement)

    expect(
      document.head.querySelector("meta[name='theme-color']")?.getAttribute('content')
    ).toBe('oklch(1 0 0)')
  })

  it('updates existing theme-color meta when the token changes', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = 'old-token'
    document.head.append(meta)
    document.documentElement.style.setProperty('--background', 'oklch(0.129 0.042 264.695)')

    syncThemeColorMeta(document.documentElement)

    expect(document.head.querySelectorAll("meta[name='theme-color']")).toHaveLength(1)
    expect(meta.getAttribute('content')).toBe('oklch(0.129 0.042 264.695)')
  })
})
