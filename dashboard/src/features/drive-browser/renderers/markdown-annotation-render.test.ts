// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderMarkdownAnnotationHtml } from './markdown-annotation-render'

describe('renderMarkdownAnnotationHtml', () => {
  it('resolves attached annotation ranges without changing rendered markdown html', () => {
    const html = '<p>这是 <strong>重点</strong> 内容</p>'
    const result = renderMarkdownAnnotationHtml(html, [thread()])

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
    })])

    expect(result.html).toBe(html)
    expect(result.html).not.toContain('<span')
  })

  it('does not write pending annotation markup into markdown html', () => {
    const html = '<p>这是 <strong>重点</strong> 内容</p>'
    const result = renderMarkdownAnnotationHtml(html, [], {
      schemaVersion: 1,
      kind: 'textRange',
      surface: 'markdownRenderedText',
      range: { start: 3, end: 5 },
      quote: { exact: '重点', prefix: '这是 ', suffix: ' 内容' },
    })

    expect(result.html).toBe(html)
    expect(result.html).not.toContain('data-drive-annotation-pending')
    expect(result.html).not.toContain('data-drive-annotation-thread-id')
    expect(result.html).not.toContain('bg-amber')
  })

  it('reattaches shifted ranges by quote context', () => {
    const result = renderMarkdownAnnotationHtml('<p>新增段落。这是重点内容。</p>', [thread({
      range: { start: 2, end: 4 },
      quote: { exact: '重点', prefix: '这是', suffix: '内容' },
    })])

    expect(result.html).toBe('<p>新增段落。这是重点内容。</p>')
    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'shifted', range: { start: 7, end: 9 } })
  })

  it('leaves orphaned repeated quotes unmarked', () => {
    const result = renderMarkdownAnnotationHtml('<p>重复。重复。</p>', [thread({
      range: { start: 2, end: 4 },
      quote: { exact: '重复', prefix: '', suffix: '' },
    })])

    expect(result.html).not.toContain('data-drive-annotation-thread-id')
    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'orphaned', range: null })
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
    author: { id: 'user-1', email: 'user@example.com', displayName: null },
    comments: [],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}
