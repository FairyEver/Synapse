// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderMarkdownAnnotationHtml } from './markdown-annotation-render'

describe('renderMarkdownAnnotationHtml', () => {
  it('wraps attached annotation ranges in rendered markdown html', () => {
    const result = renderMarkdownAnnotationHtml('<p>这是 <strong>重点</strong> 内容</p>', [thread()])

    expect(result.html).toContain('data-drive-annotation-thread-id="thread-1"')
    expect(result.html).toContain('重点')
    expect(result.resolved[0]).toMatchObject({ threadId: 'thread-1', anchorStatus: 'attached' })
  })

  it('reattaches shifted ranges by quote context', () => {
    const result = renderMarkdownAnnotationHtml('<p>新增段落。这是重点内容。</p>', [thread({
      range: { start: 2, end: 4 },
      quote: { exact: '重点', prefix: '这是', suffix: '内容' },
    })])

    expect(result.html).toContain('data-drive-annotation-thread-id="thread-1"')
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
