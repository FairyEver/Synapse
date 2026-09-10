// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const crepeHarness = vi.hoisted(() => ({
  rejectNextCreate: false,
  instances: [] as Array<{
    readonly defaultValue: string
    readonly create: ReturnType<typeof vi.fn>
    readonly destroy: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@milkdown/crepe', () => {
  const CrepeFeature = {
    AI: 'AI',
    BlockEdit: 'BlockEdit',
    CodeMirror: 'CodeMirror',
    ImageBlock: 'ImageBlock',
    Latex: 'Latex',
    LinkTooltip: 'LinkTooltip',
    Placeholder: 'Placeholder',
    Toolbar: 'Toolbar',
    TopBar: 'TopBar',
  }

  class Crepe {
    readonly defaultValue: string
    readonly root: HTMLElement
    readonly destroyListeners: Array<() => void> = []
    readonly editor = {
      status: 'Idle',
      action: vi.fn(),
      config: vi.fn(() => this.editor),
      use: vi.fn(() => this.editor),
    }
    readonly create = vi.fn(async () => {
      if (crepeHarness.rejectNextCreate) {
        crepeHarness.rejectNextCreate = false
        throw new Error('Crepe create failed')
      }
      this.editor.status = 'Created'
      const shell = document.createElement('div')
      shell.className = 'milkdown'
      const content = document.createElement('div')
      content.className = 'ProseMirror'
      content.contentEditable = 'true'
      content.textContent = this.defaultValue
      shell.append(content)
      this.root.append(shell)
      return this.editor
    })
    readonly destroy = vi.fn(async () => {
      if (this.editor.status === 'Destroyed') return this.editor
      this.editor.status = 'Destroyed'
      this.root.replaceChildren()
      this.destroyListeners.forEach((listener) => listener())
      return this.editor
    })
    readonly getMarkdown = vi.fn(() => this.defaultValue)
    readonly setReadonly = vi.fn((readOnly: boolean) => {
      this.root.querySelector<HTMLElement>('.ProseMirror')?.setAttribute('contenteditable', String(!readOnly))
      return this
    })
    readonly on = vi.fn((register: (listener: {
      markdownUpdated: (callback: () => void) => void
      updated: (callback: () => void) => void
      destroy: (callback: () => void) => void
    }) => void) => {
      register({
        markdownUpdated: () => undefined,
        updated: () => undefined,
        destroy: (callback) => this.destroyListeners.push(callback),
      })
      return this
    })

    constructor({ root, defaultValue = '' }: { readonly root: HTMLElement; readonly defaultValue?: string }) {
      this.root = root
      this.defaultValue = defaultValue
      crepeHarness.instances.push(this)
    }
  }

  return { Crepe, CrepeFeature }
})

import { DriveMilkdownRenderer } from './milkdown-renderer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  crepeHarness.rejectNextCreate = false
  crepeHarness.instances.length = 0
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  })
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DriveMilkdownRenderer Crepe lifecycle', () => {
  it('keeps the original Markdown editable in source mode when Crepe creation rejects', async () => {
    const source = '# Original\n\nKeep every line.'
    const context = editContext()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    crepeHarness.rejectNextCreate = true
    renderRenderer({ preview: preview(source), editContext: context })

    await waitForCrepeInstances(1)
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    const textarea = await waitForTextarea()
    expect(textarea.value).toBe(source)
    expect(textarea.readOnly).toBe(false)
    expect(document.body.textContent).toContain('解析失败')

    await inputTextarea(textarea, `${source}\nLocal edit`)
    await pressSaveShortcut()

    expect(context.saveText).toHaveBeenCalledWith({
      text: `${source}\nLocal edit`,
      baseVersionId: 'version-1',
    })
  })

  it('destroys each Crepe instance once and rebuilds from the next document source', async () => {
    const renderer = renderRenderer({
      current: current('first'),
      preview: preview('# First document'),
      editContext: editContext(),
    })
    await waitForCrepeInstances(1)
    const first = crepeHarness.instances[0]
    expect(first?.defaultValue).toBe('# First document')

    renderer.rerender({
      current: current('second'),
      preview: preview('# Second document'),
      edit: { ...editable(), currentVersionId: 'version-2' },
    })
    await waitForCrepeInstances(2)
    const second = crepeHarness.instances[1]

    expect(first?.destroy).toHaveBeenCalledOnce()
    expect(second?.defaultValue).toBe('# Second document')
    expect(document.querySelector('.ProseMirror')?.textContent).toBe('# Second document')

    await renderer.unmount()

    expect(first?.destroy).toHaveBeenCalledOnce()
    expect(second?.destroy).toHaveBeenCalledOnce()
  })
})

type RenderOptions = {
  readonly current?: DriveBrowserItemDto
  readonly preview?: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: React.ComponentProps<typeof DriveMilkdownRenderer>['editContext']
}

function renderRenderer({
  current: nextCurrent = current(),
  preview: nextPreview = preview('# Notes'),
  edit = editable(),
  editContext: nextEditContext,
}: RenderOptions) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  let options = { current: nextCurrent, preview: nextPreview, edit, editContext: nextEditContext }
  const render = () => act(() => {
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <DriveMilkdownRenderer {...options} />
      </QueryClientProvider>
    )
  })
  render()
  return {
    rerender(next: RenderOptions) {
      options = { ...options, ...next }
      render()
    },
    async unmount() {
      await act(async () => {
        root?.unmount()
        await Promise.resolve()
      })
      root = null
    },
  }
}

function current(id = 'file'): DriveBrowserItemDto {
  return {
    id,
    name: `${id}.md`,
    type: 'file',
    size: '32',
    mimeType: 'text/markdown',
    updatedAt: '2026-09-08T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: `/console/drive/items/${id}`,
    downloadUrl: `/api/drive/items/${id}/content`,
  }
}

function preview(text: string): DriveBrowserPreviewDto {
  return {
    kind: 'markdown',
    text,
    html: '<h1>Notes</h1>',
    outline: [],
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    relativeImages: [],
  }
}

function editable(): DriveBrowserEditDto {
  return { canEdit: true, editorKind: 'text', currentVersionId: 'version-1', reason: null }
}

function editContext(): NonNullable<React.ComponentProps<typeof DriveMilkdownRenderer>['editContext']> {
  return {
    reload: vi.fn(async () => ({} as never)),
    reloading: false,
    saveText: vi.fn(async () => ({} as never)),
    savingText: false,
  }
}

async function waitForTextarea(): Promise<HTMLTextAreaElement> {
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector('textarea[aria-label="Markdown 源码"]')).not.toBeNull())
  })
  return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown 源码"]')!
}

async function waitForCrepeInstances(count: number): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(crepeHarness.instances).toHaveLength(count))
  })
}

async function inputTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function pressSaveShortcut(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLElement>('[data-drive-milkdown-renderer="true"]')?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }))
    await Promise.resolve()
  })
}
