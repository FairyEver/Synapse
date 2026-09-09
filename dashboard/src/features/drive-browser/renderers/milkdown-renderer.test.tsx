// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Crepe } from '@milkdown/crepe'
import type { DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto, DriveHostedDocumentImageDto } from '@synapse/shared'
import { ApiError, driveBrowserApi } from '@/lib/api'
import { DriveMilkdownRenderer, requiresMilkdownSourceMode } from './milkdown-renderer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: vi.fn(() => []),
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: vi.fn(() => new DOMRect()),
  })
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
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

describe('DriveMilkdownRenderer', () => {
  it('uses source fallback for YAML and TOML frontmatter without mistaking a thematic break for frontmatter', () => {
    expect(requiresMilkdownSourceMode('---\ntitle: Notes\n---\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('+++\ntitle = "Notes"\n+++\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('---\n\nParagraph')).toBe(false)
    expect(requiresMilkdownSourceMode('```yaml\n---\ntitle: Notes\n---\n```')).toBe(false)
    expect(requiresMilkdownSourceMode('```md\n[docs]: /inside-code\n```')).toBe(false)
  })

  it('keeps link reference definitions byte-for-byte in source fallback', async () => {
    const source = [
      '# References',
      '',
      'Read [the docs][docs].',
      '',
      '[docs]: /guide "Guide title"',
      '[unused]: /keep-this-definition',
    ].join('\n')
    const saveText = vi.fn(async () => ({} as never))
    renderRenderer({
      preview: preview(source),
      editContext: {
        reload: vi.fn(async () => ({} as never)),
        reloading: false,
        saveText,
        savingText: false,
      },
    })

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(requiresMilkdownSourceMode(source)).toBe(true)
    expect(textarea.value).toBe(source)

    await inputTextarea(textarea, `${source}\n`)
    await pressSaveShortcut()

    expect(saveText).toHaveBeenCalledWith({
      text: `${source}\n`,
      baseVersionId: 'version-1',
    })
  })

  it('keeps source fallback editable and saves it with the current version', async () => {
    const saveText = vi.fn(async () => ({} as never))
    renderRenderer({
      preview: preview('---\ntitle: Notes\n---\n# Notes'),
      editContext: {
        reload: vi.fn(async () => ({} as never)),
        reloading: false,
        saveText,
        savingText: false,
      },
    })

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toContain('title: Notes')

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, '---\ntitle: Updated\n---\n# Notes')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
      document.querySelector<HTMLElement>('[data-drive-milkdown-renderer="true"]')?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }))
      await Promise.resolve()
    })

    expect(saveText).toHaveBeenCalledWith({
      text: '---\ntitle: Updated\n---\n# Notes',
      baseVersionId: 'version-1',
    })
  })

  it('inserts a selected hosted image at the source textarea selection and restores focus', async () => {
    const source = '---\ntitle: Notes\n---\n# Notes'
    const file = new File(['image'], 'chart.png', { type: 'image/png' })
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(hostedImage())
    renderRenderer({
      preview: preview(source),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.getAttribute('aria-label')).toBe('Markdown 源码')
    const insertionPoint = source.indexOf('# Notes')
    textarea.focus()
    textarea.setSelectionRange(insertionPoint, insertionPoint)

    await selectImage(file)

    const markdown = `![chart](${hostedImage().url})`
    expect(textarea.value).toBe(`${source.slice(0, insertionPoint)}${markdown}${source.slice(insertionPoint)}`)
    expect(textarea.selectionStart).toBe(insertionPoint + markdown.length)
    expect(document.activeElement).toBe(textarea)
  })

  it.each([
    ['image-only', false],
    ['mixed', true],
  ] as const)('uploads and inserts %s clipboard images in source mode', async (_label, mixed) => {
    const source = '[docs]: /guide\n\nBody'
    const file = new File(['image'], 'chart.png', { type: 'image/png' })
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(hostedImage())
    renderRenderer({
      preview: preview(source),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    const insertionPoint = source.length
    textarea.setSelectionRange(insertionPoint, insertionPoint)
    const items = [{ type: 'image/png', getAsFile: () => file }]
    if (mixed) items.push({ type: 'text/plain', getAsFile: () => null as never })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { items } })

    await act(async () => {
      textarea.dispatchEvent(event)
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(event.defaultPrevented).toBe(true)
    expect(textarea.value).toBe(`${source}![chart](${hostedImage().url})`)
  })

  it('uploads and inserts dropped images at the source textarea selection', async () => {
    const source = '[docs]: /guide\n\nBody'
    const file = new File(['image'], 'chart.png', { type: 'image/png' })
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(hostedImage())
    renderRenderer({
      preview: preview(source),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    const insertionPoint = source.indexOf('Body')
    textarea.setSelectionRange(insertionPoint, insertionPoint)
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file], types: ['Files'] } })

    await act(async () => {
      textarea.dispatchEvent(event)
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(event.defaultPrevented).toBe(true)
    expect(textarea.value).toBe(`${source.slice(0, insertionPoint)}![chart](${hostedImage().url})${source.slice(insertionPoint)}`)
  })

  it('does not carry an old document upload or its insertion into the next document', async () => {
    let resolveUpload!: (image: DriveHostedDocumentImageDto) => void
    const uploadPromise = new Promise<DriveHostedDocumentImageDto>((resolve) => {
      resolveUpload = resolve
    })
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockReturnValue(uploadPromise)
    const firstSource = '[docs]: /first\n\nFirst'
    const secondSource = '[docs]: /second\n\nSecond'
    const renderer = renderRenderer({
      current: current('first'),
      preview: preview(firstSource),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'first' },
    })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    expect(document.body.textContent).toContain('上传中')

    renderer.rerender({
      current: current('second'),
      preview: preview(secondSource),
    })

    expect(document.body.textContent).not.toContain('上传中')
    await act(async () => {
      resolveUpload(hostedImage())
      await uploadPromise
      await Promise.resolve()
    })

    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(secondSource)
    expect(document.body.textContent).not.toContain('图片上传已失效')
  })

  it('keeps local source after a version conflict and can reload the server copy', async () => {
    const reload = vi.fn(async () => ({ preview: preview('---\ntitle: Server\n---\n# Notes') } as never))
    const saveText = vi.fn(async () => {
      throw new ApiError('版本冲突', 409)
    })
    renderRenderer({
      preview: preview('---\ntitle: Notes\n---\n# Notes'),
      editContext: { reload, reloading: false, saveText, savingText: false },
    })

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, '---\ntitle: Local\n---\n# Notes')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
      document.querySelector<HTMLElement>('[data-drive-milkdown-renderer="true"]')?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }))
      await Promise.resolve()
    })

    expect(textarea.value).toContain('title: Local')
    expect(document.body.textContent).toContain('文件已有新内容')

    const reloadButton = Array.from(document.querySelectorAll('button')).filter((button) => button.textContent === '重新加载').at(-1)
    await act(async () => {
      reloadButton?.click()
      await Promise.resolve()
    })

    expect(reload).toHaveBeenCalled()
    expect(textarea.value).toContain('title: Server')
  })

  it('mounts the real Crepe editor for ordinary Markdown', async () => {
    renderRenderer({ preview: preview('# Notes\n\nBody') })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(document.querySelector('.milkdown .ProseMirror')).not.toBeNull()
    expect(document.querySelector('[data-drive-milkdown-renderer="true"] textarea')).toBeNull()
  })

  it('applies external Markdown with replaceAll without recreating the editor', async () => {
    const renderer = renderRenderer({ preview: preview('# First'), editContext: editContext() })
    await waitForEditor()
    const editor = document.querySelector('.milkdown .ProseMirror')

    renderer.rerender({
      preview: preview('# Server'),
      edit: { ...editable(), currentVersionId: 'version-2' },
    })
    await waitForEditor()

    expect(document.querySelector('.milkdown .ProseMirror')).toBe(editor)
    expect(editor?.textContent).toContain('Server')
    expect(editor?.textContent).not.toContain('First')
  })

  it('updates readonly state and destroys Crepe during cleanup', async () => {
    const builderPrototype = Object.getPrototypeOf(Crepe.prototype) as object
    const editorDescriptor = Object.getOwnPropertyDescriptor(builderPrototype, 'editor')
    if (!editorDescriptor?.get) throw new Error('Expected Crepe editor getter')
    const wrapped = new WeakSet<object>()
    let destroyCalls = 0
    vi.spyOn(builderPrototype, 'editor', 'get').mockImplementation(function (this: Crepe) {
      if (!wrapped.has(this)) {
        wrapped.add(this)
        const destroy = this.destroy
        this.destroy = async () => {
          destroyCalls += 1
          return await destroy()
        }
      }
      return editorDescriptor.get?.call(this)
    })
    const renderer = renderRenderer({ preview: preview('# Notes'), editContext: editContext() })
    await waitForEditor()
    const editor = document.querySelector<HTMLElement>('.milkdown .ProseMirror')
    expect(editor?.getAttribute('contenteditable')).toBe('true')

    renderer.rerender({ edit: null })
    await act(async () => Promise.resolve())
    expect(editor?.getAttribute('contenteditable')).toBe('false')

    await renderer.unmount()
    expect(destroyCalls).toBe(1)
  })

  it('keeps the lazy code block placeholder consistent with editor typography', () => {
    const styles = readFileSync('src/styles/index.css', 'utf8')

    expect(styles).toMatch(/\.drive-milkdown-editor \.milkdown \.milkdown-code-block-placeholder code\s*{[^}]*color: var\(--muted-foreground\);[^}]*display: block;[^}]*font-size: inherit;[^}]*line-height: inherit;/s)
  })

  it('proxies relative image previews without changing the Markdown source', async () => {
    const markdown = '![diagram](./images/diagram.png)'
    renderRenderer({
      preview: {
        ...preview(markdown),
        relativeImages: [{ src: './images/diagram.png', resolvedUrl: '/api/drive/items/file/relative-image?path=diagram.png' }],
      },
      editContext: editContext(),
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(document.querySelector('.milkdown img')?.getAttribute('src')).toBe('/api/drive/items/file/relative-image?path=diagram.png')
  })

  it('uploads mixed clipboard images through the hosted document image API', async () => {
    const file = new File(['image'], 'chart.png', { type: 'image/png' })
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(hostedImage())
    renderRenderer({
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [
          { type: 'image/png', getAsFile: () => file },
          { type: 'text/plain', getAsFile: () => null },
        ],
      },
    })
    await act(async () => {
      document.querySelector('[data-drive-milkdown-renderer="true"]')?.dispatchEvent(event)
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(upload).toHaveBeenCalledWith(
      file,
      { kind: 'owner', itemId: 'file' },
      { name: 'chart.png', mimeType: 'image/png' }
    )
    expect(document.querySelector('.milkdown img')?.getAttribute('src')).toBe(hostedImage().url)
  })

  it('keeps source content unchanged and reports hosted image upload failures', async () => {
    const source = '[docs]: /guide\n\nBody'
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockRejectedValue(new Error('上传服务不可用。'))
    renderRenderer({
      preview: preview(source),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))

    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(source)
    expect(document.body.textContent).toContain('上传服务不可用。')
  })

  it('infers an image MIME type from its extension when the browser leaves it empty', async () => {
    const file = new File(['image'], 'camera.jpg', { type: '' })
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(hostedImage())
    renderRenderer({
      preview: preview('[docs]: /guide\n\nBody'),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })

    await selectImage(file)

    expect(upload).toHaveBeenCalledWith(
      file,
      { kind: 'owner', itemId: 'file' },
      { name: 'camera.jpg', mimeType: 'image/jpeg' },
    )
  })

  it('blocks saving while a source image upload is pending', async () => {
    let resolveUpload!: (image: DriveHostedDocumentImageDto) => void
    const uploadPromise = new Promise<DriveHostedDocumentImageDto>((resolve) => {
      resolveUpload = resolve
    })
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockReturnValue(uploadPromise)
    const context = editContext()
    renderRenderer({
      preview: preview('[docs]: /guide\n\nBody'),
      editContext: context,
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    await inputTextarea(textarea, `${textarea.value}\nLocal`)

    await selectImage(new File(['image'], 'chart.png', { type: 'image/png' }))
    await pressSaveShortcut()
    expect(context.saveText).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpload(hostedImage())
      await uploadPromise
      await Promise.resolve()
    })
    await pressSaveShortcut()
    expect(context.saveText).toHaveBeenCalledWith({
      text: `[docs]: /guide\n\nBody\nLocal![chart](${hostedImage().url})`,
      baseVersionId: 'version-1',
    })
  })
})

type RenderRendererOptions = {
  readonly current?: DriveBrowserItemDto
  readonly preview?: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: React.ComponentProps<typeof DriveMilkdownRenderer>['editContext']
  readonly imageUploadContext?: React.ComponentProps<typeof DriveMilkdownRenderer>['imageUploadContext']
}

function renderRenderer({
  current: nextCurrent = current(),
  preview: nextPreview = preview('# Notes'),
  edit = editable(),
  editContext,
  imageUploadContext,
}: RenderRendererOptions) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const render = (options: Required<Pick<RenderRendererOptions, 'current' | 'preview'>> & RenderRendererOptions) => act(() => {
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <DriveMilkdownRenderer
          current={options.current}
          preview={options.preview}
          edit={options.edit}
          editContext={options.editContext}
          imageUploadContext={options.imageUploadContext}
        />
      </QueryClientProvider>
    )
  })
  let options = { current: nextCurrent, preview: nextPreview, edit, editContext, imageUploadContext }
  render(options)
  return {
    rerender(next: RenderRendererOptions) {
      options = { ...options, ...next }
      render(options)
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
    name: 'notes.md',
    type: 'file',
    size: '12',
    mimeType: 'text/markdown',
    updatedAt: '2026-09-08T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/console/drive/items/file',
    downloadUrl: '/api/drive/items/file/content',
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

function hostedImage(): DriveHostedDocumentImageDto {
  return {
    imageId: 'img_00000000000000000000000000000000',
    name: 'chart.png',
    size: '5',
    mimeType: 'image/png',
    url: '/object/img_00000000000000000000000000000000',
  }
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

async function selectImage(file: File): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('Expected image file input')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => window.setTimeout(resolve, 20))
  })
}

async function waitForEditor(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 20))
  })
}
