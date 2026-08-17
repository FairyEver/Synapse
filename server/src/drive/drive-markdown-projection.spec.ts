import { describe, expect, it } from 'vitest'
import { renderDriveMarkdownFragment } from './drive-markdown-renderer'
import { driveMarkdownImageResourceKey, mapDriveMarkdownSourceRange } from './drive-markdown-projection'

describe('Drive Markdown projection', () => {
  it('emits stable non-sensitive block and segment identifiers into sanitized HTML', async () => {
    const rendered = await renderDriveMarkdownFragment('# 标题\n\n正文 **重点** 🙂\n\n```ts\nconst value = 1\n```')

    expect(rendered.html).toContain('data-drive-markdown-block-id')
    expect(rendered.html).toContain('data-drive-markdown-segment-id')
    expect(rendered.html).not.toContain('source-start')
    expect(rendered.projection.blocks.some((block) => block.type === 'heading')).toBe(true)
    expect(rendered.projection.segments.some((segment) => segment.mapping === 'markdown_syntax')).toBe(true)
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
  })
})
