// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  headingsPlugin,
  listsPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { createMdxEditorTextModel } from './mdxeditor-comment-geometry'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect())
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList)
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  host = null
  root = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MDXEditor comment text integration', () => {
  it('keeps visible text order across headings, formatting, lists, quotes, and table cells', async () => {
    const markdown = [
      '# 标题',
      '',
      '普通 **目标🙂**',
      '',
      '- 列表项',
      '',
      '> 引用',
      '',
      '| 第一列 | 第二列 |',
      '| --- | --- |',
      '| 单元格 | 尾部 |',
    ].join('\n')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          markdown={markdown}
          contentEditableClassName='drive-mdxeditor-content'
          plugins={[headingsPlugin(), listsPlugin(), quotePlugin(), tablePlugin()]}
        />
      )
      await Promise.resolve()
    })

    const content = document.querySelector<HTMLElement>('.drive-mdxeditor-content')
    if (!content) throw new Error('MDXEditor did not render the content editable')
    const model = createMdxEditorTextModel(content)

    expect(model.text).toContain('标题普通 目标🙂列表项引用')
    expect(model.text).toContain('第一列第二列单元格尾部')
    expect(model.text.indexOf('目标🙂')).toBeLessThan(model.text.indexOf('单元格'))
  })
})
