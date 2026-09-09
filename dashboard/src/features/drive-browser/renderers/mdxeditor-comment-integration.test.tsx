// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { createMdxEditorTextModel } from './mdxeditor-comment-geometry'
import {
  commonMarkTextCompatibilityPlugin,
  commonMarkToMarkdownOptions,
  prepareCommonMarkForMdxEditor,
} from './mdxeditor-commonmark-compatibility-plugin'

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
  vi.stubGlobal('Image', class Image {
    onerror: ((event: Event) => void) | null = null
    onload: ((event: Event) => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event('load')))
    }
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
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const content = document.querySelector<HTMLElement>('.drive-mdxeditor-content')
    if (!content) throw new Error('MDXEditor did not render the content editable')
    const model = createMdxEditorTextModel(content)

    expect(model.text).toContain('标题普通 目标🙂列表项引用')
    expect(model.text).toContain('第一列第二列单元格尾部')
    expect(model.text.indexOf('目标🙂')).toBeLessThan(model.text.indexOf('单元格'))
  })

  it('keeps the comment text stream aligned across rich Markdown structures', async () => {
    const source = [
      '# Heading',
      '',
      'Before **bold🙂**',
      '',
      '3. ordered',
      '4. second',
      '',
      '- parent',
      '  1. nested',
      '',
      '- loose first',
      '',
      '  loose second',
      '',
      'List separator',
      '',
      '- [x] task',
      '',
      '> quote',
      '',
      '| Head | Value |',
      '| --- | --- |',
      '| Cell | End |',
      '',
      '```ts',
      'const value = "😀"',
      'return value',
      '```',
      '',
      'Escaped \\*plain\\* &amp; [link](https://example.com) ~~gone~~',
      '',
      '---',
      '',
      'Before image ![inline](inline.png) after.',
      '',
      '![block](block.png "Caption")',
      '',
      'Before break  ',
      'After break',
      '',
      'Formula $x + 1$ end',
      '',
      '<span data-kind="note">raw html</span>',
      '',
      '<!-- hidden comment -->',
      '',
      '<div>',
      'raw block html',
      '</div>',
      '',
      'After',
    ].join('\n')
    const prepared = prepareCommonMarkForMdxEditor(source)
    const editorRef = createRef<MDXEditorMethods>()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown={prepared.markdown}
          toMarkdownOptions={commonMarkToMarkdownOptions}
          contentEditableClassName='drive-mdxeditor-content'
          plugins={[
            commonMarkTextCompatibilityPlugin(),
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            tablePlugin(),
            codeBlockPlugin(),
            codeMirrorPlugin(),
            imagePlugin(),
            linkPlugin(),
            thematicBreakPlugin(),
          ]}
        />
      )
      await Promise.resolve()
    })

    const content = document.querySelector<HTMLElement>('.drive-mdxeditor-content')
    if (!content) throw new Error('MDXEditor did not render the content editable')
    const model = createMdxEditorTextModel(content)

    expect(model.text).toBe('HeadingBefore bold🙂orderedsecondparentnestedloose firstloose secondList separatortaskquoteHeadValueCellEndconst value = "😀"\nreturn valueEscaped *plain* & link goneBefore image inline after.blockBefore break\nAfter breakFormula $x + 1$ endraw htmlAfter')
    const roundTripped = editorRef.current?.getMarkdown() ?? ''
    expect(roundTripped).toMatch(/[*-](?: \[[ xX]\])? loose first\n\s*\n\s+loose second/u)
    expect(roundTripped).toMatch(/<div>\n\s+raw block html\n<\/div>/u)
    expect(roundTripped).toContain('Before break\\\nAfter break')
  })
})
