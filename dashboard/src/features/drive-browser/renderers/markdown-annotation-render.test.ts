// @vitest-environment jsdom

import type { DriveAnnotationThreadDto, DriveMarkdownProjectionDto } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import { renderMarkdownAnnotationHtml } from './markdown-annotation-render'

describe('renderMarkdownAnnotationHtml', () => {
  it('resolves attached annotation ranges without changing rendered markdown html', () => {
    const html = '<p>这是 <strong>重点</strong> 内容</p>'
    const result = renderMarkdownAnnotationHtml(html, [thread()], 'version-1')

    expect(result.html).toBe(html)
    expect(result.html).not.toContain('data-drive-annotation-thread-id')
    expect(result.html).not.toContain('bg-amber')
    expect(result.html).not.toContain('underline')
    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'attached' })
  })

  it('keeps markdown element structure unchanged for ranges across table and inline code', () => {
    const html = '<table><tbody><tr><td><strong>重点</strong><code>代码</code></td></tr></tbody></table>'
    const result = renderMarkdownAnnotationHtml(html, [thread({
      range: { start: 0, end: 4 },
      quote: { exact: '重点代码', prefix: '', suffix: '' },
    })], 'version-1')

    expect(result.html).toBe(html)
    expect(result.html).not.toContain('<span')
  })

  it('does not write pending annotation markup into markdown html', () => {
    const html = '<p>这是 <strong>重点</strong> 内容</p>'
    const result = renderMarkdownAnnotationHtml(html, [], 'version-1')

    expect(result.html).toBe(html)
    expect(result.html).not.toContain('data-drive-annotation-pending')
    expect(result.html).not.toContain('data-drive-annotation-thread-id')
    expect(result.html).not.toContain('bg-amber')
  })

  it('reattaches shifted ranges by quote context', () => {
    const result = renderMarkdownAnnotationHtml('<p>新增段落。这是重点内容。</p>', [thread({
      range: { start: 2, end: 4 },
      quote: { exact: '重点', prefix: '这是', suffix: '内容' },
    })], 'version-2')

    expect(result.html).toBe('<p>新增段落。这是重点内容。</p>')
    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'shifted', range: { start: 7, end: 9 } })
  })

  it('trusts an unchanged repeated range only on its source version', () => {
    const result = renderMarkdownAnnotationHtml('<p>重复。重复。</p>', [thread({
      range: { start: 0, end: 2 },
      quote: { exact: '重复', prefix: '', suffix: '' },
    })], 'version-1')

    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'attached', range: { start: 0, end: 2 } })
  })

  it('reattaches a unique quote after markdown syntax changes', () => {
    const result = renderMarkdownAnnotationHtml('<p>这是 <em>重点</em> 内容</p>', [thread()], 'version-2')

    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'attached', range: { start: 3, end: 5 } })
  })

  it('leaves orphaned repeated quotes unmarked', () => {
    const result = renderMarkdownAnnotationHtml('<p>重复。重复。</p>', [thread({
      range: { start: 2, end: 4 },
      quote: { exact: '重复', prefix: '', suffix: '' },
    })], 'version-2')

    expect(result.html).not.toContain('data-drive-annotation-thread-id')
    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'orphaned', range: null })
  })

  it('uses quote context to resolve repeated text after a version change', () => {
    const result = renderMarkdownAnnotationHtml('<p>前文重点错误。目标重点内容。</p>', [thread({
      range: { start: 0, end: 2 },
      quote: { exact: '重点', prefix: '目标', suffix: '内容' },
    })], 'version-2')

    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'shifted', range: { start: 9, end: 11 } })
  })

  it('does not trust the old range when repeated text loses its context', () => {
    const result = renderMarkdownAnnotationHtml('<p>重点错误。重点错误。</p>', [thread({
      range: { start: 0, end: 2 },
      quote: { exact: '重点', prefix: '目标', suffix: '内容' },
    })], 'version-2')

    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'orphaned', range: null })
  })

  it('orphanes an annotation when only part of the original quote remains', () => {
    const result = renderMarkdownAnnotationHtml('<p>这是重内容</p>', [thread({
      range: { start: 2, end: 4 },
      quote: { exact: '重点', prefix: '这是', suffix: '内容' },
    })], 'version-2')

    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'orphaned', range: null })
  })

  it('orphanes an annotation when the original quote is fully deleted', () => {
    const result = renderMarkdownAnnotationHtml('<p>这是内容</p>', [thread()], 'version-2')

    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'orphaned', range: null })
  })

  it('reattaches an orphan when its original quote becomes unique again', () => {
    const annotation = thread()
    const missing = renderMarkdownAnnotationHtml('<p>这是内容</p>', [annotation], 'version-2')
    const restored = renderMarkdownAnnotationHtml('<p>这是 <strong>重点</strong> 内容</p>', [annotation], 'version-3')

    expect(missing.resolved[0]).toMatchObject({ anchorStatus: 'orphaned', range: null })
    expect(restored.resolved[0]).toMatchObject({ anchorStatus: 'attached', range: { start: 3, end: 5 } })
  })

  it('uses the live CRDT range instead of a cached attached range after the selection is deleted', () => {
    const text = '锚点前后文'
    const result = renderMarkdownAnnotationHtml(
      `<p>${text}</p>`,
      [anchoredThread()],
      'version-1',
      {
        sourceText: text,
        projection: projection(text),
        resolveCrdtRange: () => ({ start: 2, end: 2 }),
      },
    )

    expect(result.resolved[0]).toMatchObject({
      threadId: 'thread-anchored',
      anchorStatus: 'orphaned',
      positionStatus: 'source_deleted',
      quoteStatus: 'deleted',
      range: null,
    })
  })
})

function thread(input: {
  readonly range?: { readonly start: number; readonly end: number }
  readonly quote?: { readonly exact: string; readonly prefix: string; readonly suffix: string }
} = {}) {
  return {
    id: 'thread-1',
    itemId: 'item-1',
    baseVersionId: 'version-1',
    targetKind: 'textRange' as const,
    target: {
      schemaVersion: 1 as const,
      kind: 'textRange' as const,
      surface: 'markdownRenderedText' as const,
      range: input.range ?? { start: 3, end: 5 },
      quote: input.quote ?? { exact: '重点', prefix: '这是 ', suffix: ' 内容' },
    },
    anchorStatus: 'attached' as const,
    author: { id: 'user-1', email: 'user@example.com', handle: null },
    comments: [],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}

function anchoredThread(): DriveAnnotationThreadDto {
  return {
    ...thread(),
    id: 'thread-anchored',
    anchor: {
      schemaVersion: 2,
      baseVersionId: 'version-1',
      selectors: {
        schemaVersion: 2,
        crdt: { epoch: 'epoch-1', start: 'start', end: 'end' },
        position: { start: 2, end: 7 },
        renderedPosition: { start: 2, end: 7 },
        quote: { exact: '已删除文字', prefix: '锚点', suffix: '前后文' },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: { start: 2, end: 7 },
      resolvedRenderedRange: { start: 2, end: 7 },
      confidence: 1,
      lastResolvedVersionId: 'version-1',
    },
  }
}

function projection(text: string): DriveMarkdownProjectionDto {
  const length = Array.from(text).length
  return {
    schemaVersion: 1,
    parserVersion: 'test',
    sourceSha256: 'test',
    blocks: [{
      blockId: 'block',
      type: 'paragraph',
      parentBlockId: null,
      headingPath: [],
      sourceStart: 0,
      sourceEnd: length,
      renderedStart: 0,
      renderedEnd: length,
      textFingerprint: 'test',
    }],
    segments: [{
      segmentId: 'segment',
      blockId: 'block',
      sourceStart: 0,
      sourceEnd: length,
      renderedStart: 0,
      renderedEnd: length,
      mapping: 'identity',
    }],
  }
}
