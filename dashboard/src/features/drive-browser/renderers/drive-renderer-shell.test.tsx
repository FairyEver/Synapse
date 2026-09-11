// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { DrivePreviewToolbarItemView } from './drive-preview-header'
import { DriveRendererContent, DriveRendererShell, refreshBeforeDriveRendererMount } from './drive-renderer-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    default: ({
      value,
      options,
    }: {
      readonly value?: string
      readonly options?: { readonly readOnly?: boolean }
    }) => React.createElement('textarea', {
      'data-monaco-editor': 'true',
      readOnly: options?.readOnly,
      value: value ?? '',
    }),
  }
})

vi.mock('@mdxeditor/editor/style.css', () => ({}))

vi.mock('@mdxeditor/editor', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    MDXEditor: React.forwardRef(({
      markdown,
      readOnly,
    }: {
      readonly markdown: string
      readonly readOnly?: boolean
    }, ref: React.Ref<{ setMarkdown: (value: string) => void }>) => {
      React.useImperativeHandle(ref, () => ({
        setMarkdown: () => undefined,
      }), [])
      return React.createElement('textarea', {
        'data-mdxeditor': 'true',
        readOnly,
        value: markdown,
      })
    }),
    BlockTypeSelect: () => null,
    BoldItalicUnderlineToggles: () => null,
    CreateLink: () => null,
    DiffSourceToggleWrapper: ({ children }: { readonly children: React.ReactNode }) => children,
    InsertCodeBlock: () => null,
    InsertTable: () => null,
    InsertThematicBreak: () => null,
    ListsToggle: () => null,
    UndoRedo: () => null,
    codeBlockPlugin: () => ({ name: 'codeBlockPlugin' }),
    codeMirrorPlugin: () => ({ name: 'codeMirrorPlugin' }),
    diffSourcePlugin: () => ({ name: 'diffSourcePlugin' }),
    headingsPlugin: () => ({ name: 'headingsPlugin' }),
    imagePlugin: () => ({ name: 'imagePlugin' }),
    jsxPlugin: () => ({ name: 'jsxPlugin' }),
    linkDialogPlugin: () => ({ name: 'linkDialogPlugin' }),
    linkPlugin: () => ({ name: 'linkPlugin' }),
    listsPlugin: () => ({ name: 'listsPlugin' }),
    markdownShortcutPlugin: () => ({ name: 'markdownShortcutPlugin' }),
    GenericHTMLNode: class {},
    GenericJsxEditor: () => null,
    quotePlugin: () => ({ name: 'quotePlugin' }),
    realmPlugin: () => () => ({ name: 'realmPlugin' }),
    createActiveEditorSubscription$: Symbol('createActiveEditorSubscription$'),
    createRootEditorSubscription$: Symbol('createRootEditorSubscription$'),
    lexical: { DecoratorNode: class {}, LineBreakNode: class {} },
    $createGenericHTMLNode: () => null,
    $isImageNode: () => false,
    tablePlugin: () => ({ name: 'tablePlugin' }),
    thematicBreakPlugin: () => ({ name: 'thematicBreakPlugin' }),
    toolbarPlugin: () => ({ name: 'toolbarPlugin' }),
  }
})

const annotationsMock = vi.hoisted(() => ({
  threads: [],
  loading: false,
  error: null,
  refresh: vi.fn(),
  createThread: vi.fn(),
  creatingThread: false,
  reply: vi.fn(),
  replying: false,
  updateComment: vi.fn(),
  updatingComment: false,
  deleteComment: vi.fn(),
  deletingComment: false,
}))

vi.mock('../use-drive-annotations', () => ({
  useDriveAnnotations: () => annotationsMock,
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('DriveRendererShell', () => {
  it('keeps the regular preview header compact and reveals file metadata from the file name', async () => {
    renderShell({
      snapshot: baseSnapshot({
        current: {
          ...baseSnapshot().current,
          name: 'notes.txt',
          previewKind: 'text',
        },
      }),
      rendererId: 'code',
    })

    const header = document.querySelector<HTMLElement>('[data-file-preview-header="regular"]')
    const fileName = document.querySelector<HTMLElement>('[data-drive-preview-file-name="true"]')
    if (!header || !fileName) throw new Error('regular preview header not found')

    expect(header.className).toContain('p-2')
    expect(header.className).not.toContain('flex-col')
    expect(header.textContent).not.toContain('18 B')

    await act(async () => {
      fileName.focus()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const metadata = document.querySelector<HTMLElement>('[data-drive-preview-file-metadata="true"]')
    expect(metadata?.textContent).toContain('18 B')
    expect(metadata?.textContent).toContain('文本')
    expect(metadata?.querySelector('time')?.dateTime).toBe('2026-06-09T00:00:00.000Z')
  })

  it('uses a flat active state and stable numerals for preview toggles', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(
        <DrivePreviewToolbarItemView
          item={{
            kind: 'toggle',
            id: 'comments',
            label: '评论 5',
            pressed: true,
            onPressedChange: vi.fn(),
          }}
        />
      )
    })

    const comments = buttonWithText('评论 5')
    expect(comments.getAttribute('aria-pressed')).toBe('true')
    expect(comments.className).toContain('bg-secondary')
    expect(comments.className).toContain('shadow-none')
    expect(comments.className).toContain('tabular-nums')
  })

  it('refreshes the latest checkpoint before entering the rich Markdown editor from collaboration', async () => {
    const reload = vi.fn(async () => baseSnapshot())

    await refreshBeforeDriveRendererMount({ id: 'mdxeditor', collaborationEnabled: true, reload })

    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload when switching between collaboration-aware renderers', async () => {
    const reload = vi.fn(async () => baseSnapshot())

    await refreshBeforeDriveRendererMount({ id: 'code', collaborationEnabled: true, reload })
    await refreshBeforeDriveRendererMount({ id: 'markdown', collaborationEnabled: true, reload })

    expect(reload).not.toHaveBeenCalled()
  })

  it('waits for an existing successful reload before mounting MDXeditor', async () => {
    const rendererId = 'mdxeditor'
    const selector = '[data-mdxeditor="true"]'
    const snapshot = markdownSnapshot()
    const refreshedSnapshot = markdownSnapshot({ text: '# Refreshed' })
    const existingReload = deferred<DriveBrowserSnapshotDto>()
    const reload = vi.fn(() => existingReload.promise)
    const reloadingEditContext = createEditContext({ reload, reloading: true })

    const reloadPromise = reload()
    renderShell({ snapshot, initialRendererId: rendererId, editContext: reloadingEditContext })
    await act(async () => undefined)

    expect(document.querySelector(selector)).toBeNull()
    expect(reload).toHaveBeenCalledOnce()

    existingReload.resolve(refreshedSnapshot)
    await act(async () => reloadPromise)
    rerenderShell({
      snapshot: refreshedSnapshot,
      initialRendererId: rendererId,
      editContext: createEditContext({ reload, reloading: false }),
    })
    await waitForSelector(selector)

    expect(reload).toHaveBeenCalledOnce()
  })

  it('retries after an existing reload fails before mounting MDXeditor', async () => {
    const rendererId = 'mdxeditor'
    const selector = '[data-mdxeditor="true"]'
    const snapshot = markdownSnapshot()
    const retriedSnapshot = markdownSnapshot({ text: '# Retried' })
    const retry = deferred<DriveBrowserSnapshotDto>()
    const reload = vi.fn()
      .mockRejectedValueOnce(new Error('reload failed'))
      .mockImplementationOnce(() => retry.promise)
    const failedReload = reload()

    renderShell({
      snapshot,
      initialRendererId: rendererId,
      editContext: createEditContext({ reload, reloading: true }),
    })
    await expect(failedReload).rejects.toThrow('reload failed')
    rerenderShell({
      snapshot,
      initialRendererId: rendererId,
      editContext: createEditContext({ reload, reloading: false }),
    })
    await act(async () => undefined)

    expect(reload).toHaveBeenCalledTimes(2)
    expect(document.querySelector(selector)).toBeNull()

    retry.resolve(retriedSnapshot)
    await act(async () => retry.promise)
    await waitForSelector(selector)

    expect(document.querySelector(selector)).not.toBeNull()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not duplicate or race renderer changes during an MDXeditor mount refresh', async () => {
    const label = 'MDXeditor'
    const selector = '[data-mdxeditor="true"]'
    const refresh = deferred<DriveBrowserSnapshotDto>()
    const snapshot = markdownSnapshot()
    const reload = vi.fn(() => refresh.promise)

    renderShell({
      snapshot,
      initialRendererId: 'markdown',
      editContext: createEditContext({ reload }),
    })
    await selectRenderer(label)
    await act(async () => undefined)

    expect(reload).toHaveBeenCalledOnce()
    expect(document.querySelector(selector)).toBeNull()

    await selectRenderer('代码')
    expect(document.querySelector('[data-drive-code-renderer="true"]')).toBeNull()
    expect(reload).toHaveBeenCalledOnce()

    refresh.resolve(snapshot)
    await act(async () => refresh.promise)
    await waitForSelector(selector)

    expect(document.querySelector(selector)).not.toBeNull()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('renders registered code actions in the shared header', () => {
    window.history.pushState(null, '', '/share/share-1')
    renderShell({
      snapshot: baseSnapshot({
        context: 'share',
        edit: { canEdit: false, reason: 'login_required', currentVersionId: null },
      }),
    })

    expect(document.querySelector('[data-drive-preview-header="true"]')).not.toBeNull()
    expect(anchorWithText('登录后编辑').getAttribute('href')).toBe('/console/sign-in?redirect=%2Fshare%2Fshare-1')
  })

  it('keeps file actions in the shared overflow menu', async () => {
    renderShell({
      snapshot: baseSnapshot({
        current: {
          ...baseSnapshot().current,
          name: 'notes.md',
          mimeType: 'text/markdown',
          previewKind: 'markdown',
        },
        preview: {
          kind: 'markdown',
          text: '# Notes',
          html: '<h1>Notes</h1>',
          outline: [],
          truncated: false,
          imageUrl: null,
          visitUrl: null,
          relativeImages: [],
        },
      }),
      rendererId: 'markdown',
    })

    expect(buttonWithText('打开方式')).not.toBeNull()
    expect(document.querySelector<HTMLElement>('[data-drive-preview-renderer-actions="true"]')?.className).toContain('gap-1')
    expect(buttonWithText('打开方式').className.split(/\s+/u)).not.toContain('border')
    expect(document.body.textContent).not.toContain('在云盘中查看')
    expect(document.body.textContent).not.toContain('历史版本')

    await click(buttonWithLabel('更多操作'))

    expect(menuItemTexts()).toEqual(['下载', '在云盘中查看', '历史版本'])
  })

  it('shows the edit unavailable reason in the shared header', () => {
    renderShell({
      snapshot: baseSnapshot({
        edit: {
          canEdit: false,
          editorKind: 'text',
          currentVersionId: null,
          reason: 'permission_denied',
        },
      }),
    })

    expect(document.body.textContent).toContain('没有编辑权限')
  })

  it('allows direct content rendering without a toolbar provider', () => {
    const html = renderToStaticMarkup(
      <DriveRendererContent
        snapshot={baseSnapshot()}
        selected={{ id: 'code', label: '代码', container: 'full' }}
        body
      />,
    )

    expect(html).toContain('data-drive-code-renderer="true"')
  })

  it('centers the download-only state in the available preview area', () => {
    const html = renderToStaticMarkup(
      <DriveRendererContent
        snapshot={baseSnapshot({
          current: {
            ...baseSnapshot().current,
            name: 'report.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            previewKind: 'download-only',
          },
          preview: null,
        })}
        selected={{ id: 'download', label: '下载', container: 'reading' }}
      />,
    )

    expect(html).toContain('data-drive-download-state="true"')
    expect(html).toContain('min-h-full items-center justify-center')
    expect(html).toContain('无法在线预览')
    expect(html).toContain('该文件格式暂不支持在线预览，请下载后查看。')
    expect(html).toContain('href="/drive/items/file/download"')
    expect(html).toContain('下载文件')
  })

  it('does not make the markdown renderer host the scroll container', () => {
    const html = renderToStaticMarkup(
      <DriveRendererContent
        snapshot={baseSnapshot({
          current: {
            ...baseSnapshot().current,
            name: 'notes.md',
            mimeType: 'text/markdown',
            previewKind: 'markdown',
          },
          preview: {
            kind: 'markdown',
            text: '# Notes',
            html: '<h1>Notes</h1>',
            outline: [],
            truncated: false,
            imageUrl: null,
            visitUrl: null,
            relativeImages: [],
          },
        })}
        selected={{ id: 'markdown', label: '预览', container: 'reading' }}
        body
      />,
    )

    expect(html).toContain('overflow-hidden')
    expect(html).not.toContain('overflow-auto"><div class="min-h-full bg-background"')
  })

  it('does not render the retired image-source action for editable share markdown', () => {
    const snapshot = baseSnapshot({
      context: 'share',
      current: {
        ...baseSnapshot().current,
        name: 'notes.md',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
        browserUrl: '/share/share-1',
        downloadUrl: '/share/share-1/download',
      },
      breadcrumbs: [{ id: 'file', name: 'notes.md', browserUrl: '/share/share-1' }],
      preview: {
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        outline: [],
        truncated: false,
        imageUrl: null,
        visitUrl: null,
        relativeImages: [],
      },
      annotation: { canComment: true, reason: null },
    })

    renderShell({
      snapshot,
      rendererId: 'markdown',
      editContext: {
        reload: vi.fn(async () => snapshot),
        reloading: false,
        saveText: vi.fn(),
        savingText: false,
      },
      annotationContext: {
        context: 'share',
        shareId: 'share-1',
        itemId: 'file',
        canComment: true,
      },
    })

    expect(document.body.textContent).toContain('Notes')
    expect(document.body.textContent).not.toContain('图片来源')
  })
})

function renderShell(props: ComponentProps<typeof DriveRendererShell>) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(<DriveRendererShell {...props} />)
  })
}

function rerenderShell(props: ComponentProps<typeof DriveRendererShell>) {
  act(() => {
    root?.render(<DriveRendererShell {...props} />)
  })
}

function markdownSnapshot({
  id = 'file',
  text = '# Notes',
  collaborationEnabled = true,
}: {
  readonly id?: string
  readonly text?: string
  readonly collaborationEnabled?: boolean
} = {}): DriveBrowserSnapshotDto {
  return baseSnapshot({
    current: {
      ...baseSnapshot().current,
      id,
      name: `${id}.md`,
      mimeType: 'text/markdown',
      previewKind: 'markdown',
    },
    preview: {
      kind: 'markdown',
      text,
      html: '<h1>Notes</h1>',
      outline: [],
      truncated: false,
      imageUrl: null,
      visitUrl: null,
      relativeImages: [],
    },
    collaboration: collaborationEnabled ? {
      enabled: true,
      canRead: true,
      canWrite: true,
      epoch: 'epoch-1',
      checkpointVersionId: 'version-1',
      websocketPath: '/api/drive/collaboration',
      reason: null,
    } : null,
  })
}

function createEditContext(input: Partial<NonNullable<ComponentProps<typeof DriveRendererShell>['editContext']>> = {}) {
  return {
    reload: vi.fn(async () => baseSnapshot()),
    reloading: false,
    saveText: vi.fn(),
    savingText: false,
    ...input,
  }
}

function baseSnapshot(input: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: {
      id: 'file',
      name: 'script.ts',
      type: 'file',
      size: '18',
      mimeType: 'text/typescript',
      updatedAt: '2026-06-09T00:00:00.000Z',
      previewKind: 'code',
      browserUrl: '/drive/items/file',
      downloadUrl: '/drive/items/file/download',
    },
    breadcrumbs: [{ id: 'root', name: 'root', browserUrl: '/drive/items/root' }],
    children: [],
    preview: {
      kind: 'code',
      text: 'const initial = true',
      html: null,
      outline: null,
      truncated: false,
      imageUrl: null,
      visitUrl: null,
      relativeImages: [],
    },
    edit: {
      canEdit: true,
      editorKind: 'text',
      currentVersionId: 'version-1',
      reason: null,
    },
    annotation: null,
    canDownload: true,
    canZip: false,
    ...input,
  }
}

function anchorWithText(text: string): HTMLAnchorElement {
  const element = Array.from(document.querySelectorAll('a')).find((anchor) => anchor.textContent?.includes(text))
  if (!(element instanceof HTMLAnchorElement)) throw new Error(`anchor not found: ${text}`)
  return element
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    element.click()
  })
}

async function selectRenderer(label: string) {
  await click(buttonWithText('打开方式'))
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'))
    .find((item) => item.textContent?.includes(label))
  if (!option) throw new Error(`renderer option not found: ${label}`)
  await click(option)
}

async function waitForSelector(selector: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    if (document.querySelector(selector)) return
  }
  throw new Error(`element not found: ${selector}`)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function buttonWithLabel(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!element) throw new Error(`button not found: ${label}`)
  return element
}

function buttonWithText(text: string): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes(text))
  if (!element) throw new Error(`button not found: ${text}`)
  return element
}

function menuItemTexts(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .map((item) => item.textContent?.trim() ?? '')
}
