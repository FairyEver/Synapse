import { resolveDriveAnnotationAnchor, sliceByCodePoints } from '@synapse/shared'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { renderDriveMarkdownFragment } from './drive-markdown-renderer'
import { driveMarkdownImageResourceKey, mapDriveMarkdownSourceRange, mapDriveMarkdownSourceRanges } from './drive-markdown-projection'

describe('Drive Markdown projection', () => {
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
    const paragraphCount = 4_000
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
    expect(elapsedMs).toBeLessThan(1_800)
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
