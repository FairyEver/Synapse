// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DrivePublicAssetDto,
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveBrowserSnapshotDto,
} from '@synapse/shared'
import { ApiError, driveBrowserApi } from '@/lib/api'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@mdxeditor/editor/style.css', () => ({}))

vi.mock('@mdxeditor/editor', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const pluginCalls = new Set<string>()
  const collectToolbarControls = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return
      const type = child.type
      if (typeof type === 'function' && type.name) pluginCalls.add(type.name)
      collectToolbarControls(child.props.children)
    })
  }

  return {
    MDXEditor: React.forwardRef(({
      markdown,
      readOnly,
      onChange,
      plugins,
    }: {
      readonly markdown: string
      readonly readOnly?: boolean
      readonly onChange?: (value: string, initialMarkdownNormalize?: boolean) => void
      readonly plugins?: readonly unknown[]
    }, ref: React.Ref<{ setMarkdown: (value: string) => void }>) => {
      const [value, setValue] = React.useState(markdown)
      const valueRef = React.useRef(markdown)
      const updateValue = (nextValue: string) => {
        valueRef.current = nextValue
        setValue(nextValue)
        onChange?.(nextValue)
      }
      React.useImperativeHandle(ref, () => ({
        getMarkdown: () => valueRef.current,
        setMarkdown: (nextValue: string) => {
          valueRef.current = nextValue
          setValue(nextValue)
        },
        insertMarkdown: (markdownValue: string) => updateValue(`${valueRef.current}${markdownValue}`),
        focus: (callback?: () => void) => callback?.(),
      }), [])

      const toolbarContents = plugins
        ?.map((plugin) => (plugin as { readonly toolbarContents?: () => React.ReactNode }).toolbarContents?.())
        .filter(Boolean)
      return React.createElement(React.Fragment, null,
        React.createElement('div', { 'data-testid': 'mdx-toolbar' }, toolbarContents),
        React.createElement('textarea', {
          'data-mdxeditor': 'true',
          'data-toolbar-plugin': String(pluginCalls.has('toolbarPlugin') && Boolean(plugins?.length)),
          'data-toolbar-controls': Array.from(pluginCalls).join(','),
          readOnly,
          value,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.currentTarget.value)
            onChange?.(event.currentTarget.value, event.currentTarget.dataset.initialNormalize === 'true')
          },
        })
      )
    }),
    BlockTypeSelect: () => {
      pluginCalls.add('BlockTypeSelect')
      return null
    },
    BoldItalicUnderlineToggles: () => {
      pluginCalls.add('BoldItalicUnderlineToggles')
      return null
    },
    CreateLink: () => {
      pluginCalls.add('CreateLink')
      return null
    },
    InsertTable: () => {
      pluginCalls.add('InsertTable')
      return null
    },
    InsertThematicBreak: () => {
      pluginCalls.add('InsertThematicBreak')
      return null
    },
    ListsToggle: () => {
      pluginCalls.add('ListsToggle')
      return null
    },
    UndoRedo: () => {
      pluginCalls.add('UndoRedo')
      return null
    },
    codeBlockPlugin: () => ({ name: 'codeBlockPlugin' }),
    codeMirrorPlugin: () => ({ name: 'codeMirrorPlugin' }),
    headingsPlugin: () => ({ name: 'headingsPlugin' }),
    imagePlugin: (input: { readonly imageUploadHandler: (file: File) => Promise<string> }) => {
      pluginCalls.add('imagePlugin')
      return { name: 'imagePlugin', imageUploadHandler: input.imageUploadHandler }
    },
    linkDialogPlugin: () => ({ name: 'linkDialogPlugin' }),
    linkPlugin: () => ({ name: 'linkPlugin' }),
    listsPlugin: () => ({ name: 'listsPlugin' }),
    markdownShortcutPlugin: () => ({ name: 'markdownShortcutPlugin' }),
    quotePlugin: () => ({ name: 'quotePlugin' }),
    tablePlugin: () => ({ name: 'tablePlugin' }),
    thematicBreakPlugin: () => ({ name: 'thematicBreakPlugin' }),
    toolbarPlugin: (input: { readonly toolbarContents: () => React.ReactNode }) => {
      pluginCalls.add('toolbarPlugin')
      collectToolbarControls(input.toolbarContents())
      return { name: 'toolbarPlugin', toolbarContents: input.toolbarContents }
    },
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
  vi.restoreAllMocks()
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

  it('resets the mounted editor content after reload', async () => {
    const editContext = createEditContext({
      reload: vi.fn(async () => baseSnapshot({ preview: { ...basePreview(), text: '# Server' } })),
    })
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Draft')
    await click(buttonWithText('重新加载'))

    expect(editor().value).toBe('# Server')
    expect(document.body.textContent).toContain('已同步')
  })

  it('syncs mounted editor content when the file or version changes', () => {
    const { rerender } = renderRenderer({ edit: editable() })

    expect(editor().value).toBe('# Notes')

    rerender({
      current: { ...baseCurrent(), id: 'other-file', name: 'other.md' },
      preview: { ...basePreview(), text: '# Other' },
      edit: { ...editable(), currentVersionId: 'version-2' },
    })

    expect(editor().value).toBe('# Other')
    expect(document.body.textContent).toContain('已同步')
  })

  it('does not mark initial markdown normalization as dirty', async () => {
    renderRenderer({ edit: editable() })

    await inputValue(editor(), '# Notes\n', true)

    expect(document.body.textContent).not.toContain('未保存')
    expect(document.body.textContent).toContain('已同步')
    expect(buttonWithText('保存').disabled).toBe(true)
  })

  it('disables save until dirty and while saving or reloading', async () => {
    const { rerender } = renderRenderer({ edit: editable() })

    expect(buttonWithText('保存').disabled).toBe(true)

    await inputValue(editor(), '# Draft')
    rerender({ edit: editable(), editContext: createEditContext({ savingText: true }) })

    expect(buttonWithText('保存').disabled).toBe(true)
    expect(buttonWithText('重新加载').disabled).toBe(true)

    rerender({ edit: editable(), editContext: createEditContext({ reloading: true }) })

    expect(buttonWithText('保存').disabled).toBe(true)
    expect(buttonWithText('重新加载').disabled).toBe(true)
  })

  it('does not save read-only input changes', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: null, editContext })

    await inputValue(editor(), '# Read only')

    expect(editor().readOnly).toBe(true)
    expect(editContext.saveText).not.toHaveBeenCalled()
  })

  it('keeps local text after a save conflict', async () => {
    const editContext = createEditContext()
    editContext.saveText.mockRejectedValue(new ApiError('版本冲突', 409))
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Local')
    await click(buttonWithText('保存'))

    expect(editor().value).toBe('# Local')
    expect(document.body.textContent).toContain('未保存')
  })

  it('registers the default markdown toolbar controls', () => {
    renderRenderer({ edit: editable() })

    expect(editor().dataset.toolbarPlugin).toBe('true')
    expect(editor().dataset.toolbarControls?.split(',')).toEqual(expect.arrayContaining([
      'toolbarPlugin',
      'UndoRedo',
      'BlockTypeSelect',
      'BoldItalicUnderlineToggles',
      'ListsToggle',
      'CreateLink',
      'imagePlugin',
      'InsertTable',
      'InsertThematicBreak',
    ]))
    expect(buttonWithText('插入图片')).toBeInstanceOf(HTMLButtonElement)
  })

  it('uploads a selected image and inserts markdown at the editor cursor', async () => {
    vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile').mockResolvedValue(createPublicAsset({
      name: 'chart.png',
      url: 'https://synapse.test/files/asset_image',
    }))
    renderRenderer({ edit: editable() })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))

    expect(driveBrowserApi.uploadPublicAssetFile).toHaveBeenCalledWith(
      expect.any(File),
      { name: 'chart.png', mimeType: 'image/png' }
    )
    expect(editor().value).toBe('# Notes![chart](https://synapse.test/files/asset_image)')
    expect(document.body.textContent).toContain('未保存')
  })

  it('rejects unsupported selected image formats before uploading', async () => {
    const upload = vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile')
    renderRenderer({ edit: editable() })

    await selectImage(new File(['<svg />'], 'vector.svg', { type: 'image/svg+xml' }))

    expect(upload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('格式不支持。')
  })

  it('renders read-only when editing is unavailable', () => {
    renderRenderer({ edit: null })

    expect(editor().readOnly).toBe(true)
    expect(document.body.textContent).toContain('只读')
  })

  it('shows login action when edit requires authentication', () => {
    window.history.pushState(null, '', '/share/share-1')
    renderRenderer({
      edit: {
        ...editable(),
        canEdit: false,
        currentVersionId: null,
        reason: 'login_required',
      },
    })

    expect(editor().readOnly).toBe(true)
    expect(anchorWithText('登录后编辑').getAttribute('href')).toBe('/console/sign-in?redirect=%2Fshare%2Fshare-1')
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
  readonly current?: DriveBrowserItemDto
  readonly preview?: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
} = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  const render = (nextInput: typeof input) => {
    root?.render(
      <DriveRendererToolbarProvider>
        <ToolbarHost />
        <DriveMDXeditorRenderer
          current={nextInput.current ?? baseCurrent()}
          preview={nextInput.preview ?? basePreview()}
          edit={nextInput.edit === undefined ? editable() : nextInput.edit}
          editContext={nextInput.editContext ?? createEditContext()}
        />
      </DriveRendererToolbarProvider>
    )
  }

  act(() => {
    render(input)
  })

  return {
    rerender: (nextInput: typeof input) => {
      act(() => {
        render(nextInput)
      })
    },
  }
}

function ToolbarHost() {
  const toolbar = useDriveRendererToolbar()
  return (
    <div data-testid='toolbar'>
      {toolbar.items.map((item) => <DrivePreviewToolbarItemView key={item.id} item={item} />)}
    </div>
  )
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

function baseSnapshot(input: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: baseCurrent(),
    breadcrumbs: [{ id: 'root', name: 'root', browserUrl: '/drive/items/root' }],
    children: [],
    preview: basePreview(),
    edit: editable(),
    canDownload: true,
    canZip: false,
    ...input,
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

function createPublicAsset(overrides: Partial<DrivePublicAssetDto> = {}): DrivePublicAssetDto {
  return {
    assetId: 'asset_image',
    itemId: 'item_image',
    name: 'image.png',
    size: '5',
    mimeType: 'image/png',
    url: 'https://synapse.test/files/asset_image',
    lifecycleStatus: 'active',
    accessCount: '0',
    responseBytes: '0',
    lastAccessedAt: null,
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z',
    ...overrides,
  }
}

function createEditContext(input: Partial<DriveRendererEditContext> = {}) {
  return {
    reload: vi.fn(async () => baseSnapshot()),
    reloading: false,
    saveText: vi.fn(async () => ({}) as never),
    savingText: false,
    ...input,
  }
}

async function inputValue(input: HTMLTextAreaElement, value: string, initialNormalize = false) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, value)
    input.dataset.initialNormalize = String(initialNormalize)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    delete input.dataset.initialNormalize
    await Promise.resolve()
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function selectImage(file: File) {
  const input = document.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('image input not found')
  await act(async () => {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
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
