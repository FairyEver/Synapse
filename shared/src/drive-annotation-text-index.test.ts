import { describe, expect, it } from 'vitest'
import { getDriveAnnotationTextIndex } from './drive-annotation-text-index.js'
import type { DriveMarkdownProjectionDto } from './drive.js'

describe('Drive annotation text index', () => {
  it('preserves code-point slicing, overlapping matches, and unpaired surrogates', () => {
    for (const text of ['a😀a😀aa', 'e\u0301中\r\n文', '\ud800a\udc00😀', '']) {
      const index = getDriveAnnotationTextIndex(text, null)
      const points = Array.from(text)
      expect(index.length).toBe(points.length)
      for (let start = -points.length - 1; start <= points.length + 1; start += 1) {
        for (let end = start; end <= points.length + 1; end += 1) {
          expect(index.slice(start, end)).toBe(points.slice(start, end).join(''))
        }
      }
      for (const exact of ['a', 'aa', '😀', '\ud800', '\udc00', 'e\u0301', '']) {
        const pattern = Array.from(exact)
        const expected = pattern.length ? points.flatMap((_, start) =>
          pattern.every((point, offset) => points[start + offset] === point)
            ? [{ start, end: start + pattern.length }] : []) : []
        expect(index.matches(exact)).toEqual(expected)
      }
    }
  })

  it('preserves the original first-block rule for overlapping and unsorted intervals', () => {
    const blocks = [
      { blockId: 'first', renderedStart: 2, renderedEnd: 8 },
      { blockId: 'parent', renderedStart: 0, renderedEnd: 12 },
      { blockId: 'nested', renderedStart: 3, renderedEnd: 5 },
      { blockId: 'last', renderedStart: 10, renderedEnd: 14 },
    ] as DriveMarkdownProjectionDto['blocks']
    const projection = { blocks } as DriveMarkdownProjectionDto
    const index = getDriveAnnotationTextIndex('abcdefghijklmn', projection)
    for (let start = 0; start < 15; start += 1) {
      for (let end = start; end < 16; end += 1) {
        expect(index.blockForRange({ start, end })).toBe(blocks.find((block) => block.renderedStart <= start && block.renderedEnd >= end))
      }
    }
    expect(index.blockById('nested')).toBe(blocks[2])
    expect(getDriveAnnotationTextIndex('abcdefghijklmn', projection)).toBe(index)
    expect(getDriveAnnotationTextIndex('changed', projection)).not.toBe(index)
  })
})
