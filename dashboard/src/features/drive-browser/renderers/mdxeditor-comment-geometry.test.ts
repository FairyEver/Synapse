// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { createMdxEditorTextModel, mapWorkingRange } from './mdxeditor-comment-geometry'

describe('MDXEditor comment geometry', () => {
  it('builds Unicode code-point offsets across formatted and nested editor text', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>前缀<strong>目标🙂</strong></p><table><tbody><tr><td>单元格</td></tr></tbody></table>'

    const model = createMdxEditorTextModel(root)

    expect(model.text).toBe('前缀目标🙂单元格')
    expect(model.segments.at(-1)?.end).toBe(Array.from(model.text).length)
  })

  it('preserves rendered offsets for image alt text and line breaks without treating them as DOM text', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>之前<img src="/asset.png" alt="示意图">之后<br>末尾</p>'

    const model = createMdxEditorTextModel(root)

    expect(model.text).toBe('之前示意图之后\n末尾')
    expect(model.segments.filter((segment) => segment.node === null)).toHaveLength(2)
  })

  it('keeps CodeMirror text in the offset model without exposing a precise DOM range', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>之前</p><div class="cm-content"><div class="cm-line"><span>const value = 1</span></div><div class="cm-line">return value</div></div><p>之后</p>'

    const model = createMdxEditorTextModel(root)

    expect(model.text).toBe('之前const value = 1\nreturn value之后')
    expect(model.segments.find((segment) => segment.start === 2)?.node).toBeNull()
  })

  it('moves a comment after an insertion while keeping comments before it stable', () => {
    expect(mapWorkingRange('前面目标后面', '新增前面目标后面', { start: 2, end: 4 })).toEqual({ start: 4, end: 6 })
    expect(mapWorkingRange('前面目标后面', '前面目标后面新增', { start: 2, end: 4 })).toEqual({ start: 2, end: 4 })
  })

  it('stops local positioning when an edit overlaps the comment range', () => {
    expect(mapWorkingRange('前面目标后面', '前面改动后面', { start: 2, end: 4 })).toBeNull()
  })

  it('uses code-point rather than UTF-16 offsets', () => {
    expect(mapWorkingRange('🙂目标', '前🙂目标', { start: 1, end: 3 })).toEqual({ start: 2, end: 4 })
  })
})
