// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_COOKIE_NAME, syncThemeColorMeta } from './theme-provider'

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

describe('theme-init.v1.js', () => {
  const script = readFileSync('public/theme-init.v1.js', 'utf8')

  it('reads the theme cookie that ThemeProvider writes', () => {
    expect(script).toContain(THEME_COOKIE_NAME)
  })

  it('falls back to the system preference and applies the class before the app boots', () => {
    expect(script).toContain('(prefers-color-scheme: dark)')
    expect(script).toContain("document.documentElement.classList.add(isDark ? 'dark' : 'light')")
  })
})
