// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

describe('DriveMilkdownRenderer', () => {
  it('uses source fallback for YAML and TOML frontmatter without mistaking a thematic break for frontmatter', () => {
    expect(requiresMilkdownSourceMode('---\ntitle: Notes\n---\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('+++\ntitle = "Notes"\n+++\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('---\n"quoted key": Notes\n---\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('---\n- first\n- second\n---\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('---\n---\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('+++\n[table]\n+++\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('+++\n# comment\n\n+++\n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('\uFEFF  ---  \n# comment\n  ...  \n# Notes')).toBe(true)
    expect(requiresMilkdownSourceMode('\n---\ntitle: Notes\n---\n# Notes')).toBe(false)
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

  it.each([
    '> [unused]: /keep',
    '> > [unused]: /keep',
    '- > [unused]: /keep',
  ])('keeps container-nested link reference definitions byte-for-byte: %s', async (source) => {
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

    expect(requiresMilkdownSourceMode(source)).toBe(true)
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe(source)

    await inputTextarea(textarea, `${source}\n`)
    await pressSaveShortcut()

    expect(saveText).toHaveBeenCalledWith({
      text: `${source}\n`,
      baseVersionId: 'version-1',
    })
  })

  it.each([
    '> ```md\n> [docs]: /inside-code\n> ```',
    '- ```md\n  [docs]: /inside-code\n  ```',
  ])('does not mistake fenced container content for a link reference definition: %s', (source) => {
    expect(requiresMilkdownSourceMode(source)).toBe(false)
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
    ['a].png', `![a\\]](${hostedImage().url})`],
    ['a[.png', `![a\\[](${hostedImage().url})`],
    ['a\\b.png', `![a\\\\b](${hostedImage().url})`],
  ])('escapes the selected image alt text in source mode for %s', async (fileName, markdown) => {
    const source = '---\n---\n'
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(hostedImage())
    renderRenderer({
      preview: preview(source),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    textarea.setSelectionRange(source.length, source.length)

    await selectImage(new File(['image'], fileName, { type: 'image/png' }))

    expect(textarea.value).toBe(`${source}${markdown}`)
  })

  it.each([
    ['image-only', false],
    ['mixed', true],
  ] as const)('uploads and inserts %s clipboard images in source mode', async (_label, mixed) => {
    const source = '[docs]: /guide\n\nBody'
    const file = new File(['image'], 'a].png', { type: 'image/png' })
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
    expect(textarea.value).toBe(`${source}![a\\]](${hostedImage().url})`)
  })

  it('uploads and inserts dropped images at the source textarea selection', async () => {
    const source = '[docs]: /guide\n\nBody'
    const file = new File(['image'], 'a\\b.png', { type: 'image/png' })
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
    expect(textarea.value).toBe(`${source.slice(0, insertionPoint)}![a\\\\b](${hostedImage().url})${source.slice(insertionPoint)}`)
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

  it('shows external Markdown updates in the existing editor', async () => {
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

  it('applies the latest confirmed version when it arrives before Crepe is ready', async () => {
    const renderer = renderRenderer({ preview: preview('# First'), editContext: editContext() })
    expect(document.querySelector('.milkdown .ProseMirror')).toBeNull()

    renderer.rerender({
      preview: preview('# Intermediate'),
      edit: { ...editable(), currentVersionId: 'version-2' },
    })
    expect(document.querySelector('.milkdown .ProseMirror')).toBeNull()
    renderer.rerender({
      preview: preview('# Latest'),
      edit: { ...editable(), currentVersionId: 'version-3' },
    })
    await waitForEditor()

    const editor = document.querySelector<HTMLElement>('.milkdown .ProseMirror')
    expect(editor?.textContent).toContain('Latest')
    expect(editor?.textContent).not.toContain('First')
  })

  it('updates readonly state and unmounts the editor cleanly', async () => {
    const renderer = renderRenderer({ preview: preview('# Notes'), editContext: editContext() })
    await waitForEditor()
    const editor = document.querySelector<HTMLElement>('.milkdown .ProseMirror')
    expect(editor?.getAttribute('contenteditable')).toBe('true')

    renderer.rerender({ edit: null })
    await act(async () => Promise.resolve())
    expect(editor?.getAttribute('contenteditable')).toBe('false')

    await renderer.unmount()
    expect(host?.querySelector('[data-drive-milkdown-renderer="true"]')).toBeNull()
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
    const file = new File(['image'], 'a].png', { type: 'image/png' })
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
      { name: 'a].png', mimeType: 'image/png' }
    )
    expect(document.querySelector('.milkdown img')?.getAttribute('src')).toBe(hostedImage().url)
    expect(document.querySelector('.milkdown img')?.getAttribute('alt')).toBe('a]')
  })

  it('keeps image-only clipboard alt text intact in rich mode', async () => {
    const file = new File(['image'], 'a]\\b.png', { type: 'image/png' })
    class TestClipboardEvent extends Event {}
    class TestDragEvent extends Event {}
    vi.stubGlobal('ClipboardEvent', TestClipboardEvent)
    vi.stubGlobal('DragEvent', TestDragEvent)
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockResolvedValue(hostedImage())
    renderRenderer({
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })
    await waitForEditor()

    const event = new TestClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [file],
        getData: () => '',
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    })
    await act(async () => {
      document.querySelector('.milkdown .ProseMirror')?.dispatchEvent(event)
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(document.querySelector('.milkdown img')?.getAttribute('alt')).toBe('a]\\b')
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

  it('inserts successful source images when another image in the batch fails', async () => {
    const source = '[docs]: /guide\n\nBody'
    const first = new File(['first'], 'first.png', { type: 'image/png' })
    const second = new File(['second'], 'second.png', { type: 'image/png' })
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockImplementation(async (file) => {
      if (file === second) throw new Error('第二张上传失败。')
      return hostedImage('/object/first')
    })
    renderRenderer({
      preview: preview(source),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    textarea.setSelectionRange(source.length, source.length)

    await pasteSourceImages([first, second])

    expect(textarea.value).toBe(`${source}![first](/object/first)`)
    expect(document.body.textContent).toContain('第二张上传失败。')
    expect(document.body.textContent).not.toContain('上传中')
  })

  it('uploads source images concurrently and inserts them in selection order', async () => {
    const source = '[docs]: /guide\n\nBody'
    const first = new File(['first'], 'first.png', { type: 'image/png' })
    const second = new File(['second'], 'second.png', { type: 'image/png' })
    const firstUpload = deferred<DriveHostedDocumentImageDto>()
    const secondUpload = deferred<DriveHostedDocumentImageDto>()
    const upload = vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockImplementation((file) => (
      file === first ? firstUpload.promise : secondUpload.promise
    ))
    renderRenderer({
      preview: preview(source),
      editContext: editContext(),
      imageUploadContext: { kind: 'owner', itemId: 'file' },
    })
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    textarea.setSelectionRange(source.length, source.length)

    dispatchSourceImages([first, second])
    await act(async () => { await Promise.resolve() })
    expect(upload).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('上传中')

    await act(async () => {
      secondUpload.resolve(hostedImage('/object/second'))
      await secondUpload.promise
    })
    expect(textarea.value).toBe(source)
    expect(document.body.textContent).toContain('上传中')

    await act(async () => {
      firstUpload.resolve(hostedImage('/object/first'))
      await firstUpload.promise
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(textarea.value).toBe(`${source}![first](/object/first)![second](/object/second)`)
    expect(document.body.textContent).not.toContain('上传中')
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

function hostedImage(url = '/object/img_00000000000000000000000000000000'): DriveHostedDocumentImageDto {
  return {
    imageId: 'img_00000000000000000000000000000000',
    name: 'chart.png',
    size: '5',
    mimeType: 'image/png',
    url,
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

async function pasteSourceImages(files: readonly File[]): Promise<void> {
  await act(async () => {
    dispatchSourceImages(files)
    await new Promise((resolve) => window.setTimeout(resolve, 20))
  })
}

function dispatchSourceImages(files: readonly File[]): void {
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { items: files.map((file) => ({ type: file.type, getAsFile: () => file })) },
  })
  textarea.dispatchEvent(event)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function waitForEditor(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 20))
  })
}
