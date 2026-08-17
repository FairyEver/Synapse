// @vitest-environment jsdom

import type { DriveMarkdownProjectionDto } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import {
  createMarkdownRenderedDomRange,
  createMarkdownRenderedTextModel,
} from './markdown-rendered-text'

describe('markdown rendered text model', () => {
  it('keeps server offsets aligned across fenced code blocks and structural whitespace', () => {
    document.body.innerHTML = [
      '<main>',
      '<pre><code data-drive-markdown-segment-id="code-1">first\n</code></pre>',
      '<h2>Section</h2>',
      '<pre><code data-drive-markdown-segment-id="code-2">loading\n</code></pre>',
      '<p data-drive-markdown-segment-id="paragraph-1">Pinia</p>',
      '</main>',
    ].join('\n')
    const root = document.querySelector<HTMLElement>('main')
    if (!root) throw new Error('missing fixture')

    const model = createMarkdownRenderedTextModel(root, projection())
    const loadingStart = model.text.indexOf('loading')
    const piniaStart = model.text.indexOf('Pinia')

    expect(model.text).toBe('firstSectionloadingPinia')
    expect(createMarkdownRenderedTextModel(root).text).toBe(model.text)
    expect(createMarkdownRenderedDomRange(root, model.segments, loadingStart, loadingStart + 7)?.toString()).toBe('loading')
    expect(createMarkdownRenderedDomRange(root, model.segments, piniaStart, piniaStart + 5)?.toString()).toBe('Pinia')
  })

  it('ignores formatting whitespace around block children in loose list items', () => {
    document.body.innerHTML = [
      '<main><ul>',
      '<li>\n<p>系统按订单创建时匹配的赠品默认带出赠品。</p>\n</li>',
      '<li>\n<p>赠品信息展示：活动名称、赠送封顶值、是否赠送、赠品名称、物料名称。</p>\n</li>',
      '</ul></main>',
    ].join('\n')
    const root = document.querySelector<HTMLElement>('main')
    if (!root) throw new Error('missing fixture')

    const model = createMarkdownRenderedTextModel(root)
    const nameStart = model.text.lastIndexOf('名称')

    expect(model.text).toBe('系统按订单创建时匹配的赠品默认带出赠品。赠品信息展示：活动名称、赠送封顶值、是否赠送、赠品名称、物料名称。')
    expect(createMarkdownRenderedDomRange(root, model.segments, nameStart, nameStart + 2)?.toString()).toBe('名称')
  })

  it('keeps authored inline list spacing while ignoring nested-list and task-checkbox formatting', () => {
    document.body.innerHTML = [
      '<main><ul>',
      '<li><strong>A</strong> <em>B</em>\n<ul>\n<li>行内子级</li>\n</ul>\n</li>',
      '<li>父级\n<ul>\n<li>子级</li>\n</ul>\n</li>',
      '<li class="task-list-item"><input type="checkbox" checked disabled> 已完成</li>',
      '</ul></main>',
    ].join('\n')
    const root = document.querySelector<HTMLElement>('main')
    if (!root) throw new Error('missing fixture')

    expect(createMarkdownRenderedTextModel(root).text).toBe('A B行内子级父级子级已完成')
  })

  it('counts a rendered hard break once when HTML serialization also adds a newline', () => {
    document.body.innerHTML = '<main><p>前一行<br>\n后一行</p></main>'
    const root = document.querySelector<HTMLElement>('main')
    if (!root) throw new Error('missing fixture')

    const model = createMarkdownRenderedTextModel(root)
    const nextLineStart = model.text.indexOf('后一行')

    expect(model.text).toBe('前一行\n后一行')
    expect(createMarkdownRenderedDomRange(root, model.segments, nextLineStart, nextLineStart + 3)?.toString()).toBe('后一行')
  })

  it('keeps hidden Mermaid source in the projection while ignoring generated SVG text', () => {
    document.body.innerHTML = [
      '<main>',
      '<p>Before</p>',
      '<figure data-drive-mermaid-diagram="true">',
      '<div data-drive-mermaid-rendered="true"><svg><text>Generated label</text></svg></div>',
      '<pre data-drive-mermaid-source="true" class="hidden" aria-hidden="true"><code>flowchart TB\nA --&gt; B</code></pre>',
      '</figure>',
      '<p>After</p>',
      '</main>',
    ].join('')
    const root = document.querySelector<HTMLElement>('main')
    if (!root) throw new Error('missing fixture')

    const model = createMarkdownRenderedTextModel(root)

    expect(model.text).toBe('Beforeflowchart TB\nA --> BAfter')
    expect(model.text).not.toContain('Generated label')
  })

  it('keeps image alt offsets while ignoring the visual fallback copy', () => {
    document.body.innerHTML = [
      '<main><p>Before',
      '<img alt="客户管理" hidden>',
      '<span data-drive-markdown-image-fallback-host="true">客户管理 图片无法显示</span>',
      'After</p></main>',
    ].join('')
    const root = document.querySelector<HTMLElement>('main')
    if (!root) throw new Error('missing fixture')

    expect(createMarkdownRenderedTextModel(root).text).toBe('Before客户管理After')
  })
})

function projection(): DriveMarkdownProjectionDto {
  return {
    schemaVersion: 1,
    parserVersion: 'test',
    sourceSha256: 'test',
    blocks: [],
    segments: [
      {
        segmentId: 'code-1',
        blockId: 'block-1',
        sourceStart: 0,
        sourceEnd: 12,
        renderedStart: 0,
        renderedEnd: 5,
        mapping: 'markdown_syntax',
      },
      {
        segmentId: 'code-2',
        blockId: 'block-2',
        sourceStart: 13,
        sourceEnd: 27,
        renderedStart: 12,
        renderedEnd: 19,
        mapping: 'markdown_syntax',
      },
      {
        segmentId: 'paragraph-1',
        blockId: 'block-3',
        sourceStart: 28,
        sourceEnd: 33,
        renderedStart: 19,
        renderedEnd: 24,
        mapping: 'identity',
      },
    ],
  }
}
