// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { DriveBrowserPage } from './drive-browser-page'
import { useDriveBrowser, type DriveBrowserState } from './use-drive-browser'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const driveAnnotationsMock = vi.hoisted(() => ({
  value: {
    threads: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    createThread: vi.fn(async () => undefined),
    creatingThread: false,
    reply: vi.fn(async () => undefined),
    replying: false,
    updateComment: vi.fn(async () => undefined),
    updatingComment: false,
    deleteComment: vi.fn(async () => undefined),
    deletingComment: false,
    deleteThread: vi.fn(async () => undefined),
    deletingThread: false,
  },
}))

vi.mock('./use-drive-browser', () => ({
  useDriveBrowser: vi.fn(),
}))

vi.mock('./use-drive-annotations', () => ({
  useDriveAnnotations: () => driveAnnotationsMock.value,
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Range.prototype.getBoundingClientRect = vi.fn(() => domRect({ left: 80, top: 120, width: 48, height: 20 }))
  Range.prototype.getClientRects = vi.fn(() => [domRect({ left: 80, top: 120, width: 48, height: 20 })] as unknown as DOMRectList)
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
  vi.clearAllMocks()
})

describe('DriveBrowserPage', () => {
  it('renders the branded share password form and submits the entered password', async () => {
    const unlock = vi.fn()
    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock,
      unlocking: false,
      unlockError: null,
    })

    renderPage(<DriveBrowserPage context='share' shareId='share-1' />)

    const input = document.querySelector<HTMLInputElement>('#drive-share-password')
    const button = buttonWithText('打开分享')
    expect(document.querySelector('[aria-label="Synapse"]')).not.toBeNull()
    expect(document.querySelector<HTMLImageElement>('[aria-label="Synapse"] img')?.src).toContain('synapse-logo.png')
    expect(document.body.textContent).toContain('此分享受密码保护')
    expect(document.querySelector('label[for="drive-share-password"]')?.textContent).toBe('访问密码')
    expect(document.body.textContent).not.toContain('请输入密码。')
    expect(input?.required).toBe(true)
    expect(document.activeElement).toBe(input)
    expect(button?.disabled).toBe(true)

    if (!input || !button) throw new Error('Missing password controls.')
    await inputValue(input, 'letmein')
    expect(button.disabled).toBe(false)

    await act(async () => {
      button.click()
    })
    expect(unlock).toHaveBeenCalledWith('letmein')
  })

  it('disables the password controls while opening the share', async () => {
    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock: vi.fn(),
      unlocking: false,
      unlockError: null,
    })
    renderPage(<DriveBrowserPage context='share' shareId='share-1' />)

    const input = document.querySelector<HTMLInputElement>('#drive-share-password')
    if (!input) throw new Error('Missing password input.')
    await inputValue(input, 'letmein')

    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock: vi.fn(),
      unlocking: true,
      unlockError: null,
    })
    rerenderPage(<DriveBrowserPage context='share' shareId='share-1' />)

    expect(input.disabled).toBe(true)
    expect(buttonWithText('正在打开')?.disabled).toBe(true)
  })

  it('renders password errors beside the field without nesting an alert card', () => {
    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock: vi.fn(),
      unlocking: false,
      unlockError: '请输入密码。',
    })

    renderPage(<DriveBrowserPage context='share' shareId='share-1' />)

    const input = document.querySelector<HTMLInputElement>('#drive-share-password')
    const error = document.querySelector<HTMLElement>('#drive-share-password-error')
    expect(error?.textContent).toBe('密码不正确，请重试。')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(input?.getAttribute('aria-describedby')).toBe('drive-share-password-error')
    expect(document.querySelector('[data-slot="alert"]')).toBeNull()
  })

  it('uses the branded share shell while loading', () => {
    mockDriveBrowserState({ status: 'loading' })

    renderPage(<DriveBrowserPage context='share' shareId='share-1' />)

    expect(document.querySelector('[aria-label="Synapse"]')).not.toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(document.querySelector('main')?.className).toContain('bg-muted/30')
  })

  it('clears consumed initial share passwords when unlock falls back to the password form', () => {
    const onInitialPasswordConsumed = vi.fn()
    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock: vi.fn(),
      unlocking: false,
      unlockError: null,
    })

    renderPage(
      <DriveBrowserPage
        context='share'
        shareId='share-1'
        initialPassword='old-password'
        onInitialPasswordConsumed={onInitialPasswordConsumed}
      />
    )

    expect(onInitialPasswordConsumed).toHaveBeenCalledTimes(1)
  })

  it('keeps rejected initial password feedback after clearing the password query', () => {
    const onInitialPasswordConsumed = vi.fn()
    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock: vi.fn(),
      unlocking: false,
      unlockError: '请输入密码。',
    })
    renderPage(
      <DriveBrowserPage
        context='share'
        shareId='share-1'
        initialPassword='old-password'
        onInitialPasswordConsumed={onInitialPasswordConsumed}
      />
    )
    expect(document.body.textContent).toContain('密码不正确，请重试。')

    mockDriveBrowserState({
      status: 'passwordRequired',
      message: '请输入密码。',
      unlock: vi.fn(),
      unlocking: false,
      unlockError: null,
    })
    rerenderPage(<DriveBrowserPage context='share' shareId='share-1' onInitialPasswordConsumed={onInitialPasswordConsumed} />)

    expect(onInitialPasswordConsumed).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('密码不正确，请重试。')
  })

  it('renders invalid share links without exposing the underlying reason', () => {
    mockDriveBrowserState({
      status: 'invalidShare',
    })

    renderPage(<DriveBrowserPage context='share' shareId='share-1' />)

    expect(document.querySelector('[aria-label="Synapse"]')).not.toBeNull()
    expect(document.body.textContent).toContain('链接已失效')
    expect(document.body.textContent).toContain('请向文件所有者确认最新链接。')
    expect(document.body.textContent).not.toContain('文件未找到')
  })

  it('uses the branded share error state and retries in place', () => {
    const retry = vi.fn()
    mockDriveBrowserState({
      status: 'error',
      message: '网络错误',
      retry,
      retrying: false,
    })

    renderPage(<DriveBrowserPage context='share' shareId='share-1' />)

    buttonWithText('重试')?.click()

    expect(document.querySelector('[aria-label="Synapse"]')).not.toBeNull()
    expect(document.body.textContent).toContain('无法打开分享')
    expect(document.body.textContent).toContain('网络错误')
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('lets users retry after a browser load error', () => {
    const retry = vi.fn()
    mockDriveBrowserState({
      status: 'error',
      message: '网络错误',
      retry,
      retrying: false,
    })

    renderPage(<DriveBrowserPage context='owner' surface='standalone' itemId='file' />)

    buttonWithText('重试')?.click()

    expect(document.body.textContent).toContain('网络错误')
    expect(retry).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[aria-label="Synapse"]')).toBeNull()
  })

  it('allows selected-text comments in console markdown file views', async () => {
    mockDriveBrowserState({
      status: 'ready',
      snapshot: createSnapshot({
        context: 'owner',
        surface: 'console',
        current: {
          ...baseCurrent(),
          name: 'notes.md',
          mimeType: 'text/markdown',
          previewKind: 'markdown',
        },
        preview: {
          ...basePreview(),
          kind: 'markdown',
          text: '**重点** 内容',
          html: '<p><strong>重点</strong> 内容</p>',
          visitUrl: null,
        },
      }),
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload: vi.fn(async () => createSnapshot()),
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })

    renderPage(<DriveBrowserPage context='owner' surface='console' itemId='file' />)
    selectStrongText()

    await act(async () => {
      document.querySelector('[data-testid="markdown-body"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(buttonWithText('添加评论')).not.toBeNull()
  })

  it('keeps standalone owner file reader behavior outside the console shell', () => {
    mockDriveBrowserState({
      status: 'ready',
      snapshot: createSnapshot({
        surface: 'standalone',
        current: {
          ...baseCurrent(),
          name: 'notes.md',
          previewKind: 'markdown',
        },
      }),
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload: vi.fn(async () => createSnapshot()),
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })

    renderPage(<DriveBrowserPage context='owner' surface='standalone' itemId='file' />)

    expect(document.body.textContent).toContain('notes.md')
  })

  it('uses injected client navigation for finder rows and breadcrumbs', () => {
    const onNavigate = vi.fn()
    mockDriveBrowserState({
      status: 'ready',
      snapshot: createSnapshot({
        current: {
          ...baseCurrent(),
          id: 'folder',
          name: 'folder',
          type: 'folder',
          previewKind: 'download-only',
        },
        preview: null,
        canZip: true,
        children: [{
          ...baseCurrent(),
          id: 'child',
          name: 'child.md',
          browserUrl: '/drive/items/child',
        }],
      }),
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload: vi.fn(async () => createSnapshot()),
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })

    renderPage(<DriveBrowserPage context='owner' surface='standalone' itemId='folder' onNavigate={onNavigate} />)

    rowWithText('child.md')?.click()
    expect(onNavigate).toHaveBeenCalledWith('/drive/items/child')

    const breadcrumb = document.querySelector<HTMLAnchorElement>('a[href="/drive/items/root"]')
    breadcrumb?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
    expect(onNavigate).toHaveBeenCalledWith('/drive/items/root')
  })
})

function mockDriveBrowserState(state: DriveBrowserState) {
  vi.mocked(useDriveBrowser).mockReturnValue(state)
}

function renderPage(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(element)
  })
}

function rerenderPage(element: ReactElement) {
  act(() => {
    root?.render(element)
  })
}

function createSnapshot(input: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: baseCurrent(),
    breadcrumbs: [{ id: 'root', name: 'root', browserUrl: '/drive/items/root' }],
    children: [],
    preview: basePreview(),
    edit: null,
    annotation: null,
    canDownload: true,
    canZip: false,
    ...input,
  }
}

function baseCurrent(): DriveBrowserSnapshotDto['current'] {
  return {
    id: 'file',
    name: 'notes.md',
    type: 'file',
    size: '11',
    mimeType: 'text/markdown',
    updatedAt: '2026-06-09T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/console/drive/items/file?surface=console',
    downloadUrl: '/drive/items/file/download',
  }
}

function basePreview(): NonNullable<DriveBrowserSnapshotDto['preview']> {
  return {
    kind: 'markdown',
    text: '**重点** 内容',
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    relativeImages: [],
    html: '<p><strong>重点</strong> 内容</p>',
    outline: null,
  }
}

function selectStrongText(): void {
  const text = document.querySelector('strong')?.firstChild
  if (!text) throw new Error('Missing selectable text.')
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 2)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes(text)) ?? null
}

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

function rowWithText(text: string): HTMLTableRowElement | null {
  return Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
    .find((row) => row.textContent?.includes(text)) ?? null
}

function domRect(input: Partial<DOMRect> = {}): DOMRect {
  return {
    x: input.x ?? input.left ?? 0,
    y: input.y ?? input.top ?? 0,
    left: input.left ?? input.x ?? 0,
    top: input.top ?? input.y ?? 0,
    right: input.right ?? (input.left ?? input.x ?? 0) + (input.width ?? 0),
    bottom: input.bottom ?? (input.top ?? input.y ?? 0) + (input.height ?? 0),
    width: input.width ?? 0,
    height: input.height ?? 0,
    toJSON: () => ({}),
  } as DOMRect
}
