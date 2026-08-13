// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DriveBrowserEditDto,
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveBrowserSnapshotDto,
} from '@synapse/shared'
import { DriveCodeRenderer } from './code-renderer'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const monacoMockState = vi.hoisted(() => ({
  ctrlCmd: 1 << 11,
  keyS: 49,
  saveCommand: null as null | { readonly keybinding: number; readonly handler: () => void },
}))

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    default: ({
      value,
      onChange,
      onMount,
      options,
    }: {
      readonly value?: string
      readonly onChange?: (value?: string) => void
      readonly onMount?: (
        editor: { addCommand: (keybinding: number, handler: () => void) => string },
        monaco: { KeyMod: { CtrlCmd: number }; KeyCode: { KeyS: number } },
      ) => void
      readonly options?: { readonly readOnly?: boolean }
    }) => {
      React.useEffect(() => {
        onMount?.(
          {
            addCommand: (keybinding, handler) => {
              monacoMockState.saveCommand = { keybinding, handler }
              return 'drive-save'
            },
          },
          { KeyMod: { CtrlCmd: monacoMockState.ctrlCmd }, KeyCode: { KeyS: monacoMockState.keyS } },
        )
      }, [])
      return React.createElement('textarea', {
        'data-monaco-editor': 'true',
        readOnly: options?.readOnly,
        value: value ?? '',
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          onChange?.(event.currentTarget.value)
        },
      })
    },
  }
})

vi.mock('y-monaco', () => ({
  MonacoBinding: class {
    destroy(): void {}
  },
}))

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
  monacoMockState.saveCommand = null
  vi.clearAllMocks()
})

describe('DriveCodeRenderer', () => {
  it('saves dirty source with the platform save command', async () => {
    const editContext = createEditContext()
    renderRenderer({ editContext })

    expect(monacoMockState.saveCommand?.keybinding).toBe(monacoMockState.ctrlCmd | monacoMockState.keyS)
    expect(buttonWithText('保存').getAttribute('aria-keyshortcuts')).toBe('Meta+S Control+S')

    monacoMockState.saveCommand?.handler()
    expect(editContext.saveText).not.toHaveBeenCalled()

    await inputValue(editor(), 'const shortcut = true')
    await act(async () => {
      monacoMockState.saveCommand?.handler()
      await Promise.resolve()
    })

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: 'const shortcut = true',
      baseVersionId: 'version-1',
    })
  })

  it('asks before reloading dirty source text and then reloads from the returned snapshot', async () => {
    const editContext = createEditContext({
      reload: vi.fn(async () => baseSnapshot({ preview: { ...basePreview(), text: 'const answer = 42' } })),
    })
    renderRenderer({ editContext })

    await inputValue(editor(), 'const draft = true')
    expect(document.body.textContent).toContain('未保存')

    await click(buttonWithText('重新加载'))

    expect(editContext.reload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('放弃本地修改？')
    await click(buttonWithText('放弃并重新加载'))

    expect(editContext.reload).toHaveBeenCalled()
    expect(editor().value).toBe('const answer = 42')
    expect(document.body.textContent).toContain('已同步')
  })

  it('downloads the dirty source draft without reloading it from the discard dialog', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-draft')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const editContext = createEditContext()
    renderRenderer({ editContext })

    await inputValue(editor(), 'const draft = true')
    await click(buttonWithText('重新加载'))
    await click(buttonWithText('下载本地版本'))

    expect(editContext.reload).not.toHaveBeenCalled()
    expect(editor().value).toBe('const draft = true')
    expect(createObjectURL).toHaveBeenCalled()
    expect(clickAnchor).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-draft')
  })

  it('keeps newer source edits dirty after a pending save resolves', async () => {
    let resolveSave!: () => void
    const savePromise = new Promise<never>((resolve) => {
      resolveSave = () => resolve({} as never)
    })
    const editContext = createEditContext({
      saveText: vi.fn(() => savePromise),
    })
    renderRenderer({ editContext })

    await inputValue(editor(), 'const submitted = true')
    await click(buttonWithText('保存'))
    await inputValue(editor(), 'const newer = true')
    await act(async () => {
      monacoMockState.saveCommand?.handler()
      await Promise.resolve()
    })

    expect(editContext.saveText).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave()
      await savePromise
      await Promise.resolve()
    })

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: 'const submitted = true',
      baseVersionId: 'version-1',
    })
    expect(editor().value).toBe('const newer = true')
    expect(document.body.textContent).toContain('未保存')
    expect(document.body.textContent).not.toContain('已同步')
  })

  it('registers dirty source text for external restore confirmations', async () => {
    renderRenderer()

    expect(toolbarHost()?.dataset.unsaved).toBe('false')

    await inputValue(editor(), 'const draft = true')

    expect(toolbarHost()?.dataset.unsaved).toBe('true')
  })

  it('registers login action for shared read-only previews', () => {
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
        <DriveCodeRenderer
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
    name: 'script.ts',
    type: 'file',
    size: '18',
    mimeType: 'text/typescript',
    updatedAt: '2026-06-09T00:00:00.000Z',
    previewKind: 'code',
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
    kind: 'code',
    text: 'const initial = true',
    html: null,
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

function createEditContext(input: Partial<DriveRendererEditContext> = {}) {
  return {
    reload: vi.fn(async () => baseSnapshot()),
    reloading: false,
    saveText: vi.fn(async () => ({}) as never),
    savingText: false,
    ...input,
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
  const element = document.querySelector('[data-monaco-editor="true"]')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('code editor not found')
  return element
}

function buttonWithText(text: string): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
  if (!(element instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`)
  return element
}

function anchorWithText(text: string): HTMLAnchorElement {
  const element = Array.from(document.querySelectorAll('a')).find((anchor) => anchor.textContent?.includes(text))
  if (!(element instanceof HTMLAnchorElement)) throw new Error(`anchor not found: ${text}`)
  return element
}
