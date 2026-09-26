import '@/styles/index.css'
import 'github-markdown-css/github-markdown-light.css'
import { afterEach, describe, expect, it } from 'vitest'

let root: HTMLElement | null = null

afterEach(() => {
  root?.remove()
  root = null
  document.documentElement.classList.remove('light', 'dark')
})

function mountMarkdownBody() {
  root = document.createElement('main')
  root.className = 'markdown-body'
  root.innerHTML = '<p>正文</p><p>行内 <code>code</code></p>'
  document.body.append(root)
  return root
}

function computed(selector: string, property: 'backgroundColor' | 'color') {
  const element = root!.querySelector(selector)
  expect(element).not.toBeNull()
  return getComputedStyle(element!)[property]
}

describe('drive markdown preview follows the app theme in Chromium', () => {
  it('uses the light palette while the document is not dark', () => {
    document.documentElement.classList.add('light')
    mountMarkdownBody()

    expect(computed('p', 'color')).toBe('rgb(31, 35, 40)')
    expect(computed('code', 'backgroundColor')).toBe('rgba(129, 139, 152, 0.12)')
  })

  it('switches body, text and inline code to the dark palette under .dark', () => {
    document.documentElement.classList.add('dark')
    mountMarkdownBody()

    expect(getComputedStyle(root!).backgroundColor).toBe('rgb(13, 17, 23)')
    expect(computed('p', 'color')).toBe('rgb(240, 246, 252)')
    expect(computed('code', 'backgroundColor')).toBe('rgba(101, 108, 118, 0.2)')
  })
})
