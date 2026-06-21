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

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    default: ({
      value,
      onChange,
      options,
    }: {
      readonly value?: string
      readonly onChange?: (value?: string) => void
      readonly options?: { readonly readOnly?: boolean }
    }) => React.createElement('textarea', {
      'data-monaco-editor': 'true',
      readOnly: options?.readOnly,
      value: value ?? '',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event.currentTarget.value)
      },
    }),
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

describe('DriveCodeRenderer', () => {
  it('reloads from the returned snapshot instead of the old preview text', async () => {
    const editContext = createEditContext({
      reload: vi.fn(async () => baseSnapshot({ preview: { ...basePreview(), text: 'const answer = 42' } })),
    })
    renderRenderer({ editContext })

    await inputValue(editor(), 'const draft = true')
    expect(document.body.textContent).toContain('未保存')

    await click(buttonWithText('重新加载'))

    expect(editContext.reload).toHaveBeenCalled()
    expect(editor().value).toBe('const answer = 42')
    expect(document.body.textContent).toContain('已同步')
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

  act(() => {
    root?.render(
      <DriveRendererToolbarProvider>
        <ToolbarHost />
        <DriveCodeRenderer
          current={input.current ?? baseCurrent()}
          preview={input.preview ?? basePreview()}
          edit={input.edit === undefined ? editable() : input.edit}
          editContext={input.editContext ?? createEditContext()}
        />
      </DriveRendererToolbarProvider>
    )
  })
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
