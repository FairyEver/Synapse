// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { createDriveEditorTextModel, MILKDOWN_COMMENT_IGNORED_SELECTOR } from './drive-editor-comment-geometry'
import { configureMilkdownCommonMarkImages } from './milkdown-commonmark-images'
import { preserveMilkdownCommonMarkAutolinks, requiresMilkdownSourceMode } from './milkdown-renderer'

let root: HTMLDivElement | null = null
let crepe: Crepe | null = null

beforeEach(() => {
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
  vi.stubGlobal('IntersectionObserver', class IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]
    private readonly callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }

    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this)
    }

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
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(async () => {
  await crepe?.destroy()
  root?.remove()
  crepe = null
  root = null
  vi.unstubAllGlobals()
})

describe('Milkdown Markdown round trip', () => {
  it('routes reference definitions away from Crepe before it can normalize them', () => {
    const source = [
      'Read [the docs][docs].',
      '',
      '[docs]: /guide "Guide title"',
      '[unused]: /keep-this-definition',
    ].join('\n')

    expect(requiresMilkdownSourceMode(source)).toBe(true)
  })

  it('restores bare URI and email text without changing explicit autolinks or code', async () => {
    const source = [
      'See https://example.com now',
      'Email test@example.com',
      'Keep <https://explicit.example/path>',
      '',
      '`https://inline.example test@example.com`',
      '',
      '```md',
      'https://fenced.example test@example.com',
      '```',
    ].join('\n')
    crepe = new Crepe({ root, defaultValue: source, features: disabledVisualFeatures() })
    await crepe.create()

    const serialized = crepe.getMarkdown()
    expect(serialized).toContain('<https://example.com>')
    expect(serialized).toContain('<test@example.com>')
    expect(withoutOptionalFinalNewline(preserveMilkdownCommonMarkAutolinks(serialized, source))).toBe([
      'See https://example.com now',
      'Email test@example.com',
      'Keep <https://explicit.example/path>',
      '',
      '`https://inline.example test@example.com`',
      '',
      '```md',
      'https://fenced.example test@example.com',
      '```',
    ].join('\n'))
  })

  it('does not rewrite a duplicate explicit autolink after the matching bare URI is deleted', () => {
    const source = [
      'Same https://example.com',
      'Same <https://example.com>',
    ].join('\n')

    expect(preserveMilkdownCommonMarkAutolinks([
      'Same <https://example.com>',
      'Same <https://example.com>',
    ].join('\n'), source)).toBe(source)
    expect(preserveMilkdownCommonMarkAutolinks('Same <https://example.com>\n', source)).toBe(
      'Same <https://example.com>\n',
    )
  })

  it('restores a unique bare URI when other text on the same line changes', () => {
    expect(preserveMilkdownCommonMarkAutolinks(
      'See <https://example.com> later\n',
      'See https://example.com now',
    )).toBe('See https://example.com later\n')
  })

  it('preserves the supported CommonMark and GFM document structures', async () => {
    const source = [
      '# 标题',
      '',
      '3. third',
      '4. fourth',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| 中文 | 1 |',
      '',
      '> quote',
      '',
      '```ts',
      'const value = "😀"',
      '```',
      '',
      '<span data-kind="note">raw</span>',
      '',
      '<!-- keep this comment -->',
      '',
      '![image](./image.png)',
    ].join('\n')

    crepe = new Crepe({ root, defaultValue: source, features: disabledVisualFeatures() })
    await crepe.create()
    const before = getDocumentJson(crepe)
    const result = crepe.getMarkdown()
    const after = await parseDocumentJson(result)

    expect(after).toEqual(before)
  })

  it('round-trips escaped brackets and backslashes in image alt text', async () => {
    const source = '![a\\[b\\]\\\\c](./image.png)'
    crepe = new Crepe({ root, defaultValue: source, features: disabledVisualFeatures() })
    await crepe.create()

    expect(root?.querySelector('img')?.getAttribute('alt')).toBe('a[b]\\c')
    expect(withoutOptionalFinalNewline(crepe.getMarkdown())).toBe('![a\\[b\\]\\c](./image.png)')
  })

  it('keeps the comment text stream aligned across rich Markdown structures', async () => {
    const source = [
      '# Heading',
      '',
      'Before **bold🙂**',
      '',
      '3. ordered',
      '4. second',
      '',
      '- parent',
      '  1. nested',
      '',
      '- loose first',
      '',
      '  loose second',
      '',
      'List separator',
      '',
      '- [x] task',
      '',
      '> quote',
      '',
      '| Head | Value |',
      '| --- | --- |',
      '| Cell | End |',
      '',
      '```ts',
      'const value = "😀"',
      'return value',
      '```',
      '',
      'Escaped \\*plain\\* &amp; [link](https://example.com) ~~gone~~',
      '',
      '---',
      '',
      'Before image ![inline](inline.png) after.',
      '',
      '![block](block.png "Caption")',
      '',
      'Before break  ',
      'After break',
      '',
      'Formula $x + 1$ end',
      '',
      '<span data-kind="note">raw html</span>',
      '',
      '<!-- hidden comment -->',
      '',
      '<div>',
      'raw block html',
      '</div>',
      '',
      'After',
    ].join('\n')

    crepe = new Crepe({
      root,
      defaultValue: source,
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.TopBar]: false,
      },
    })
    const upload = vi.fn(async () => '/uploaded.png')
    configureMilkdownCommonMarkImages(crepe, {
      altText: (file) => file.name,
      confirmButton: 'Confirm',
      onUpload: upload,
      proxyDomURL: (url) => url,
      uploadButton: 'Upload',
      uploadPlaceholderText: 'Paste image URL',
    })
    await crepe.create()

    const content = root?.querySelector<HTMLElement>('.ProseMirror')
    if (!content) throw new Error('Milkdown did not render the content editable')
    const model = createDriveEditorTextModel(content, MILKDOWN_COMMENT_IGNORED_SELECTOR)

    expect(model.text).toBe('HeadingBefore bold🙂orderedsecondparentnestedloose firstloose secondList separatortaskquoteHeadValueCellEndconst value = "😀"\nreturn valueEscaped *plain* & link goneBefore image inline after.blockBefore break\nAfter breakFormula $x + 1$ endraw htmlAfter')
    const serialized = crepe.getMarkdown()
    expect(await parseDocumentJson(serialized)).toEqual(getDocumentJson(crepe))

    const file = new File(['image'], 'new-image.png', { type: 'image/png' })
    const fileList = Object.assign([file], { item: (index: number) => index === 0 ? file : null }) as unknown as FileList
    const uploadedNodes = await crepe.editor.action((ctx) => ctx.get(uploadConfig.key).uploader(
      fileList,
      ctx.get(schemaCtx),
      ctx,
      0,
    ))
    if (!Array.isArray(uploadedNodes)) throw new Error('Expected uploaded image nodes')
    expect(upload).toHaveBeenCalledWith(file)
    expect(uploadedNodes[0]?.attrs).toMatchObject({ alt: 'new-image.png', src: '/uploaded.png' })
  })

  it('passes extension-identifiable images with an empty MIME type to the shared uploader', async () => {
    crepe = new Crepe({ root, defaultValue: '', features: disabledVisualFeatures() })
    const upload = vi.fn(async () => '/object/image')
    configureMilkdownCommonMarkImages(crepe, {
      altText: (file) => file.name,
      confirmButton: 'Confirm',
      onUpload: upload,
      proxyDomURL: (url) => url,
      uploadButton: 'Upload',
      uploadPlaceholderText: 'Paste image URL',
    })
    await crepe.create()

    const file = new File(['image'], 'camera.jpg', { type: '' })
    const fileList = Object.assign([file], { item: (index: number) => index === 0 ? file : null }) as unknown as FileList
    const uploadedNodes = await crepe.editor.action((ctx) => ctx.get(uploadConfig.key).uploader(
      fileList,
      ctx.get(schemaCtx),
      ctx,
      0,
    ))

    expect(upload).toHaveBeenCalledWith(file)
    expect(uploadedNodes).toHaveLength(1)
  })

  it('keeps successful image nodes when a concurrent upload fails', async () => {
    crepe = new Crepe({ root, defaultValue: '', features: disabledVisualFeatures() })
    const pendingUploads = new Map<string, {
      reject: (reason?: unknown) => void
      resolve: (url: string) => void
    }>()
    const upload = vi.fn((file: File) => new Promise<string>((resolve, reject) => {
      pendingUploads.set(file.name, { reject, resolve })
    }))
    configureCommonMarkImageUploads(crepe, upload)
    await crepe.create()

    const firstFile = new File(['first'], 'first.png', { type: 'image/png' })
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' })
    const fileList = createFileList(firstFile, secondFile)
    const uploadedNodesPromise = uploadImageNodes(crepe, fileList)

    expect(upload).toHaveBeenCalledTimes(2)
    pendingUploads.get('second.png')?.resolve('/object/second')
    pendingUploads.get('first.png')?.reject(new Error('upload failed'))

    const uploadedNodes = await uploadedNodesPromise
    expect(uploadedNodes).toHaveLength(1)
    expect(uploadedNodes[0]?.attrs).toMatchObject({
      alt: 'second.png',
      src: '/object/second',
      title: '',
    })
  })

  it('returns no image nodes when every concurrent upload fails', async () => {
    crepe = new Crepe({ root, defaultValue: '', features: disabledVisualFeatures() })
    const upload = vi.fn(async (file: File) => {
      throw new Error(`Failed to upload ${file.name}`)
    })
    configureCommonMarkImageUploads(crepe, upload)
    await crepe.create()

    const firstFile = new File(['first'], 'first.png', { type: 'image/png' })
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' })
    const fileList = createFileList(firstFile, secondFile)
    const uploadedNodes = await uploadImageNodes(crepe, fileList)

    expect(upload).toHaveBeenCalledTimes(2)
    expect(uploadedNodes).toEqual([])
  })

  it('keeps uploaded image nodes in file order when uploads finish out of order', async () => {
    crepe = new Crepe({ root, defaultValue: '', features: disabledVisualFeatures() })
    const pendingUploads = new Map<string, (url: string) => void>()
    const upload = vi.fn((file: File) => new Promise<string>((resolve) => {
      pendingUploads.set(file.name, resolve)
    }))
    configureCommonMarkImageUploads(crepe, upload)
    await crepe.create()

    const firstFile = new File(['first'], 'first.png', { type: 'image/png' })
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' })
    const fileList = createFileList(firstFile, secondFile)
    const uploadedNodesPromise = uploadImageNodes(crepe, fileList)

    expect(upload).toHaveBeenCalledTimes(2)
    pendingUploads.get('second.png')?.('/object/second')
    pendingUploads.get('first.png')?.('/object/first')

    const uploadedNodes = await uploadedNodesPromise
    expect(uploadedNodes.map((node) => node.attrs.src)).toEqual(['/object/first', '/object/second'])
  })
})

function configureCommonMarkImageUploads(
  targetCrepe: Crepe,
  onUpload: (file: File) => Promise<string>,
): void {
  configureMilkdownCommonMarkImages(targetCrepe, {
    altText: (file) => file.name,
    confirmButton: 'Confirm',
    onUpload,
    proxyDomURL: (url) => url,
    uploadButton: 'Upload',
    uploadPlaceholderText: 'Paste image URL',
  })
}

function createFileList(...files: File[]): FileList {
  return Object.assign(files, {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList
}

async function uploadImageNodes(targetCrepe: Crepe, files: FileList) {
  const uploadedNodes = await targetCrepe.editor.action((ctx) => ctx.get(uploadConfig.key).uploader(
    files,
    ctx.get(schemaCtx),
    ctx,
    0,
  ))
  if (!Array.isArray(uploadedNodes)) throw new Error('Expected uploaded image nodes')
  return uploadedNodes
}

function disabledVisualFeatures(): Partial<Record<CrepeFeature, boolean>> {
  return {
    [CrepeFeature.AI]: false,
    [CrepeFeature.BlockEdit]: false,
    [CrepeFeature.CodeMirror]: false,
    [CrepeFeature.Cursor]: false,
    [CrepeFeature.ImageBlock]: false,
    [CrepeFeature.Latex]: false,
    [CrepeFeature.LinkTooltip]: false,
    [CrepeFeature.ListItem]: false,
    [CrepeFeature.Placeholder]: false,
    [CrepeFeature.Table]: false,
    [CrepeFeature.Toolbar]: false,
    [CrepeFeature.TopBar]: false,
  }
}

function getDocumentJson(targetCrepe: Crepe): unknown {
  return targetCrepe.editor.action((ctx) => ctx.get(editorViewCtx).state.doc.toJSON())
}

async function parseDocumentJson(markdown: string): Promise<unknown> {
  const parserRoot = document.createElement('div')
  document.body.append(parserRoot)
  const parser = new Crepe({ root: parserRoot, defaultValue: markdown, features: disabledVisualFeatures() })
  try {
    await parser.create()
    return getDocumentJson(parser)
  } finally {
    await parser.destroy()
    parserRoot.remove()
  }
}

function withoutOptionalFinalNewline(markdown: string): string {
  return markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown
}
