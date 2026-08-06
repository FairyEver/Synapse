// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH } from '@synapse/shared'
import * as Y from 'yjs'
import {
  createMarkdownAnnotationAnchorFromSelection,
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

  it('ignores structural whitespace between rendered Markdown blocks', () => {
    document.body.innerHTML = '<main><p data-drive-markdown-block-id="first">甲</p>\n<p data-drive-markdown-block-id="second">重复句：相同文本。</p></main>'
    const root = document.querySelector<HTMLElement>('main')
    const paragraph = document.querySelectorAll('p')[1]
    const text = paragraph?.firstChild
    if (!root || !text) throw new Error('missing fixture')
    const range = document.createRange()
    range.setStart(text, 4)
    range.setEnd(text, 8)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const anchor = createMarkdownAnnotationAnchorFromSelection({
      root,
      selection,
      projection: {
        schemaVersion: 1,
        parserVersion: 'test',
        sourceSha256: 'test',
        blocks: [
          { blockId: 'first', type: 'paragraph', parentBlockId: null, headingPath: [], sourceStart: 0, sourceEnd: 1, renderedStart: 0, renderedEnd: 1, textFingerprint: 'first' },
          { blockId: 'second', type: 'paragraph', parentBlockId: null, headingPath: [], sourceStart: 3, sourceEnd: 12, renderedStart: 1, renderedEnd: 10, textFingerprint: 'second' },
        ],
        segments: [
          { segmentId: 'first-segment', blockId: 'first', sourceStart: 0, sourceEnd: 1, renderedStart: 0, renderedEnd: 1, mapping: 'identity' },
          { segmentId: 'second-segment', blockId: 'second', sourceStart: 3, sourceEnd: 12, renderedStart: 1, renderedEnd: 10, mapping: 'identity' },
        ],
      },
    })

    expect(getMarkdownRenderedText(root)).toBe('甲重复句：相同文本。')
    expect(anchor?.selectors.renderedPosition).toEqual({ start: 5, end: 9 })
    expect(anchor?.selectors.position).toEqual({ start: 7, end: 11 })
    expect(anchor?.selectors.semantic).toMatchObject({ blockId: 'second', start: 4, end: 8 })
  })

  it('matches server rendered text for image alternatives and hard breaks', () => {
    document.body.innerHTML = '<main><p>前 <img alt="图标" src="logo.png"> 后<br>下一行</p></main>'
    const root = document.querySelector('main')
    if (!root) throw new Error('missing fixture')

    expect(getMarkdownRenderedText(root)).toBe('前 图标 后\n下一行')
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

  it('returns null for selections longer than the annotation quote limit', () => {
    const longText = '文'.repeat(DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH + 1)
    document.body.innerHTML = `<main>${longText}</main>`
    const root = document.querySelector('main')
    const text = root?.firstChild
    if (!root || !text) throw new Error('missing fixture')
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, longText.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(createMarkdownAnnotationTargetFromSelection(root, selection)).toBeNull()
  })

  it('creates semantic, source, rendered and CRDT selectors from a projected selection', () => {
    document.body.innerHTML = '<main><p data-drive-markdown-block-id="block">这是 <strong data-drive-markdown-segment-id="segment">重点</strong> 内容</p></main>'
    const root = document.querySelector<HTMLElement>('main')
    const text = document.querySelector('strong')?.firstChild
    if (!root || !text) throw new Error('missing fixture')
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 2)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const doc = new Y.Doc()
    const yText = doc.getText('content')
    yText.insert(0, '这是 **重点** 内容')

    const anchor = createMarkdownAnnotationAnchorFromSelection({
      root,
      selection,
      epoch: 'epoch-1',
      yText,
      projection: {
        schemaVersion: 1,
        parserVersion: 'test',
        sourceSha256: 'test',
        blocks: [{
          blockId: 'block', type: 'paragraph', parentBlockId: null, headingPath: [],
          sourceStart: 0, sourceEnd: 12, renderedStart: 0, renderedEnd: 8, textFingerprint: 'test',
        }],
        segments: [{
          segmentId: 'segment', blockId: 'block', sourceStart: 5, sourceEnd: 7,
          renderedStart: 3, renderedEnd: 5, mapping: 'identity',
        }],
      },
    })

    expect(anchor?.selectors.semantic).toMatchObject({ blockId: 'block', start: 3, end: 5 })
    expect(anchor?.selectors.position).toEqual({ start: 5, end: 7 })
    expect(anchor?.selectors.renderedPosition).toEqual({ start: 3, end: 5 })
    expect(anchor?.selectors.quote.exact).toBe('重点')
    expect(anchor?.selectors.crdt?.epoch).toBe('epoch-1')
    expect(anchor?.selectors.crdt?.start).toBeTruthy()
    doc.destroy()
  })
})
