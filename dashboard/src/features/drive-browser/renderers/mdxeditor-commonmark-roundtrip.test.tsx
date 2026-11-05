// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codeBlockPlugin,
  codeMirrorPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  type MDXEditorMethods,
  tablePlugin,
} from '@mdxeditor/editor'
import { commonMarkEditorPlugins, commonMarkEditorProps } from './mdxeditor-commonmark-config'
import { prepareCommonMarkForMdxEditor } from './mdxeditor-commonmark-compatibility-plugin'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect())
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('Image', function Image() {
    const image = document.createElement('img')
    Object.defineProperty(image, 'src', {
      get: () => image.getAttribute('src') ?? '',
      set(value: string) {
        image.setAttribute('src', value)
        queueMicrotask(() => image.onload?.(new Event('load')))
      },
    })
    return image
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shared Drive CommonMark editor round trips', () => {
  it.each([
    { source: '<你好>，金额 <= 1000。', preserved: ['<你好>', '<= 1000'] },
    { source: '返回 List<OrderDTO> 和 CommonResult<PageResult<RespVO>>。', preserved: ['List<OrderDTO>', 'CommonResult<PageResult<RespVO>>'] },
    { source: '未闭合 <Callout>，表达式 {value}，结尾 <', preserved: ['<Callout>', '{value}'] },
    { source: '<https://example.com/a?q=1>\n\n联系 <user@example.com>', preserved: ['<https://example.com/a?q=1>', '<user@example.com>'] },
    { source: '<span title="a <= b">HTML</span>\n\n<div>\n原始 HTML\n</div>', preserved: ['<span title="a <= b">HTML</span>', '<div>\n原始 HTML\n</div>'] },
    { source: '正文 <!-- inline -->\n\n<!-- block\n<你好> <=\n-->', preserved: ['<!-- inline -->', '<!-- block\n<你好> <=\n-->'] },
    { source: '| A | B |\n| --- | --- |\n| 第一行<br>第二行 | List<OrderDTO> |', preserved: ['第一行<br>第二行', 'List<OrderDTO>'] },
    { source: '![相对图片](./images/chart.png "说明")\n\n![托管图片](/object/image-id)', preserved: ['./images/chart.png', '"说明"', '/object/image-id'] },
    { source: '<img src="./images/chart.png" alt="图" title="说明">', preserved: ['./images/chart.png', '"说明"', '图'] },
    { source: '<img src="./chart.png" width="100%" alt="图">', preserved: ['<img src="./chart.png" width="100%" alt="图">'] },
    { source: '<img src="./chart.png?a=&quot;hi&quot;" width="20" alt="图">', preserved: ['<img src="./chart.png?a=&quot;hi&quot;" width="20" alt="图">'] },
    { source: '<img src="x" onerror="alert(1)">\n<script>alert(2)</script>\n尾部内容', preserved: ['onerror="alert(1)"', '<script>alert(2)</script>', '尾部内容'] },
    { source: '行内 `<你好> <= <br>`\n\n```html\n<你好>\n<br>\n<!-- code -->\n```', preserved: ['`<你好> <= <br>`', '<你好>\n<br>\n<!-- code -->'] },
    { source: '3. 起始第三项\n4. 第二项\n\n   7. 嵌套从七开始', preserved: ['3. 起始第三项', '4. 第二项', '7. 嵌套从七开始'] },
  ])('preserves content through editing and reopening: $source', async ({ source, preserved }) => {
    const onError = vi.fn()
    const ref = createRef<MDXEditorMethods>()
    const mount = async (markdown: string, key: string) => {
      await act(async () => {
        root.render(<MDXEditor {...commonMarkEditorProps} key={key} ref={ref}
          markdown={prepareCommonMarkForMdxEditor(markdown).markdown} onError={onError}
          plugins={[linkPlugin({ disableAutoLink: true }), listsPlugin(), tablePlugin(), imagePlugin(), codeBlockPlugin(), codeMirrorPlugin(), ...commonMarkEditorPlugins()]} />)
        await Promise.resolve()
      })
    }
    await mount(source, 'original')
    expect(onError).not.toHaveBeenCalled()
    await act(async () => {
      ref.current?.focus(() => ref.current?.insertMarkdown('\n\n追加内容'), { defaultSelection: 'rootEnd' })
      await Promise.resolve()
    })
    const saved = ref.current?.getMarkdown() ?? ''
    for (const fragment of preserved) expect(saved).toContain(fragment)
    expect(saved).toContain('追加内容')
    await mount(saved, 'reopened')
    expect(onError).not.toHaveBeenCalled()
    const reopened = ref.current?.getMarkdown() ?? ''
    for (const fragment of preserved) expect(reopened).toContain(fragment)
    expect(reopened).toContain('追加内容')
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('[onerror]')).toBeNull()
  })
})
