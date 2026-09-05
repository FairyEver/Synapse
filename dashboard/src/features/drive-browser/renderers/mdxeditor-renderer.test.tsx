// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveBrowserSnapshotDto,
  DriveAnnotationThreadDto,
  DriveHostedDocumentImageDto,
} from '@synapse/shared'
import { ApiError, driveBrowserApi } from '@/lib/api'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let objectUrlIndex = 0
const mdxEditorMockState = vi.hoisted(() => ({
  imagePreviewHandler: null as ((imageSource: string) => Promise<string>) | null,
}))
const layoutModeMock = vi.hoisted(() => ({ value: 'regular' as 'regular' | 'compact' }))
const annotationsMock = vi.hoisted(() => ({
  input: undefined as unknown,
  threads: [] as DriveAnnotationThreadDto[],
  loading: false,
  error: null as string | null,
  refresh: vi.fn(async () => undefined),
  createThread: vi.fn(),
  creatingThread: false,
  reply: vi.fn(async () => undefined),
  replying: false,
  updateComment: vi.fn(async () => undefined),
  updatingComment: false,
  deleteComment: vi.fn(async () => undefined),
  deletingComment: false,
}))

function installObjectUrlMocks() {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:synapse-test-${++objectUrlIndex}`),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
}

installObjectUrlMocks()

vi.mock('@mdxeditor/editor/style.css', () => ({}))

vi.mock('./mdxeditor-commonmark-compatibility-plugin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mdxeditor-commonmark-compatibility-plugin')>()
  return {
    ...actual,
    commonMarkTextCompatibilityPlugin: () => ({ name: 'commonMarkTextCompatibilityPlugin' }),
    commonMarkToMarkdownOptions: { ...actual.commonMarkToMarkdownOptions, marker: 'commonmark' },
  }
})

vi.mock('../use-drive-annotations', () => ({
  useDriveAnnotations: (input: unknown) => {
    annotationsMock.input = input
    return annotationsMock
  },
}))

vi.mock('@/features/file-browser/preview/file-preview-layout', () => ({
  useFilePreviewLayoutMode: () => layoutModeMock.value,
}))

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
      onError,
      plugins,
      className,
      contentEditableClassName,
      toMarkdownOptions,
      translation,
    }: {
      readonly markdown: string
      readonly readOnly?: boolean
      readonly onChange?: (value: string, initialMarkdownNormalize?: boolean) => void
      readonly onError?: (payload: { readonly error: Error; readonly source: string }) => void
      readonly plugins?: readonly unknown[]
      readonly className?: string
      readonly contentEditableClassName?: string
      readonly toMarkdownOptions?: { readonly marker?: string }
      readonly translation?: (key: string, defaultValue: string, interpolations?: Record<string, unknown>) => string
    }, ref: React.Ref<{ setMarkdown: (value: string) => void }>) => {
      const [value, setValue] = React.useState(markdown)
      const valueRef = React.useRef(markdown)
      const hasCommonMarkCompatibility = plugins?.some((plugin) => (
        (plugin as { readonly name?: string }).name === 'commonMarkTextCompatibilityPlugin'
      )) ?? false
      const hasMdxCompatibility = plugins?.some((plugin) => (
        (plugin as { readonly name?: string }).name === 'jsxPlugin'
      )) ?? false
      const reportParseError = (source: string) => {
        if (
          source.includes('broken-mdx')
          || (source.includes('<=') && !hasCommonMarkCompatibility)
          || (source.includes('<Callout') && !hasMdxCompatibility)
        ) {
          onError?.({ error: new Error('Parse failed'), source })
        }
      }
      if (markdown.includes('<=') && !hasCommonMarkCompatibility) reportParseError(markdown)
      const updateValue = (nextValue: string) => {
        valueRef.current = nextValue
        setValue(nextValue)
        onChange?.(nextValue)
        reportParseError(nextValue)
      }
      React.useImperativeHandle(ref, () => ({
        getMarkdown: () => valueRef.current,
        setMarkdown: (nextValue: string) => {
          valueRef.current = nextValue
          setValue(nextValue)
          reportParseError(nextValue)
        },
        insertMarkdown: (markdownValue: string) => updateValue(`${valueRef.current}${markdownValue}`),
        focus: (callback?: () => void) => callback?.(),
      }), [])

      const toolbarContents = plugins
        ?.map((plugin) => (plugin as { readonly toolbarContents?: () => React.ReactNode }).toolbarContents?.())
        .filter(Boolean)
      return React.createElement('div', { 'data-testid': 'mdx-editor-root', className },
        React.createElement('div', { 'data-testid': 'mdx-toolbar' }, toolbarContents),
        React.createElement('textarea', {
          'data-mdxeditor': 'true',
          'data-toolbar-plugin': String(pluginCalls.has('toolbarPlugin') && Boolean(plugins?.length)),
          'data-toolbar-controls': Array.from(pluginCalls).join(','),
          'data-content-editable-class': contentEditableClassName ?? '',
          'data-commonmark-options': toMarkdownOptions?.marker ?? '',
          'data-mdx-support': String(hasMdxCompatibility),
          'data-translation-bold': translation?.('toolbar.bold', 'Bold') ?? '',
          'data-translation-undo': translation?.('toolbar.undo', 'Undo {{shortcut}}', { shortcut: 'Ctrl+Z' }) ?? '',
          'data-translation-heading': translation?.('toolbar.blockTypes.heading', 'Heading {{level}}', { level: 2 }) ?? '',
          'data-translation-unknown': translation?.('unknown.key', 'Fallback {{value}}', { value: 'OK' }) ?? '',
          readOnly,
          className: contentEditableClassName,
          value,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.currentTarget.value)
            onChange?.(event.currentTarget.value, event.currentTarget.dataset.initialNormalize === 'true')
            reportParseError(event.currentTarget.value)
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
    InsertCodeBlock: () => {
      pluginCalls.add('InsertCodeBlock')
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
    diffSourcePlugin: () => ({ name: 'diffSourcePlugin' }),
    DiffSourceToggleWrapper: ({ children }: { readonly children: React.ReactNode }) => {
      pluginCalls.add('DiffSourceToggleWrapper')
      return React.createElement(React.Fragment, null, children)
    },
    headingsPlugin: () => ({ name: 'headingsPlugin' }),
    imagePlugin: (input: {
      readonly imageUploadHandler: (file: File) => Promise<string>
      readonly imagePreviewHandler?: (imageSource: string) => Promise<string>
    }) => {
      pluginCalls.add('imagePlugin')
      mdxEditorMockState.imagePreviewHandler = input.imagePreviewHandler ?? null
      return {
        name: 'imagePlugin',
        imageUploadHandler: input.imageUploadHandler,
        imagePreviewHandler: input.imagePreviewHandler,
      }
    },
    linkDialogPlugin: () => ({ name: 'linkDialogPlugin' }),
    linkPlugin: () => ({ name: 'linkPlugin' }),
    listsPlugin: () => ({ name: 'listsPlugin' }),
    markdownShortcutPlugin: () => ({ name: 'markdownShortcutPlugin' }),
    GenericJsxEditor: () => null,
    jsxPlugin: () => ({ name: 'jsxPlugin' }),
    quotePlugin: () => ({ name: 'quotePlugin' }),
    realmPlugin: () => () => ({ name: 'realmPlugin' }),
    createActiveEditorSubscription$: Symbol('createActiveEditorSubscription$'),
    createRootEditorSubscription$: Symbol('createRootEditorSubscription$'),
    viewMode$: Symbol('viewMode$'),
    lexical: { LineBreakNode: class {} },
    $createGenericHTMLNode: () => null,
    $isImageNode: () => false,
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

class TestResizeObserver implements ResizeObserver {
  readonly observed = new Set<Element>()
  observe = (element: Element) => { this.observed.add(element) }
  unobserve = (element: Element) => { this.observed.delete(element) }
  disconnect = () => { this.observed.clear() }
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

beforeEach(() => {
  objectUrlIndex = 0
  installObjectUrlMocks()
  annotationsMock.threads = []
  annotationsMock.input = undefined
  annotationsMock.loading = false
  annotationsMock.error = null
  layoutModeMock.value = 'regular'
})

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
  window.localStorage.clear()
  objectUrlIndex = 0
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('DriveMDXeditorRenderer', () => {
  it.each([
    { label: 'Command+S', modifiers: { metaKey: true } },
    { label: 'Ctrl+S', modifiers: { ctrlKey: true } },
  ])('saves dirty markdown with $label', async ({ modifiers }) => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    expect(buttonWithText('保存').getAttribute('aria-keyshortcuts')).toBe('Meta+S Control+S')
    await inputValue(editor(), '# Shortcut')
    const accepted = await pressKey(editor(), { key: 's', ...modifiers })

    expect(accepted).toBe(false)
    expect(editContext.saveText).toHaveBeenCalledWith({ text: '# Shortcut', baseVersionId: 'version-1' })
  })

  it('ignores non-save key combinations and unavailable saves', async () => {
    const editContext = createEditContext({ savingText: true })
    renderRenderer({ edit: editable(), editContext })
    await inputValue(editor(), '# Shortcut')

    await pressKey(editor(), { key: 's' })
    await pressKey(editor(), { key: 's', metaKey: true, shiftKey: true })
    await pressKey(editor(), { key: 's', ctrlKey: true, altKey: true })
    await pressKey(editor(), { key: 's', metaKey: true })

    expect(editContext.saveText).not.toHaveBeenCalled()
  })

  it('does not save clean, read-only, or reloading markdown', async () => {
    const cleanContext = createEditContext()
    const { rerender } = renderRenderer({ edit: editable(), editContext: cleanContext })

    await pressKey(editor(), { key: 's', metaKey: true })
    expect(cleanContext.saveText).not.toHaveBeenCalled()

    const readOnlyContext = createEditContext()
    rerender({ edit: null, editContext: readOnlyContext })
    await pressKey(editor(), { key: 's', ctrlKey: true })
    expect(readOnlyContext.saveText).not.toHaveBeenCalled()

    const reloadingContext = createEditContext({ reloading: true })
    rerender({ edit: editable(), editContext: reloadingContext })
    await inputValue(editor(), '# Reloading')
    await pressKey(editor(), { key: 's', metaKey: true })
    expect(reloadingContext.saveText).not.toHaveBeenCalled()
  })

  it('does not submit again while a shortcut save is uploading an image', async () => {
    let resolveUpload!: (asset: DriveHostedDocumentImageDto) => void
    const uploadPromise = new Promise<DriveHostedDocumentImageDto>((resolve) => {
      resolveUpload = resolve
    })
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockReturnValue(uploadPromise)
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    await click(buttonWithText('继续上传'))
    await pressKey(editor(), { key: 's', metaKey: true })
    await pressKey(editor(), { key: 's', ctrlKey: true })

    expect(upload).toHaveBeenCalledTimes(1)
    expect(editContext.saveText).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpload(createHostedImage({ name: 'chart.png' }))
      await uploadPromise
    })

    await pressKey(editor(), { key: 's', metaKey: true })
    expect(editContext.saveText).toHaveBeenCalledTimes(1)
  })

  it('saves recovered source markdown with Command+S', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# broken-mdx')
    await inputValue(sourceEditor(), '# Fixed')
    await pressKey(sourceEditor(), { key: 's', metaKey: true })

    expect(editContext.saveText).toHaveBeenCalledWith({ text: '# Fixed', baseVersionId: 'version-1' })
  })

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

  it('normalizes mdxeditor html image output before saving', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Notes\n\n<img height="256" width="256" src="http://localhost:3000/files/asset_image" />')
    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: '# Notes\n\n![](http://localhost:3000/files/asset_image)',
      baseVersionId: 'version-1',
    })
    expect(editor().value).toBe('# Notes\n\n![](http://localhost:3000/files/asset_image)')
    expect(document.body.textContent).toContain('已同步')
  })

  it('does not normalize html image examples inside inline or fenced code', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })
    const markdown = [
      '# Notes',
      '',
      '`<img src="inline.png" />`',
      '',
      '```html',
      '<img src="fenced.png" />',
      '```',
      '',
      '<img src="https://synapse.test/files/actual.png" />',
    ].join('\n')

    await inputValue(editor(), markdown)
    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: [
        '# Notes',
        '',
        '`<img src="inline.png" />`',
        '',
        '```html',
        '<img src="fenced.png" />',
        '```',
        '',
        '![](https://synapse.test/files/actual.png)',
      ].join('\n'),
      baseVersionId: 'version-1',
    })
  })

  it('keeps newer markdown edits dirty after a pending save resolves', async () => {
    let resolveSave!: () => void
    const savePromise = new Promise<never>((resolve) => {
      resolveSave = () => resolve({} as never)
    })
    const editContext = createEditContext({
      saveText: vi.fn(() => savePromise),
    })
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Submitted')
    await click(buttonWithText('保存'))
    await inputValue(editor(), '# Newer')

    await act(async () => {
      resolveSave()
      await savePromise
      await Promise.resolve()
    })

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: '# Submitted',
      baseVersionId: 'version-1',
    })
    expect(editor().value).toBe('# Newer')
    expect(document.body.textContent).toContain('未保存')
    expect(document.body.textContent).not.toContain('已同步')
  })

  it('asks before reloading dirty markdown and clears dirty state after confirmation', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Draft')
    await click(buttonWithText('重新加载'))

    expect(editContext.reload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('放弃本地修改？')
    await click(buttonWithText('放弃并重新加载'))

    expect(editContext.reload).toHaveBeenCalled()
    expect(editor().value).toBe('# Notes')
    expect(document.body.textContent).toContain('已同步')
  })

  it('downloads the dirty markdown draft without reloading it from the discard dialog', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-draft')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Draft')
    await click(buttonWithText('重新加载'))
    await click(buttonWithText('下载本地版本'))

    expect(editContext.reload).not.toHaveBeenCalled()
    expect(editor().value).toBe('# Draft')
    expect(createObjectURL).toHaveBeenCalled()
    expect(clickAnchor).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-draft')
  })

  it('resets the mounted editor content after reload', async () => {
    const editContext = createEditContext({
      reload: vi.fn(async () => baseSnapshot({ preview: { ...basePreview(), text: '# Server' } })),
    })
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Draft')
    await click(buttonWithText('重新加载'))
    await click(buttonWithText('放弃并重新加载'))

    expect(editor().value).toBe('# Server')
    expect(document.body.textContent).toContain('已同步')
  })

  it('registers dirty markdown for external restore confirmations', async () => {
    renderRenderer({ edit: editable() })

    expect(toolbarHost()?.dataset.unsaved).toBe('false')

    await inputValue(editor(), '# Draft')

    expect(toolbarHost()?.dataset.unsaved).toBe('true')
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
      'DiffSourceToggleWrapper',
      'UndoRedo',
      'BlockTypeSelect',
      'BoldItalicUnderlineToggles',
      'ListsToggle',
      'CreateLink',
      'InsertCodeBlock',
      'imagePlugin',
      'InsertTable',
      'InsertThematicBreak',
    ]))
    expect(buttonWithText('插入图片')).toBeInstanceOf(HTMLButtonElement)
  })

  it('localizes mdxeditor toolbar labels through the translation prop', () => {
    renderRenderer({ edit: editable() })

    expect(editor().dataset.translationBold).toBe('加粗')
    expect(editor().dataset.translationUndo).toBe('撤销 Ctrl+Z')
    expect(editor().dataset.translationHeading).toBe('标题 2')
    expect(editor().dataset.translationUnknown).toBe('Fallback OK')
  })

  it('lets the editor grow with long content and keeps a bottom click area', () => {
    renderRenderer({ edit: editable() })

    const rootElement = mdxEditorRoot()
    expect(rootElement.classList.contains('min-h-full')).toBe(true)
    expect(rootElement.classList.contains('h-full')).toBe(false)
    expect(editor().dataset.contentEditableClass?.split(' ')).toContain('pb-12')
  })

  it('restores ordered, unordered, and nested list markers inside the editor', () => {
    renderRenderer({ edit: editable() })

    const contentClasses = editor().dataset.contentEditableClass?.split(' ') ?? []
    expect(contentClasses).toEqual(expect.arrayContaining([
      '[&_ul]:list-disc',
      '[&_ol]:list-decimal',
      '[&_ol>li::marker]:content-[attr(data-drive-list-marker)_"_"]!',
      '[&_ul]:pl-6',
      '[&_ol]:pl-6',
    ]))
  })

  it('saves and reloads nested list Markdown without flattening its hierarchy', async () => {
    const markdown = '1. 一级\n   * 二级\n      1. 三级'
    const editContext = createEditContext()
    const { rerender } = renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), markdown)
    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: markdown,
      baseVersionId: 'version-1',
    })

    rerender({
      preview: { ...basePreview(), text: markdown },
      edit: { ...editable(), currentVersionId: 'version-2' },
      editContext,
    })

    expect(editor().value).toBe(markdown)
    expect(document.body.textContent).toContain('已同步')
  })

  it('asks once before uploading a selected image to the platform image host', async () => {
    const editContext = createEditContext()
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(createHostedImage())
    renderRenderer({ edit: editable(), editContext })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))

    expect(driveBrowserApi.uploadHostedDocumentImage).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('平台公共图床')

    await click(buttonWithText('继续上传'))

    expect(driveBrowserApi.uploadHostedDocumentImage).toHaveBeenCalledWith(
      expect.any(File),
      { kind: 'owner', itemId: 'file' },
      { name: 'chart.png', mimeType: 'image/png' }
    )
    expect(editor().value).toBe(`# Notes![chart](${createHostedImage().url})`)
    expect(document.body.textContent).toContain('未保存')

    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: `# Notes![chart](${createHostedImage().url})`,
      baseVersionId: 'version-1',
    })
    expect(document.body.textContent).toContain('已同步')
  })

  it('rejects empty selected images before uploading', async () => {
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage')
    renderRenderer({ edit: editable() })

    await selectImage(new File([], 'empty.png', { type: 'image/png' }))

    expect(upload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('图片内容为空，请重新复制或选择图片。')
    expect(document.body.textContent).not.toContain('公开上传图片')
  })

  it('rejects empty pasted images before the mdxeditor upload handler runs', async () => {
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage')
    renderRenderer({ edit: editable() })

    await pasteClipboardImage(new File([], 'empty.png', { type: 'image/png' }), false)

    expect(upload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('图片内容为空，请重新复制或选择图片。')
  })

  it('uploads image files from mixed clipboard payloads immediately', async () => {
    window.localStorage.setItem('synapse.drive.markdown.documentImageUploadConsent.v1', 'true')
    const file = new File(['image'], 'chart.png', { type: 'image/png' })
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(createHostedImage())
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await pasteClipboardImage(file)

    expect(driveBrowserApi.uploadHostedDocumentImage).toHaveBeenCalledWith(
      file,
      { kind: 'owner', itemId: 'file' },
      { name: 'chart.png', mimeType: 'image/png' }
    )
    expect(editor().value).toBe(`# Notes![chart](${createHostedImage().url})`)
    expect(editContext.saveText).not.toHaveBeenCalled()
  })

  it('remembers platform image upload consent after the first confirmation', async () => {
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage')
      .mockResolvedValueOnce(createHostedImage({ imageId: 'img_11111111111111111111111111111111', url: '/object/img_11111111111111111111111111111111' }))
      .mockResolvedValueOnce(createHostedImage({ imageId: 'img_22222222222222222222222222222222', url: '/object/img_22222222222222222222222222222222' }))
    renderRenderer({ edit: editable() })

    await selectImage(new File(['image'], 'first.png', { type: 'image/png' }))
    await click(buttonWithText('继续上传'))
    await selectImage(new File(['image'], 'second.png', { type: 'image/png' }))

    expect(document.body.textContent).not.toContain('平台公共图床')
    expect(driveBrowserApi.uploadHostedDocumentImage).toHaveBeenCalledTimes(2)
    expect(editor().value).toBe(
      '# Notes![first](/object/img_11111111111111111111111111111111)![second](/object/img_22222222222222222222222222222222)'
    )
  })

  it('cancels platform image insertion without uploading', async () => {
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage')
    renderRenderer({ edit: editable() })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    await click(buttonWithText('取消'))

    expect(upload).not.toHaveBeenCalled()
    expect(editor().value).toBe('# Notes')
  })

  it('rejects unsupported selected image formats before uploading', async () => {
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage')
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

  it('updates the login action redirect after switching shared files', () => {
    const loginEdit = {
      ...editable(),
      canEdit: false,
      currentVersionId: null,
      reason: 'login_required' as const,
    }
    window.history.pushState(null, '', '/share/share-1/items/file-a')
    const { rerender } = renderRenderer({ edit: loginEdit })
    expect(anchorWithText('登录后编辑').getAttribute('href')).toBe('/console/sign-in?redirect=%2Fshare%2Fshare-1%2Fitems%2Ffile-a')

    window.history.pushState(null, '', '/share/share-1/items/file-b')
    rerender({ edit: loginEdit })

    expect(anchorWithText('登录后编辑').getAttribute('href')).toBe('/console/sign-in?redirect=%2Fshare%2Fshare-1%2Fitems%2Ffile-b')
  })

  it('opens a conflict dialog and can reload after a version conflict', async () => {
    const editContext = createEditContext()
    editContext.saveText.mockRejectedValue(new ApiError('版本冲突', 409))
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# Local')
    await click(buttonWithText('保存'))

    expect(document.body.textContent).toContain('文件已有新内容')
    expect(document.body.textContent).toContain('下载本地版本')

    await click(lastButtonWithText('重新加载'))

    expect(editContext.reload).toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('文件已有新内容')
  })

  it('shows truncated markdown state', () => {
    renderRenderer({ preview: { ...basePreview(), truncated: true } })

    expect(document.body.textContent).toContain('内容已截断')
  })

  it('maps relative image previews without changing the editor markdown', async () => {
    renderRenderer({
      preview: {
        ...basePreview(),
        text: '![diagram](./images/diagram.png)',
        relativeImages: [{
          src: './images/diagram.png',
          resolvedUrl: '/drive/items/image-1/download',
        }],
      },
    })

    expect(await mdxEditorMockState.imagePreviewHandler?.('./images/diagram.png')).toBe('/drive/items/image-1/download')
    expect(await mdxEditorMockState.imagePreviewHandler?.('https://example.com/image.png')).toBe('https://example.com/image.png')
    expect(editor().value).toBe('![diagram](./images/diagram.png)')
  })

  it('normalizes bare break tags for MDX without changing code examples', () => {
    renderRenderer({
      preview: {
        ...basePreview(),
        text: [
          '| 写法 | 表格内容 |',
          '| --- | --- |',
          '| `<br>` | 借：管理费用<br>贷：应付职工薪酬 |',
          '| `<br/>` | 借：应付职工薪酬<br/>贷：银行存款 |',
          '| `<br />` | 第一行<br />第二行 |',
          '',
          '```html',
          '<br>',
          '```',
        ].join('\n'),
      },
    })

    expect(editor().value).toBe([
      '| 写法 | 表格内容 |',
      '| --- | --- |',
      '| `<br>` | 借：管理费用<br />贷：应付职工薪酬 |',
      '| `<br/>` | 借：应付职工薪酬<br/>贷：银行存款 |',
      '| `<br />` | 第一行<br />第二行 |',
      '',
      '```html',
      '<br>',
      '```',
    ].join('\n'))
    expect(document.body.textContent).not.toContain('解析失败')
  })

  it('opens less-than-or-equal text in rich mode for Markdown files', () => {
    renderRenderer({
      preview: { ...basePreview(), text: '金额 <= 1000' },
    })

    expect(editor().value).toBe('金额 \\<= 1000')
    expect(editor().dataset.commonmarkOptions).toBe('commonmark')
    expect(document.body.textContent).not.toContain('解析失败')
  })

  it('opens CommonMark URI and email autolinks in rich mode', () => {
    renderRenderer({
      preview: {
        ...basePreview(),
        text: '<https://example.com/path?q=1>\n\n<user@example.com>',
      },
    })

    expect(editor().value).toBe([
      '[https://example.com/path?q=1](<https://example.com/path?q=1>)',
      '',
      '[user@example.com](<mailto:user@example.com>)',
    ].join('\n'))
    expect(document.body.textContent).not.toContain('解析失败')
  })

  it.each([
    '    <https://example.com/code>',
    '<span>raw html</span>',
    '<!doctype html>',
  ])('keeps CommonMark syntax that MDXEditor cannot round-trip in source mode: %s', (markdown) => {
    renderRenderer({ preview: { ...basePreview(), text: markdown } })

    expect(sourceEditor().value).toBe(markdown)
    expect(document.body.textContent).not.toContain('解析失败')
  })

  it('keeps strict MDX parsing for MDX files', async () => {
    renderRenderer({
      current: { ...baseCurrent(), name: 'notes.mdx' },
      preview: { ...basePreview(), text: '金额 <= 1000' },
    })

    await act(async () => { await Promise.resolve() })

    expect(sourceEditor().value).toBe('金额 <= 1000')
    expect(document.body.textContent).toContain('解析失败')
  })

  it('opens valid MDX components in rich mode for MDX files', async () => {
    renderRenderer({
      current: { ...baseCurrent(), name: 'notes.mdx' },
      preview: { ...basePreview(), text: '<Callout tone="info">正文</Callout>' },
    })

    await act(async () => { await Promise.resolve() })

    expect(editor().value).toBe('<Callout tone="info">正文</Callout>')
    expect(editor().dataset.mdxSupport).toBe('true')
    expect(document.body.textContent).not.toContain('解析失败')
  })

  it('keeps MDX ESM source intact instead of normalizing it through rich mode', async () => {
    const editContext = createEditContext()
    const markdown = [
      'export const total = 2',
      '',
      '<Callout>{total}</Callout>',
    ].join('\n')
    renderRenderer({
      current: { ...baseCurrent(), name: 'notes.mdx' },
      preview: { ...basePreview(), text: markdown },
      editContext,
    })

    expect(sourceEditor().value).toBe(markdown)
    expect(document.body.textContent).not.toContain('解析失败')
    expect(document.querySelector('[data-mdxeditor="true"]')).toBeNull()
  })

  it('does not mistake fenced import or export examples for MDX ESM', async () => {
    const markdown = [
      '```tsx',
      'export const total = 2',
      '```',
    ].join('\n')
    renderRenderer({
      current: { ...baseCurrent(), name: 'notes.mdx' },
      preview: { ...basePreview(), text: markdown },
    })

    expect(editor().value).toBe(markdown)
    expect(document.body.textContent).not.toContain('解析失败')
  })

  it('keeps CommonMark HTML comments in source mode instead of dropping them', async () => {
    const markdown = ['正文', '', '<!-- keep this comment -->'].join('\n')
    renderRenderer({ preview: { ...basePreview(), text: markdown } })

    expect(sourceEditor().value).toBe(markdown)
    expect(document.body.textContent).not.toContain('解析失败')
    expect(document.querySelector('[data-mdxeditor="true"]')).toBeNull()
  })

  it('does not mistake fenced or inline HTML comment examples for source comments', async () => {
    const markdown = [
      '行内 `<!-- example -->`',
      '',
      '```html',
      '<!-- example -->',
      '```',
    ].join('\n')
    renderRenderer({ preview: { ...basePreview(), text: markdown } })

    expect(editor().value).toBe(markdown)
    expect(document.body.textContent).not.toContain('解析失败')
  })

  it('keeps invalid MDX source editable after saving it', async () => {
    const editContext = createEditContext()
    renderRenderer({
      current: { ...baseCurrent(), name: 'notes.mdx' },
      preview: { ...basePreview(), text: '金额 <= 1000' },
      editContext,
    })
    await act(async () => { await Promise.resolve() })

    await inputValue(sourceEditor(), '金额 <= 2000')
    await click(buttonWithText('保存'))
    await act(async () => { await Promise.resolve() })

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: '金额 <= 2000',
      baseVersionId: 'version-1',
    })
    expect(sourceEditor().value).toBe('金额 <= 2000')
    expect(document.body.textContent).toContain('解析失败')
  })

  it('shows recoverable source editing when mdx parsing fails', async () => {
    renderRenderer({ edit: editable() })

    await inputValue(editor(), '# broken-mdx')

    expect(document.body.textContent).toContain('源码')
    expect(document.body.textContent).toContain('解析失败')
  })

  it('clears parse error after saving recovered source markdown', async () => {
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await inputValue(editor(), '# broken-mdx')
    await inputValue(sourceEditor(), '# Fixed')
    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({ text: '# Fixed', baseVersionId: 'version-1' })
    expect(document.body.textContent).not.toContain('解析失败')
    expect(editor().value).toBe('# Fixed')
    expect(document.body.textContent).toContain('已同步')
  })

  it('shows existing .md comments in the shared rail and keeps local placement failures distinct', async () => {
    annotationsMock.threads = [commentThread()]
    renderRenderer({ annotationContext: { context: 'owner', itemId: 'file' } })

    expect(annotationsMock.input).toEqual({ context: 'owner', itemId: 'file' })
    expect(buttonWithText('评论 1')).not.toBeNull()
    expect(document.querySelector('[data-mdxeditor-resizable-panel="comments"]')).not.toBeNull()
    expect(document.body.textContent).toContain('编辑中暂未定位')

    await click(buttonWithText('编辑中暂未定位'))

    expect(document.body.textContent).toContain('First comment')
    expect(document.body.textContent).toContain('编辑中暂未定位')
    expect(document.body.textContent).not.toContain('原文已修改或删除')
  })

  it('shows comments directly as a list while the Markdown editor is in source mode', () => {
    annotationsMock.threads = [commentThread()]
    renderRenderer({
      preview: { ...basePreview(), text: ['正文', '', '<!-- keep this comment -->'].join('\n') },
      annotationContext: { context: 'owner', itemId: 'file' },
    })

    expect(sourceEditor()).not.toBeNull()
    expect(document.querySelector('[data-markdown-comments-mode="list"]')).not.toBeNull()
    expect(document.body.textContent).toContain('First comment')
    expect(document.body.textContent).toContain('编辑中暂未定位')
    expect(document.body.textContent).not.toContain('未定位评论')
  })

  it('uses a compact comment sheet without mounting the desktop split rail', () => {
    layoutModeMock.value = 'compact'
    annotationsMock.threads = [commentThread()]
    renderRenderer({ annotationContext: { context: 'owner', itemId: 'file' } })

    expect(document.querySelector('[data-mdxeditor-resizable-panel="comments"]')).toBeNull()
    expect(document.querySelector('[data-mdxeditor-sheet="comments"]')).not.toBeNull()
    expect(document.querySelector('[data-markdown-comments-mode="list"]')).not.toBeNull()
    expect(document.body.textContent).toContain('First comment')
  })

  it('does not reopen comments after the user closes them during the current mount', async () => {
    annotationsMock.threads = [commentThread()]
    const renderer = renderRenderer({ annotationContext: { context: 'owner', itemId: 'file' } })

    expect(document.querySelector('[data-mdxeditor-resizable-panel="comments"]')).not.toBeNull()
    await click(buttonWithText('评论 1'))
    expect(document.querySelector('[data-mdxeditor-resizable-panel="comments"]')).toBeNull()

    renderer.rerender({
      preview: { ...basePreview(), text: '# Notes\n\nAfter edit' },
      annotationContext: { context: 'owner', itemId: 'file' },
    })
    expect(document.querySelector('[data-mdxeditor-resizable-panel="comments"]')).toBeNull()
  })

  it('does not enable comments for .mdx files', () => {
    annotationsMock.threads = [commentThread()]
    renderRenderer({
      current: { ...baseCurrent(), name: 'notes.mdx' },
      annotationContext: { context: 'owner', itemId: 'file' },
    })

    expect(annotationsMock.input).toBeUndefined()
    expect(document.body.textContent).not.toContain('评论 1')
    expect(document.querySelector('[data-mdxeditor-resizable-panel="comments"]')).toBeNull()
  })
})

function renderRenderer(input: {
  readonly current?: DriveBrowserItemDto
  readonly preview?: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: ComponentProps<typeof DriveMDXeditorRenderer>['annotationContext']
  readonly imageUploadContext?: ComponentProps<typeof DriveMDXeditorRenderer>['imageUploadContext']
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
          annotationContext={nextInput.annotationContext}
          imageUploadContext={nextInput.imageUploadContext ?? { kind: 'owner', itemId: 'file' }}
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
    <div data-testid='toolbar' data-unsaved={String(toolbar.hasUnsavedChanges)}>
      {toolbar.items.map((item) => <DrivePreviewToolbarItemView key={item.id} item={item} />)}
    </div>
  )
}

function toolbarHost(): HTMLDivElement | null {
  const element = document.querySelector('[data-testid="toolbar"]')
  return element instanceof HTMLDivElement ? element : null
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
    annotation: null,
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
    relativeImages: [],
  }
}

function commentThread(): DriveAnnotationThreadDto {
  return {
    id: 'thread-1',
    itemId: 'file',
    baseVersionId: 'version-1',
    targetKind: 'textRange',
    target: {
      schemaVersion: 1,
      kind: 'textRange',
      surface: 'markdownRenderedText',
      range: { start: 0, end: 5 },
      quote: { exact: 'Notes', prefix: '', suffix: '' },
    },
    anchorStatus: 'attached',
    anchor: {
      schemaVersion: 2,
      baseVersionId: 'version-1',
      selectors: {
        schemaVersion: 2,
        kind: 'textRange',
        position: { start: 0, end: 7 },
        quote: { exact: 'Notes', prefix: '', suffix: '' },
        semantic: { blockId: 'block-1', blockLocalRange: { start: 0, end: 5 }, headingPath: [] },
      },
      positionStatus: 'attached',
      quoteStatus: 'exact',
      resolvedSourceRange: { start: 2, end: 7 },
      resolvedRenderedRange: { start: 0, end: 5 },
      confidence: 1,
      lastResolvedVersionId: 'version-1',
    },
    author: { id: 'user-1', email: null, handle: 'author' },
    comments: [{
      id: 'comment-1',
      threadId: 'thread-1',
      parentCommentId: null,
      body: 'First comment',
      author: { id: 'user-1', email: null, handle: 'author' },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      deleted: false,
      permissions: { canEdit: true, canDelete: true },
    }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}

function editable(): DriveBrowserEditDto {
  return {
    canEdit: true,
    editorKind: 'text',
    currentVersionId: 'version-1',
    reason: null,
  }
}

function createHostedImage(overrides: Partial<DriveHostedDocumentImageDto> = {}): DriveHostedDocumentImageDto {
  return {
    imageId: 'img_00000000000000000000000000000000',
    name: 'image.png',
    size: '5',
    mimeType: 'image/png',
    url: '/object/img_00000000000000000000000000000000',
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

async function pressKey(element: HTMLElement, init: KeyboardEventInit): Promise<boolean> {
  let accepted = true
  await act(async () => {
    accepted = element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    await Promise.resolve()
  })
  return accepted
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

async function pasteClipboardImage(file: File, mixed = true) {
  const imageItem = {
    type: file.type,
    getAsFile: () => file,
  }
  const htmlItem = {
    type: 'text/html',
    getAsFile: () => null,
  }
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: { items: mixed ? [imageItem, htmlItem] : [imageItem] },
    })
    editor().dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function editor(): HTMLTextAreaElement {
  const element = document.querySelector('[data-mdxeditor="true"]')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('mdx editor not found')
  return element
}

function sourceEditor(): HTMLTextAreaElement {
  const element = Array.from(document.querySelectorAll('textarea')).find((item) => item.dataset.mdxeditor !== 'true')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('source editor not found')
  return element
}

function mdxEditorRoot(): HTMLElement {
  const element = document.querySelector('[data-testid="mdx-editor-root"]')
  if (!(element instanceof HTMLElement)) throw new Error('mdx editor root not found')
  return element
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}

function lastButtonWithText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button')).filter((item) => item.textContent?.includes(text))
  const button = buttons[buttons.length - 1]
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}

function anchorWithText(text: string): HTMLAnchorElement {
  const anchor = Array.from(document.querySelectorAll('a')).find((item) => item.textContent?.includes(text))
  if (!(anchor instanceof HTMLAnchorElement)) throw new Error(`${text} anchor not found`)
  return anchor
}
