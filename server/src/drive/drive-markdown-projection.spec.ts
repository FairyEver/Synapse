import { resolveDriveAnnotationAnchor, sliceByCodePoints } from '@synapse/shared'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { renderDriveMarkdownFragment } from './drive-markdown-renderer'
import { buildDriveMarkdownProjection, driveMarkdownImageResourceKey, mapDriveMarkdownSourceRange, mapDriveMarkdownSourceRanges } from './drive-markdown-projection'

describe('Drive Markdown projection', () => {
  it('preserves overflow table cells and their text and image anchors while padding missing cells', async () => {
    const source = [
      '| 事项 | 结果 |',
      '| --- | --- |',
      '| 导入 | 失败 | 隐藏 **说明** ![隐藏图片](hidden.png) |',
      '| 完成 |',
      '',
      '任务目标 16（蓝）',
    ].join('\n')
    const rendered = await renderDriveMarkdownFragment(source)
    const paragraph = rendered.projection.blocks.find((block) => block.type === 'paragraph')

    expect(rendered.html).toContain('隐藏 <strong>说明</strong>')
    expect(rendered.html).toContain('alt="隐藏图片"')
    expect(rendered.html.match(/<th(?:\s|>)/gu)).toHaveLength(3)
    expect(rendered.html).toContain('<td>完成</td>\n<td></td>\n<td></td>')
    expect(rendered.renderedText).toBe('事项结果导入失败隐藏 说明 隐藏图片完成任务目标 16（蓝）')
    expect(rendered.projection.images).toEqual([expect.objectContaining({ source: 'hidden.png', alt: '隐藏图片' })])
    expect(paragraph).toMatchObject({ renderedStart: 20, renderedEnd: 30 })
    expect(rendered.projection.segments.at(-1)).toMatchObject({
      sourceStart: Array.from(source.slice(0, source.indexOf('任务目标'))).length,
      renderedStart: 20,
      renderedEnd: 30,
      mapping: 'identity',
    })
  })

  it.each([
    'remark15-gfm4-img1-html2-lf1',
    'remark15-gfm4-img1-html2-lf1-tbl1',
  ])('rebuilds a %s projection while preserving block identity and overflow table content', async (parserVersion) => {
    const source = '| 列 |\n| --- |\n| 值 | 隐藏内容 |\n\n目标'
    const [{ unified }, { default: remarkParse }, { default: remarkGfm }] = await Promise.all([
      import('unified'), import('remark-parse'), import('remark-gfm'),
    ])
    const tree = unified().use(remarkParse).use(remarkGfm).parse(source)
    const table = tree.children[0]
    if (parserVersion.endsWith('-tbl1') && table.type === 'table') {
      for (const row of table.children) row.children.splice(table.align?.length ?? 0)
    }
    const legacyProjection = {
      ...buildDriveMarkdownProjection(source, tree),
      parserVersion,
    }
    const paragraph = legacyProjection.blocks.find((block) => block.type === 'paragraph')!
    const rendered = await renderDriveMarkdownFragment(source, { projection: legacyProjection })

    expect(rendered.renderedText).toBe('列值隐藏内容目标')
    expect(rendered.html).toContain('隐藏内容')
    expect(rendered.projection.blocks.find((block) => block.type === 'paragraph')).toMatchObject({
      blockId: paragraph.blockId,
      renderedStart: 6,
      renderedEnd: 8,
    })
  })

  it('emits stable non-sensitive block and segment identifiers into sanitized HTML', async () => {
    const rendered = await renderDriveMarkdownFragment('# 标题\n\n正文 **重点** 🙂\n\n```ts\nconst value = 1\n```')

    expect(rendered.html).toContain('data-drive-markdown-block-id')
    expect(rendered.html).toContain('data-drive-markdown-segment-id')
    expect(rendered.html).not.toContain('source-start')
    expect(rendered.projection.blocks.some((block) => block.type === 'heading')).toBe(true)
    expect(rendered.projection.segments.some((segment) => segment.mapping === 'markdown_syntax')).toBe(true)
  })

  it('keeps nested list items addressable for comment anchors', async () => {
    const source = [
      '1. 一级有序项',
      '   - 二级无序项',
      '     1. 三级有序项',
    ].join('\n')
    const rendered = await renderDriveMarkdownFragment(source)
    const listBlocks = rendered.projection.blocks.filter((block) => block.type === 'list')
    const itemBlocks = rendered.projection.blocks.filter((block) => block.type === 'listItem')
    const exact = '三级有序项'
    const sourceStart = source.indexOf(exact)
    const renderedStart = rendered.renderedText.indexOf(exact)
    const targetBlock = itemBlocks.find((block) => (
      block.renderedStart <= renderedStart
      && block.renderedEnd >= renderedStart + exact.length
    ))
    if (!targetBlock) throw new Error('Missing nested list item projection')
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: sourceStart, end: sourceStart + exact.length },
        renderedPosition: { start: renderedStart, end: renderedStart + exact.length },
        semantic: {
          blockId: targetBlock.blockId,
          start: renderedStart,
          end: renderedStart + exact.length,
          headingPath: [],
        },
        quote: { exact, prefix: '二级无序项', suffix: '' },
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
    })

    expect(listBlocks).toHaveLength(3)
    expect(itemBlocks).toHaveLength(3)
    expect(itemBlocks.every((block) => block.parentBlockId !== null)).toBe(true)
    expect(rendered.html).toMatch(/<ol data-drive-markdown-block-id="[^"]+">[\s\S]*<ul data-drive-markdown-block-id="[^"]+">[\s\S]*<ol data-drive-markdown-block-id="[^"]+">/u)
    expect(rendered.html.match(/<li data-drive-markdown-block-id="[^"]+">/gu)).toHaveLength(3)
    expect(rendered.renderedText).toContain('一级有序项二级无序项三级有序项')
    expect(resolution).toMatchObject({
      positionStatus: 'attached',
      quoteStatus: 'exact',
      renderedRange: { start: renderedStart, end: renderedStart + exact.length },
    })
  })

  it('inherits an unchanged paragraph block id after content is inserted before it', async () => {
    const previousSource = '# 标题\n\n保留这一段。'
    const previous = await renderDriveMarkdownFragment(previousSource)
    const next = await renderDriveMarkdownFragment('新增内容。\n\n# 标题\n\n保留这一段。', {
      previousProjection: { source: previousSource, projection: previous.projection },
    })
    const previousParagraph = previous.projection.blocks.find((block) => block.type === 'paragraph')
    const nextParagraph = next.projection.blocks.find((block) => block.textFingerprint === previousParagraph?.textFingerprint)

    expect(nextParagraph?.blockId).toBe(previousParagraph?.blockId)
  })

  it('keeps block identity restoration bounded for long flat documents', async () => {
    const paragraphCount = 8_000
    const previousSource = Array.from({ length: paragraphCount }, (_, index) => (
      `## Heading ${index}\n\nParagraph ${index}.`
    )).join('\n\n')
    const previous = await renderDriveMarkdownFragment(previousSource)
    const startedAt = performance.now()
    const next = await renderDriveMarkdownFragment(`Inserted.\n\n${previousSource}`, {
      previousProjection: { source: previousSource, projection: previous.projection },
    })
    const elapsedMs = performance.now() - startedAt
    const previousIds = new Set(previous.projection.blocks.map((block) => block.blockId))
    const retainedCount = next.projection.blocks.filter((block) => previousIds.has(block.blockId)).length

    expect(retainedCount).toBe(previous.projection.blocks.length)
    expect(elapsedMs).toBeLessThan(6_000)
  }, 15_000)

  it('uses Unicode code point offsets for CJK, emoji and combining text', async () => {
    const rendered = await renderDriveMarkdownFragment('甲🙂e\u0301乙')
    const block = rendered.projection.blocks.find((candidate) => candidate.type === 'paragraph')

    expect(block?.renderedEnd).toBe(5)
    expect(block?.sourceEnd).toBe(5)
  })

  it('includes image alternatives and hard breaks in rendered text', async () => {
    const rendered = await renderDriveMarkdownFragment('前 ![图标](logo.png) 后  \n下一行')

    expect(rendered.renderedText).toBe('前 图标 后\n下一行')
  })

  it.each(['\n', '\r\n', '\r'])('keeps comment offsets after fenced code with %j line endings', async (newline) => {
    const source = ['```mermaid', 'flowchart TD', 'A --> B', '```', '', '正文：组织'].join(newline)
    const rendered = await renderDriveMarkdownFragment(source)
    const sourceStart = source.indexOf('组织')
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: sourceStart, end: sourceStart + 2 },
        renderedPosition: { start: 24, end: 26 },
        quote: { exact: '组织', prefix: '正文：', suffix: '' },
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
      crdtSourceRange: { start: sourceStart, end: sourceStart + 2 },
    })

    expect(rendered.renderedText).toBe('flowchart TD\nA --> B正文：组织')
    expect(rendered.projection.blocks.find((block) => block.type === 'paragraph')).toMatchObject({
      renderedStart: 20,
      renderedEnd: 25,
    })
    expect(resolution).toMatchObject({
      positionStatus: 'attached',
      quoteStatus: 'exact',
      sourceRange: { start: sourceStart, end: sourceStart + 2 },
      renderedRange: { start: 23, end: 25 },
    })
  })

  it('normalizes soft line endings without rewriting source offsets', async () => {
    const source = '前文\r\n后文\r\n\r\n组织'
    const rendered = await renderDriveMarkdownFragment(source)

    expect(rendered.renderedText).toBe('前文\n后文组织')
    expect(rendered.projection.segments.at(-1)).toMatchObject({
      sourceStart: 10,
      sourceEnd: 12,
      renderedStart: 5,
      renderedEnd: 7,
      mapping: 'identity',
    })
    expect(rendered.projection.segments.slice(0, 3)).toMatchObject([
      { sourceStart: 0, sourceEnd: 2, renderedStart: 0, renderedEnd: 2, mapping: 'identity' },
      { sourceStart: 2, sourceEnd: 4, renderedStart: 2, renderedEnd: 3, mapping: 'generated' },
      { sourceStart: 4, sourceEnd: 6, renderedStart: 3, renderedEnd: 5, mapping: 'identity' },
    ])
  })

  it.each([
    { origin: 'authored', start: 4, end: 6 },
    { origin: 'browser', start: 3, end: 5 },
  ])('preserves old $origin semantic comments inside CRLF code blocks', async ({ start, end }) => {
    const source = ['```text', '前文', '后文文', '```'].join('\r\n')
    const rendered = await renderDriveMarkdownFragment(source)
    const block = rendered.projection.blocks[0]
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: 0, end: source.length },
        renderedPosition: { start, end },
        semantic: { blockId: block.blockId, start, end },
        quote: { exact: '后文', prefix: '', suffix: '' },
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
    })

    expect(resolution).toMatchObject({
      positionStatus: 'attached',
      quoteStatus: 'exact',
      renderedRange: { start: 3, end: 5 },
    })
  })

  it('refuses ambiguous old semantic coordinates when both newline interpretations match', async () => {
    const source = ['```text', 'ab', 'aaa', '```'].join('\r\n')
    const rendered = await renderDriveMarkdownFragment(source)
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: 0, end: source.length },
        renderedPosition: { start: 4, end: 6 },
        semantic: { blockId: rendered.projection.blocks[0].blockId, start: 4, end: 6 },
        quote: { exact: 'aa', prefix: '', suffix: '' },
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
    })

    expect(resolution).toMatchObject({ positionStatus: 'ambiguous', renderedRange: null })
  })

  it('compares old multiline quotes in browser line endings without changing stored evidence', async () => {
    const source = ['```text', '前文', '后文', '```'].join('\r\n')
    const rendered = await renderDriveMarkdownFragment(source)
    const quote = { exact: '前文\r\n后文', prefix: '', suffix: '' }
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: 0, end: source.length },
        semantic: { blockId: rendered.projection.blocks[0].blockId, start: 0, end: 6 },
        quote,
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
    })

    expect(resolution).toMatchObject({ positionStatus: 'attached', quoteStatus: 'exact', renderedRange: { start: 0, end: 5 } })
    expect(quote.exact).toBe('前文\r\n后文')
  })

  it('keeps normalized semantic comments attached after the quoted code is modified', async () => {
    const source = ['```text', '前文', '新版文', '```'].join('\r\n')
    const rendered = await renderDriveMarkdownFragment(source)
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        renderedTextNormalized: true,
        position: { start: 0, end: source.length },
        semantic: { blockId: rendered.projection.blocks[0].blockId, start: 3, end: 5 },
        quote: { exact: '旧版', prefix: '', suffix: '' },
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
    })

    expect(resolution).toMatchObject({ positionStatus: 'attached', quoteStatus: 'modified', renderedRange: { start: 3, end: 5 } })
  })

  it('keeps text anchors aligned after escaped raw HTML', async () => {
    const source = '前文<u>g</u>后文唯一评论文本。'
    const quote = '后文唯一评论文本。'
    const rendered = await renderDriveMarkdownFragment(source)
    const paragraph = rendered.projection.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph) throw new Error('Missing paragraph projection')
    const renderedStart = Array.from('前文<u>g</u>').length
    const renderedEnd = renderedStart + Array.from(quote).length
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: renderedStart, end: renderedEnd },
        renderedPosition: { start: renderedStart, end: renderedEnd },
        semantic: {
          blockId: paragraph.blockId,
          start: renderedStart,
          end: renderedEnd,
          headingPath: [],
        },
        quote: { exact: quote, prefix: '<u>g</u>', suffix: '' },
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
    })

    expect(rendered.html).toContain('前文&#x3C;u>g&#x3C;/u>后文唯一评论文本。')
    expect(rendered.renderedText).toBe(source)
    expect(sliceByCodePoints(rendered.renderedText, renderedStart, renderedEnd)).toBe(quote)
    expect(resolution).toMatchObject({
      positionStatus: 'attached',
      quoteStatus: 'exact',
      renderedRange: { start: renderedStart, end: renderedEnd },
    })
  })

  it('keeps text anchors aligned after escaped raw HTML blocks', async () => {
    const source = '<div onclick="run()">块内容</div>\n\n后文唯一评论文本。'
    const quote = '后文唯一评论文本。'
    const rendered = await renderDriveMarkdownFragment(source)
    const paragraph = rendered.projection.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph) throw new Error('Missing paragraph projection')
    const escapedBlock = '<div>块内容</div>'
    const renderedStart = Array.from(escapedBlock).length
    const renderedEnd = renderedStart + Array.from(quote).length
    const sourceStart = Array.from(source.slice(0, source.indexOf(quote))).length
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: sourceStart, end: sourceStart + Array.from(quote).length },
        renderedPosition: { start: renderedStart, end: renderedEnd },
        semantic: {
          blockId: paragraph.blockId,
          start: renderedStart,
          end: renderedEnd,
          headingPath: [],
        },
        quote: { exact: quote, prefix: escapedBlock, suffix: '' },
      },
      projection: rendered.projection,
      sourceText: source,
      renderedText: rendered.renderedText,
    })

    expect(rendered.html).toContain('&#x3C;div>块内容&#x3C;/div>')
    expect(rendered.renderedText).toBe(`${escapedBlock}${quote}`)
    expect(rendered.projection.blocks.some((block) => block.type === 'html')).toBe(true)
    expect(paragraph).toMatchObject({ renderedStart, renderedEnd })
    expect(sliceByCodePoints(rendered.renderedText, renderedStart, renderedEnd)).toBe(quote)
    expect(resolution).toMatchObject({
      positionStatus: 'attached',
      quoteStatus: 'exact',
      renderedRange: { start: renderedStart, end: renderedEnd },
    })
  })

  it('keeps text anchors aligned after a reference image alternative', async () => {
    const quote = '后文唯一评论文本。'
    const rendered = await renderDriveMarkdownFragment([
      '前文 ![图示][asset] 后文唯一评论文本。',
      '',
      '[asset]: https://example.com/a.png',
    ].join('\n'))
    const paragraph = rendered.projection.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph) throw new Error('Missing paragraph projection')
    const renderedStart = 6
    const renderedEnd = renderedStart + Array.from(quote).length
    const resolution = resolveDriveAnnotationAnchor({
      selectors: {
        schemaVersion: 2,
        position: { start: 18, end: 27 },
        renderedPosition: { start: renderedStart, end: renderedEnd },
        semantic: {
          blockId: paragraph.blockId,
          start: renderedStart,
          end: renderedEnd,
          headingPath: [],
        },
        quote: { exact: quote, prefix: '图示 ', suffix: '' },
      },
      projection: rendered.projection,
      sourceText: '前文 ![图示][asset] 后文唯一评论文本。\n\n[asset]: https://example.com/a.png',
      renderedText: rendered.renderedText,
    })

    expect(rendered.renderedText).toBe('前文 图示 后文唯一评论文本。')
    expect(resolution).toMatchObject({
      positionStatus: 'attached',
      quoteStatus: 'exact',
      renderedRange: { start: renderedStart, end: renderedEnd },
    })
    expect(sliceByCodePoints(rendered.renderedText, renderedStart, renderedEnd)).toBe(quote)
  })

  it('projects inline, reference, empty-alt and standalone raw images', async () => {
    const rendered = await renderDriveMarkdownFragment([
      '![内联](./images/a.png "标题")',
      '',
      '![][ref]',
      '',
      '<img src="broken.png" alt="" title="Raw">',
      '',
      '[ref]: /files/asset_123?version=2#preview "引用标题"',
    ].join('\n'), { allowStandaloneRawImages: true })

    expect(rendered.projection.imageAnchorsVersion).toBe(1)
    expect(rendered.projection.images).toHaveLength(3)
    expect(rendered.projection.images?.map((image) => image.documentIndex)).toEqual([0, 1, 2])
    expect(rendered.projection.images?.[0]).toMatchObject({ source: './images/a.png', alt: '内联', title: '标题' })
    expect(rendered.projection.images?.[1]).toMatchObject({ source: '/files/asset_123?version=2#preview', alt: '', title: '引用标题' })
    expect(rendered.projection.images?.[2]).toMatchObject({ source: 'broken.png', alt: '', title: 'Raw' })
    expect(rendered.html.match(/data-drive-markdown-image-id/g)).toHaveLength(3)
  })

  it('keeps image identity for metadata edits and changes it for resource replacement', async () => {
    const firstSource = '![旧说明](https://EXAMPLE.com/a.png?version=1#top "旧标题")'
    const first = await renderDriveMarkdownFragment(firstSource)
    const metadataOnly = await renderDriveMarkdownFragment('![新说明](https://example.com/a.png?version=1#top "新标题")', {
      previousProjection: { source: firstSource, projection: first.projection },
    })
    const replacement = await renderDriveMarkdownFragment('![新说明](https://example.com/b.png?version=1#top "新标题")', {
      previousProjection: { source: firstSource, projection: first.projection },
    })

    expect(metadataOnly.projection.images?.[0]?.imageId).toBe(first.projection.images?.[0]?.imageId)
    expect(replacement.projection.images?.[0]?.imageId).not.toBe(first.projection.images?.[0]?.imageId)
  })

  it('upgrades an old projection while retaining its inherited block ids', async () => {
    const source = '# 标题\n\n![架构图](./architecture.png)'
    const current = await renderDriveMarkdownFragment(source)
    const { images: _images, imageAnchorsVersion: _imageAnchorsVersion, ...legacyProjection } = current.projection
    const upgraded = await renderDriveMarkdownFragment(source, {
      previousProjection: { source, projection: legacyProjection },
    })

    expect(upgraded.projection.blocks.map((block) => block.blockId))
      .toEqual(current.projection.blocks.map((block) => block.blockId))
    expect(upgraded.projection.imageAnchorsVersion).toBe(1)
    expect(upgraded.projection.images).toHaveLength(1)
  })

  it('normalizes file assets independently from query and fragment while hashing data urls', () => {
    expect(driveMarkdownImageResourceKey('/files/asset_123?v=1#one')).toBe('file:asset_123')
    expect(driveMarkdownImageResourceKey('/files/asset_123?v=2#two')).toBe('file:asset_123')
    expect(driveMarkdownImageResourceKey('/files/asset_123/extra')).toBe('opaque:/files/asset_123/extra')
    expect(driveMarkdownImageResourceKey('/object/hosted_123?v=1')).toBe('object:hosted_123')
    expect(driveMarkdownImageResourceKey('/object/hosted_123/extra')).toBe('opaque:/object/hosted_123/extra')
    expect(driveMarkdownImageResourceKey('data:image/png;base64,abc')).toMatch(/^data:[a-f0-9]{64}$/u)
    expect(driveMarkdownImageResourceKey('https://EXAMPLE.com/a.png?q=1#x')).toBe('https://example.com/a.png?q=1#x')
  })

  it('maps source ranges through bounded Unicode-aware edits', () => {
    expect(mapDriveMarkdownSourceRange('aa目标🙂bb', '前缀aa目标🙂bb', { start: 2, end: 5 })).toEqual({ start: 4, end: 7 })
    expect(mapDriveMarkdownSourceRange('aa目标bb', 'aabb', { start: 2, end: 4 })).toEqual({ start: 2, end: 2 })
    expect(mapDriveMarkdownSourceRanges('aa目标bb尾部', '前缀aa全新目标bb尾部', [
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ])).toEqual([
      { start: 4, end: 8 },
      { start: 10, end: 12 },
    ])
  })
})
