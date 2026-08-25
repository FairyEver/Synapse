// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codeBlockPlugin,
  codeMirrorPlugin,
  GenericJsxEditor,
  jsxPlugin,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  listsPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import {
  commonMarkTextCompatibilityPlugin,
  commonMarkToMarkdownOptions,
} from './mdxeditor-commonmark-compatibility-plugin'
import { orderedListStartPlugin } from './mdxeditor-ordered-list-start-plugin'

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
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  host = null
  root = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MDXEditor list integration', () => {
  it('keeps CommonMark comparisons out of MDX parsing in text and code contexts', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    const onError = vi.fn()
    const markdown = [
      '正文 a <= b。',
      '',
      '行内代码 `a <= b`。',
      '',
      '转义比较 a \\<= b。',
      '',
      '```tsx',
      'const ok = a <= b',
      '```',
    ].join('\n')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown={markdown}
          onError={onError}
          toMarkdownOptions={commonMarkToMarkdownOptions}
          plugins={[commonMarkTextCompatibilityPlugin(), codeBlockPlugin(), codeMirrorPlugin()]}
        />
      )
      await Promise.resolve()
    })

    expect(onError).not.toHaveBeenCalled()
    expect(editorRef.current?.getMarkdown()).toContain('正文 a <= b。')
    expect(editorRef.current?.getMarkdown()).toContain('`a <= b`')
    expect(editorRef.current?.getMarkdown()).toContain('const ok = a <= b')
  })

  it('keeps CommonMark HTML, escapes, comments, and JSX-looking code in Markdown mode', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    const onError = vi.fn()
    const markdown = [
      '<span title="a <= b">HTML</span>',
      '',
      String.raw`转义标签 \<Callout />`,
      '',
      '行内 `<Badge value={a <= b} />`',
      '',
      '```jsx',
      '<Callout value={a <= b} />',
      '```',
    ].join('\n')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown={markdown}
          onError={onError}
          toMarkdownOptions={commonMarkToMarkdownOptions}
          plugins={[commonMarkTextCompatibilityPlugin(), codeBlockPlugin(), codeMirrorPlugin()]}
        />
      )
      await Promise.resolve()
    })

    const savedMarkdown = editorRef.current?.getMarkdown() ?? ''
    expect(onError).not.toHaveBeenCalled()
    expect(savedMarkdown).toContain('<span title="a <= b">HTML</span>')
    expect(savedMarkdown).toContain(String.raw`\<Callout />`)
    expect(savedMarkdown).toContain('`<Badge value={a <= b} />`')
    expect(savedMarkdown).toContain('<Callout value={a <= b} />')
  })

  it('parses and preserves a valid MDX component with the generic JSX editor', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    const onError = vi.fn()
    const markdown = '<Callout tone="info">正文</Callout>'
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown={markdown}
          onError={onError}
          plugins={[jsxPlugin({
            jsxComponentDescriptors: [{
              name: '*',
              kind: 'flow',
              props: [],
              hasChildren: true,
              Editor: GenericJsxEditor,
            }],
          })]}
        />
      )
      await Promise.resolve()
    })

    expect(onError).not.toHaveBeenCalled()
    expect(editorRef.current?.getMarkdown()).toBe(markdown)
  })

  it('preserves MDX attributes, expressions, inline components, and comments', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    const onError = vi.fn()
    const markdown = [
      '<Callout tone={"info"}>',
      '  正文 <Badge>{count}</Badge>',
      '  {/* keep this comment */}',
      '</Callout>',
    ].join('\n')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown={markdown}
          onError={onError}
          plugins={[jsxPlugin({
            jsxComponentDescriptors: [{
              name: '*',
              kind: 'flow',
              props: [],
              hasChildren: true,
              Editor: GenericJsxEditor,
            }],
          })]}
        />
      )
      await Promise.resolve()
    })

    const savedMarkdown = editorRef.current?.getMarkdown() ?? ''
    expect(onError).not.toHaveBeenCalled()
    expect(savedMarkdown).toContain('<Callout tone={"info"}>')
    expect(savedMarkdown).toContain('<Badge>{count}</Badge>')
    expect(savedMarkdown).toContain('{/* keep this comment */}')
  })

  it('converts selected text between ordered and unordered lists with the real toolbar', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown='普通段落'
          plugins={[
            toolbarPlugin({ toolbarContents: () => <ListsToggle options={['bullet', 'number']} /> }),
            listsPlugin(),
          ]}
          contentEditableClassName='[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6'
        />
      )
      await Promise.resolve()
    })

    const contentEditable = document.querySelector<HTMLElement>('[contenteditable="true"]')
    const paragraphText = contentEditable?.querySelector('p')?.firstChild
    if (!contentEditable || !paragraphText) throw new Error('MDXEditor did not render the paragraph')

    await setCollapsedSelection(contentEditable, paragraphText)
    await clickToolbarButton('Numbered list')

    expect(contentEditable.querySelector('ol')?.textContent).toBe('普通段落')
    expect(editorRef.current?.getMarkdown()).toBe('1. 普通段落')

    const orderedText = contentEditable.querySelector('ol li')?.firstChild
    if (!orderedText) throw new Error('MDXEditor did not render the ordered list')
    await setCollapsedSelection(contentEditable, orderedText)
    await clickToolbarButton('Bulleted list')

    expect(contentEditable.querySelector('ul')?.textContent).toBe('普通段落')
    expect(editorRef.current?.getMarkdown()).toBe('* 普通段落')
  })

  it('renders markers, indents with Tab, outdents with Shift+Tab, and preserves Markdown', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    const markdown = '1. 一级\n2. 二级\n\n* 无序'
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown={markdown}
          plugins={[listsPlugin(), orderedListStartPlugin()]}
          contentEditableClassName='[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6'
        />
      )
      await Promise.resolve()
    })

    const contentEditable = document.querySelector<HTMLElement>('[contenteditable="true"]')
    const orderedList = contentEditable?.querySelector('ol')
    const secondListItem = orderedList?.querySelectorAll('li')[1]
    const secondText = secondListItem?.firstChild
    if (!contentEditable || !orderedList || !secondListItem || !secondText) {
      throw new Error('MDXEditor did not render the ordered list')
    }

    expect(contentEditable.className).toContain('[&_ol]:list-decimal')
    expect(contentEditable.className).toContain('[&_ul]:list-disc')
    expect(contentEditable.querySelector('ul')?.textContent).toBe('无序')
    expect(orderedList.children).toHaveLength(2)
    await setCollapsedSelection(contentEditable, secondText)
    await dispatchTab(contentEditable)

    const nestedOrderedList = orderedList.querySelector('li ol')
    expect(nestedOrderedList?.textContent).toBe('二级')
    expect(editorRef.current?.getMarkdown()).toContain('   1. 二级')

    const nestedText = nestedOrderedList?.querySelector('li')?.firstChild
    if (!nestedText) throw new Error('MDXEditor did not indent the second list item')
    await setCollapsedSelection(contentEditable, nestedText)
    await dispatchTab(contentEditable, true)

    expect(orderedList.children).toHaveLength(2)
    expect(editorRef.current?.getMarkdown()).toBe(markdown)
  })

  it('preserves ordered starts, mixed nesting, task items, and an empty item', async () => {
    const editorRef = createRef<MDXEditorMethods>()
    const markdown = [
      '3. 起始第三项',
      '4. 第二项',
      '   - 二级无序',
      '     1. 三级有序',
      '',
      '- [x] 已完成',
      '- [ ] 未完成',
      '-',
    ].join('\n')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        <MDXEditor
          ref={editorRef}
          markdown={markdown}
          plugins={[listsPlugin(), orderedListStartPlugin()]}
          contentEditableClassName='[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6'
        />
      )
      await Promise.resolve()
    })

    const contentEditable = document.querySelector<HTMLElement>('[contenteditable="true"]')
    const savedMarkdown = editorRef.current?.getMarkdown() ?? ''
    expect(savedMarkdown).toMatch(/^3\. 起始第三项\n4\. 第二项/u)
    expect(savedMarkdown).toMatch(/\n {3}[*-] 二级无序\n {5}1\. 三级有序/u)
    expect(savedMarkdown).toMatch(/\n[*-] \[x\] 已完成\n[*-] \[ \] 未完成\n[*-]$/u)
    expect(contentEditable?.querySelector('ol')?.getAttribute('start')).toBe('3')
    expect(contentEditable?.querySelectorAll('ol ul ol')).toHaveLength(1)
    const taskItems = contentEditable?.querySelectorAll('li[role="checkbox"]') ?? []
    expect(taskItems).toHaveLength(3)
    expect(Array.from(taskItems, (item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
  })
})

async function setCollapsedSelection(contentEditable: HTMLElement, node: Node) {
  await act(async () => {
    contentEditable.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await Promise.resolve()
  })
}

async function dispatchTab(target: HTMLElement, shiftKey = false) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    }))
    await Promise.resolve()
  })
}

async function clickToolbarButton(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Missing toolbar button: ${label}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}
