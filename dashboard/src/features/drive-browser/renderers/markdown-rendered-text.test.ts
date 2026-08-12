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
