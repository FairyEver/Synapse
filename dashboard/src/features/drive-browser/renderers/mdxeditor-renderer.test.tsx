// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DrivePublicAssetDto,
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveBrowserSnapshotDto,
  DriveDocumentImageSource,
  DriveDocumentImageSourcesDto,
} from '@synapse/shared'
import { ApiError, driveApi, driveBrowserApi } from '@/lib/api'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let objectUrlIndex = 0
const mdxEditorMockState = vi.hoisted(() => ({
  imagePreviewHandler: null as ((imageSource: string) => Promise<string>) | null,
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
      translation,
    }: {
      readonly markdown: string
      readonly readOnly?: boolean
      readonly onChange?: (value: string, initialMarkdownNormalize?: boolean) => void
      readonly onError?: (payload: { readonly error: Error; readonly source: string }) => void
      readonly plugins?: readonly unknown[]
      readonly className?: string
      readonly translation?: (key: string, defaultValue: string, interpolations?: Record<string, unknown>) => string
    }, ref: React.Ref<{ setMarkdown: (value: string) => void }>) => {
      const [value, setValue] = React.useState(markdown)
      const valueRef = React.useRef(markdown)
      const updateValue = (nextValue: string) => {
        valueRef.current = nextValue
        setValue(nextValue)
        onChange?.(nextValue)
        if (nextValue.includes('broken-mdx')) {
          onError?.({ error: new Error('Parse failed'), source: nextValue })
        }
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
      return React.createElement('div', { 'data-testid': 'mdx-editor-root', className },
        React.createElement('div', { 'data-testid': 'mdx-toolbar' }, toolbarContents),
        React.createElement('textarea', {
          'data-mdxeditor': 'true',
          'data-toolbar-plugin': String(pluginCalls.has('toolbarPlugin') && Boolean(plugins?.length)),
          'data-toolbar-controls': Array.from(pluginCalls).join(','),
          'data-translation-bold': translation?.('toolbar.bold', 'Bold') ?? '',
          'data-translation-undo': translation?.('toolbar.undo', 'Undo {{shortcut}}', { shortcut: 'Ctrl+Z' }) ?? '',
          'data-translation-heading': translation?.('toolbar.blockTypes.heading', 'Heading {{level}}', { level: 2 }) ?? '',
          'data-translation-unknown': translation?.('unknown.key', 'Fallback {{value}}', { value: 'OK' }) ?? '',
          readOnly,
          value,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.currentTarget.value)
            onChange?.(event.currentTarget.value, event.currentTarget.dataset.initialNormalize === 'true')
            if (event.currentTarget.value.includes('broken-mdx')) {
              onError?.({ error: new Error('Parse failed'), source: event.currentTarget.value })
            }
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

beforeEach(() => {
  objectUrlIndex = 0
  installObjectUrlMocks()
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
    let resolveUpload!: (asset: DrivePublicAssetDto) => void
    const uploadPromise = new Promise<DrivePublicAssetDto>((resolve) => {
      resolveUpload = resolve
    })
    const upload = vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile').mockReturnValue(uploadPromise)
    const editContext = createEditContext()
    renderRenderer({ edit: editable(), editContext })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    await click(buttonWithText('继续插入'))
    await pressKey(editor(), { key: 's', metaKey: true })
    await pressKey(editor(), { key: 's', ctrlKey: true })

    expect(upload).toHaveBeenCalledTimes(1)
    expect(editContext.saveText).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpload(createPublicAsset({ name: 'chart.png', url: 'https://synapse.test/files/asset_image' }))
      await uploadPromise
      await vi.waitFor(() => expect(editContext.saveText).toHaveBeenCalledTimes(1))
    })
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

  it('keeps materialized draft image urls when editing continues during a pending save', async () => {
    let resolveSave!: () => void
    const savePromise = new Promise<never>((resolve) => {
      resolveSave = () => resolve({} as never)
    })
    const editContext = createEditContext({
      saveText: vi.fn(() => savePromise),
    })
    vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile').mockResolvedValue(createPublicAsset({
      name: 'chart.png',
      url: 'https://synapse.test/files/asset_image',
    }))
    renderRenderer({ edit: editable(), editContext })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    await click(buttonWithText('继续插入'))
    await click(buttonWithText('保存'))
    await inputValue(editor(), '# Notes![chart](blob:synapse-test-1)\n\nMore')

    await act(async () => {
      resolveSave()
      await savePromise
      await Promise.resolve()
    })

    expect(editor().value).toBe('# Notes![chart](https://synapse.test/files/asset_image)\n\nMore')
    expect(document.body.textContent).toContain('未保存')

    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenLastCalledWith({
      text: '# Notes![chart](https://synapse.test/files/asset_image)\n\nMore',
      baseVersionId: 'version-1',
    })
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

  it('lets the mdxeditor root grow with long content so the sticky toolbar remains bounded by the full document', () => {
    renderRenderer({ edit: editable() })

    const rootElement = mdxEditorRoot()
    expect(rootElement.classList.contains('min-h-full')).toBe(true)
    expect(rootElement.classList.contains('h-full')).toBe(false)
  })

  it('disables image source import while markdown has unsaved edits', async () => {
    const scanImages = vi.spyOn(driveBrowserApi, 'scanOwnerImageSources').mockResolvedValue(imageSources({
      canImport: true,
      sources: [
        imageSource({
          src: 'https://example.test/external.png',
          canImport: true,
          kind: 'external',
        }),
      ],
    }))
    const importImages = vi.spyOn(driveBrowserApi, 'importOwnerImageSources').mockResolvedValue(imageImportResult())
    renderRenderer({ edit: editable(), imageSourceContext: { context: 'owner', itemId: 'file' } })

    expect(scanImages).not.toHaveBeenCalled()

    await inputValue(editor(), '# Draft')

    expect(buttonWithText('图片来源').disabled).toBe(true)
    expect(importImages).not.toHaveBeenCalled()
  })

  it('asks before uploading a selected image as a public asset', async () => {
    const editContext = createEditContext()
    vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile').mockResolvedValue(createPublicAsset({
      name: 'chart.png',
      url: 'https://synapse.test/files/asset_image',
    }))
    renderRenderer({ edit: editable(), editContext })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))

    expect(driveBrowserApi.uploadPublicAssetFile).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('公开素材')

    await click(buttonWithText('继续插入'))

    expect(driveBrowserApi.uploadPublicAssetFile).not.toHaveBeenCalled()
    expect(editor().value).toBe('# Notes![chart](blob:synapse-test-1)')
    expect(document.body.textContent).toContain('未保存')

    await click(buttonWithText('保存'))

    expect(driveBrowserApi.uploadPublicAssetFile).toHaveBeenCalledWith(
      expect.any(File),
      { name: 'chart.png', mimeType: 'image/png' }
    )
    expect(editContext.saveText).toHaveBeenCalledWith({
      text: '# Notes![chart](https://synapse.test/files/asset_image)',
      baseVersionId: 'version-1',
    })
    expect(editor().value).toBe('# Notes![chart](https://synapse.test/files/asset_image)')
    expect(document.body.textContent).toContain('已同步')
  })

  it('remembers public image consent after the first confirmed insertion', async () => {
    const editContext = createEditContext()
    vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile')
      .mockResolvedValueOnce(createPublicAsset({
        name: 'first.png',
        url: 'https://synapse.test/files/first',
      }))
      .mockResolvedValueOnce(createPublicAsset({
        name: 'second.png',
        url: 'https://synapse.test/files/second',
      }))
    renderRenderer({ edit: editable(), editContext })

    await selectImage(new File(['image'], 'first.png', { type: 'image/png' }))
    await click(buttonWithText('继续插入'))
    await selectImage(new File(['image'], 'second.png', { type: 'image/png' }))

    expect(document.body.textContent).not.toContain('公开素材')
    expect(driveBrowserApi.uploadPublicAssetFile).not.toHaveBeenCalled()
    expect(editor().value).toBe(
      '# Notes![first](blob:synapse-test-1)![second](blob:synapse-test-2)'
    )

    await click(buttonWithText('保存'))

    expect(driveBrowserApi.uploadPublicAssetFile).toHaveBeenCalledTimes(2)
    expect(editor().value).toBe(
      '# Notes![first](https://synapse.test/files/first)![second](https://synapse.test/files/second)'
    )
  })

  it('cleans up newly uploaded public images when markdown save fails', async () => {
    const editContext = createEditContext({
      saveText: vi.fn(async () => {
        throw new Error('保存失败。')
      }),
    })
    vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile').mockResolvedValue(createPublicAsset({
      assetId: 'asset_unsaved',
      name: 'chart.png',
      url: 'https://synapse.test/files/asset_unsaved',
    }))
    const trash = vi.spyOn(driveApi, 'trashPublicAsset').mockResolvedValue(createPublicAsset({
      assetId: 'asset_unsaved',
      lifecycleStatus: 'trashed',
    }))
    renderRenderer({ edit: editable(), editContext })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    await click(buttonWithText('继续插入'))
    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: '# Notes![chart](https://synapse.test/files/asset_unsaved)',
      baseVersionId: 'version-1',
    })
    expect(trash).toHaveBeenCalledWith('asset_unsaved')
    expect(editor().value).toBe('# Notes![chart](blob:synapse-test-1)')
    expect(document.body.textContent).toContain('保存失败。')
  })

  it('cancels public image insertion without uploading', async () => {
    const upload = vi.spyOn(driveBrowserApi, 'uploadPublicAssetFile')
    renderRenderer({ edit: editable() })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    await click(buttonWithText('取消'))

    expect(upload).not.toHaveBeenCalled()
    expect(editor().value).toBe('# Notes')
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
})

function renderRenderer(input: {
  readonly current?: DriveBrowserItemDto
  readonly preview?: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly imageSourceContext?: ComponentProps<typeof DriveMDXeditorRenderer>['imageSourceContext']
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
          imageSourceContext={nextInput.imageSourceContext}
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

function imageSources(overrides: Partial<DriveDocumentImageSourcesDto> = {}): DriveDocumentImageSourcesDto {
  const sources = overrides.sources ?? []
  return {
    itemId: 'file',
    versionId: 'version-1',
    canImport: false,
    sources,
    summary: {
      total: sources.length,
      ownerAsset: sources.filter((source) => source.kind === 'owner_asset').length,
      collaboratorAsset: sources.filter((source) => source.kind === 'collaborator_asset').length,
      external: sources.filter((source) => source.kind === 'external').length,
      invalid: sources.filter((source) => source.kind === 'invalid').length,
      unsupported: sources.filter((source) => source.kind === 'unsupported').length,
      importable: sources.filter((source) => source.canImport).length,
    },
    ...overrides,
  }
}

function imageSource(overrides: Partial<DriveDocumentImageSource> = {}): DriveDocumentImageSource {
  return {
    id: 'source-1',
    imageKey: 'source-1',
    src: 'https://example.test/image.png',
    kind: 'external',
    occurrenceCount: 1,
    canImport: true,
    status: 'ready',
    ...overrides,
  }
}

function imageImportResult() {
  return {
    itemId: 'file',
    versionId: 'version-2',
    imported: [{
      previousSrc: 'https://example.test/external.png',
      nextSrc: 'https://synapse.test/files/asset',
      assetId: 'asset-1',
      size: '10',
    }],
    failed: [],
    summary: {
      importedCount: 1,
      failedCount: 0,
      replacedOccurrenceCount: 1,
    },
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
