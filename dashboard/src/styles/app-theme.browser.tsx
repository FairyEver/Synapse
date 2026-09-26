import '@/styles/index.css'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  document.documentElement.classList.remove('light', 'dark')
})

function colorSchemeFor(theme: 'light' | 'dark') {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  return getComputedStyle(document.documentElement).colorScheme
}

describe('app theme tokens in Chromium', () => {
  it('tells the browser which colour scheme native controls belong to', () => {
    expect(colorSchemeFor('light')).toBe('light')
    expect(colorSchemeFor('dark')).toBe('dark')
  })
})
