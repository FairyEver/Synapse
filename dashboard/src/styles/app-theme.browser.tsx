import '@/styles/index.css'
import 'github-markdown-css/github-markdown-light.css'
import { afterEach, describe, expect, it } from 'vitest'

let root: HTMLElement | null = null

afterEach(() => {
  root?.remove()
  root = null
})

describe('web app appearance in Chromium', () => {
  it('tells the browser that native controls belong to the light colour scheme', () => {
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('light')
  })

  it('renders the Markdown preview on the light palette', () => {
    root = document.createElement('main')
    root.className = 'markdown-body'
    root.innerHTML = '<p>正文</p><p>行内 <code>code</code></p>'
    document.body.append(root)

    expect(getComputedStyle(root).backgroundColor).toBe('rgb(255, 255, 255)')
    expect(getComputedStyle(root.querySelector('p')!).color).toBe('rgb(31, 35, 40)')
  })
})
