import { describe, expect, it } from 'vitest'
import { renderDriveMarkdownFragment } from './drive-markdown-renderer'
import { mapDriveMarkdownSourceRange } from './drive-markdown-projection'

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

  it('maps source ranges through bounded Unicode-aware edits', () => {
    expect(mapDriveMarkdownSourceRange('aa目标🙂bb', '前缀aa目标🙂bb', { start: 2, end: 5 })).toEqual({ start: 4, end: 7 })
    expect(mapDriveMarkdownSourceRange('aa目标bb', 'aabb', { start: 2, end: 4 })).toEqual({ start: 2, end: 2 })
  })
})
