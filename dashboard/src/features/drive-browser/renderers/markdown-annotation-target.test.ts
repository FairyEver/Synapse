// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  createMarkdownAnnotationTargetFromSelection,
  getMarkdownRenderedText,
} from './markdown-annotation-target'

describe('markdown annotation target helpers', () => {
  it('creates a text range target from a rendered text selection', () => {
    document.body.innerHTML = '<main><p>这是 <strong>重点</strong> 内容</p></main>'
    const root = document.querySelector('main')
    const text = document.querySelector('strong')?.firstChild
    if (!root || !text) throw new Error('missing fixture')
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 2)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const target = createMarkdownAnnotationTargetFromSelection(root, selection)

    expect(target?.range).toEqual({ start: 3, end: 5 })
    expect(target?.quote).toEqual({ exact: '重点', prefix: '这是 ', suffix: ' 内容' })
  })

  it('ignores annotation marker text when computing offsets', () => {
    document.body.innerHTML = '<main>开头<span data-drive-annotation-marker="true">1</span>正文</main>'
    const root = document.querySelector('main')
    if (!root) throw new Error('missing fixture')

    expect(getMarkdownRenderedText(root)).toBe('开头正文')
  })

  it('returns null for collapsed or external selections', () => {
    document.body.innerHTML = '<main>正文</main><aside>旁栏</aside>'
    const root = document.querySelector('main')
    const external = document.querySelector('aside')?.firstChild
    if (!root || !external) throw new Error('missing fixture')
    const range = document.createRange()
    range.setStart(external, 0)
    range.setEnd(external, 2)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(createMarkdownAnnotationTargetFromSelection(root, selection)).toBeNull()
  })
})
