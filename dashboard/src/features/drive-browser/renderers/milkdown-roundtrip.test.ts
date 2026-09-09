// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { schemaCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { createMdxEditorTextModel, MILKDOWN_COMMENT_IGNORED_SELECTOR } from './mdxeditor-comment-geometry'
import { configureMilkdownCommonMarkImages } from './milkdown-commonmark-images'
import { requiresMilkdownSourceMode } from './milkdown-renderer'

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
    const result = crepe.getMarkdown()

    expect(result).toContain('# 标题')
    expect(result).toContain('3. third')
    expect(result).toMatch(/^[*-] \[x\] done$/mu)
    expect(result).toContain('| Name')
    expect(result).toContain('const value = "😀"')
    expect(result).toContain('<span data-kind="note">raw</span>')
    expect(result).toContain('<!-- keep this comment -->')
    expect(result).toContain('![image](./image.png)')
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
    const model = createMdxEditorTextModel(content, MILKDOWN_COMMENT_IGNORED_SELECTOR)

    expect(model.text).toBe('HeadingBefore bold🙂orderedsecondparentnestedloose firstloose secondList separatortaskquoteHeadValueCellEndconst value = "😀"\nreturn valueEscaped *plain* & link goneBefore image inline after.blockBefore break\nAfter breakFormula $x + 1$ endraw htmlAfter')
    expect(crepe.getMarkdown()).toContain('![block](block.png "Caption")')

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
})

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
