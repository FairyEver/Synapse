// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { DriveRendererContent, DriveRendererShell, refreshBeforeDriveRendererSwitch } from './drive-renderer-shell'

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
    InsertTable: () => null,
    InsertThematicBreak: () => null,
    ListsToggle: () => null,
    UndoRedo: () => null,
    codeBlockPlugin: () => ({ name: 'codeBlockPlugin' }),
    codeMirrorPlugin: () => ({ name: 'codeMirrorPlugin' }),
    headingsPlugin: () => ({ name: 'headingsPlugin' }),
    linkDialogPlugin: () => ({ name: 'linkDialogPlugin' }),
    linkPlugin: () => ({ name: 'linkPlugin' }),
    listsPlugin: () => ({ name: 'listsPlugin' }),
    markdownShortcutPlugin: () => ({ name: 'markdownShortcutPlugin' }),
    quotePlugin: () => ({ name: 'quotePlugin' }),
    realmPlugin: () => () => ({ name: 'realmPlugin' }),
    createActiveEditorSubscription$: Symbol('createActiveEditorSubscription$'),
    createRootEditorSubscription$: Symbol('createRootEditorSubscription$'),
    lexical: {},
    $createGenericHTMLNode: () => null,
    $isImageNode: () => false,
    tablePlugin: () => ({ name: 'tablePlugin' }),
    thematicBreakPlugin: () => ({ name: 'thematicBreakPlugin' }),
    toolbarPlugin: () => ({ name: 'toolbarPlugin' }),
  }
})

vi.mock('../use-drive-annotations', () => ({
  useDriveAnnotations: () => ({
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
  }),
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
  it('refreshes the latest checkpoint before entering MDXEditor from collaboration', async () => {
    const reload = vi.fn(async () => baseSnapshot())

    await refreshBeforeDriveRendererSwitch({ id: 'mdxeditor', collaborationEnabled: true, reload })

    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload when switching between collaboration-aware renderers', async () => {
    const reload = vi.fn(async () => baseSnapshot())

    await refreshBeforeDriveRendererSwitch({ id: 'code', collaborationEnabled: true, reload })
    await refreshBeforeDriveRendererSwitch({ id: 'markdown', collaborationEnabled: true, reload })

    expect(reload).not.toHaveBeenCalled()
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

  it('keeps editable share markdown toolbar registration stable', () => {
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
    expect(Array.from(document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === '图片来源')).toHaveLength(1)
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
