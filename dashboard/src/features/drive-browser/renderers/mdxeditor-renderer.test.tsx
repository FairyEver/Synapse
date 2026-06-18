// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
} from '@synapse/shared'
import { ApiError } from '@/lib/api'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import type { DriveRendererEditContext } from './drive-renderer-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@mdxeditor/editor/style.css', () => ({}))

vi.mock('@mdxeditor/editor', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    MDXEditor: ({
      markdown,
      readOnly,
      onChange,
    }: {
      readonly markdown: string
      readonly readOnly?: boolean
      readonly onChange?: (value: string) => void
    }) => React.createElement('textarea', {
      'data-mdxeditor': 'true',
      readOnly,
      value: markdown,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.currentTarget.value),
    }),
    codeBlockPlugin: () => null,
    codeMirrorPlugin: () => null,
    headingsPlugin: () => null,
    linkDialogPlugin: () => null,
    linkPlugin: () => null,
    listsPlugin: () => null,
    markdownShortcutPlugin: () => null,
    quotePlugin: () => null,
    tablePlugin: () => null,
    thematicBreakPlugin: () => null,
  }
})

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveMDXeditorRenderer', () => {
  it('saves dirty markdown text with the current base version', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    expect(document.body.textContent).toContain('已同步')
    await inputValue(editor(), '# Next')

    expect(document.body.textContent).toContain('未保存')
    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({ text: '# Next', baseVersionId: 'version-1' })
    expect(document.body.textContent).toContain('已同步')
  })

  it('reloads and clears dirty state', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Draft')
    await click(buttonWithText('重新加载'))

    expect(editContext.reload).toHaveBeenCalled()
    expect(editor().value).toBe('# Notes')
    expect(document.body.textContent).toContain('已同步')
  })

  it('renders read-only when editing is unavailable', () => {
    renderRenderer({ edit: null })

    expect(editor().readOnly).toBe(true)
    expect(document.body.textContent).toContain('只读')
  })

  it('shows login action when edit requires authentication', () => {
    renderRenderer({
      edit: {
        ...editable(),
        canEdit: false,
        currentVersionId: null,
        reason: 'login_required',
      },
    })

    expect(editor().readOnly).toBe(true)
    expect(anchorWithText('登录后编辑').getAttribute('href')).toContain('/sign-in?redirect=')
  })

  it('opens a conflict dialog and can reload after a version conflict', async () => {
    const editContext = createEditContext()
    editContext.saveText.mockRejectedValue(new ApiError('版本冲突', 409))
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Local')
    await click(buttonWithText('保存'))

    expect(document.body.textContent).toContain('文件已有新内容')
    expect(document.body.textContent).toContain('下载本地版本')

    await click(buttonWithText('重新加载'))

    expect(editContext.reload).toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('文件已有新内容')
  })

  it('shows truncated markdown state', () => {
    renderRenderer({ preview: { ...basePreview(), truncated: true } })

    expect(document.body.textContent).toContain('内容已截断')
  })
})

function renderRenderer(input: {
  readonly preview?: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
} = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(
      <DriveMDXeditorRenderer
        current={baseCurrent()}
        preview={input.preview ?? basePreview()}
        edit={input.edit === undefined ? editable() : input.edit}
        editContext={input.editContext ?? createEditContext()}
      />
    )
  })
}

function baseCurrent(): DriveBrowserItemDto {
  return {
    id: 'file',
    name: 'notes.md',
    type: 'file',
    size: '11',
    mimeType: 'text/markdown',
    updatedAt: '2026-06-09T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/drive/items/file',
    downloadUrl: '/drive/items/file/download',
  }
}

function basePreview(): DriveBrowserPreviewDto {
  return {
    kind: 'markdown',
    text: '# Notes',
    html: '<h1>Notes</h1>',
    outline: null,
    truncated: false,
    imageUrl: null,
    visitUrl: null,
  }
}

function editable(): DriveBrowserEditDto {
  return {
    canEdit: true,
    editorKind: 'text',
    currentVersionId: 'version-1',
    maxInlineEditBytes: '1048576',
    reason: null,
  }
}

function createEditContext() {
  return {
    reload: vi.fn(async () => ({}) as never),
    reloading: false,
    saveText: vi.fn(async () => ({}) as never),
    savingText: false,
  }
}

async function inputValue(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

function editor(): HTMLTextAreaElement {
  const element = document.querySelector('[data-mdxeditor="true"]')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('mdx editor not found')
  return element
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}

function anchorWithText(text: string): HTMLAnchorElement {
  const anchor = Array.from(document.querySelectorAll('a')).find((item) => item.textContent?.includes(text))
  if (!(anchor instanceof HTMLAnchorElement)) throw new Error(`${text} anchor not found`)
  return anchor
}
