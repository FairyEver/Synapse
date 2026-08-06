import { describe, expect, it } from 'vitest'
import { resolveDriveAnnotationAnchor, sliceByCodePoints } from './drive-annotation-anchor.js'
import type { DriveAnnotationSelectorsV2, DriveMarkdownProjectionDto } from './drive.js'

describe('resolveDriveAnnotationAnchor', () => {
  it('reattaches a unique quote after text is inserted before it', () => {
    const text = '前置内容目标文字后置内容'
    const result = resolveDriveAnnotationAnchor({
      selectors: selectors('目标文字', 0, 4),
      projection: projection(text),
      sourceText: text,
      renderedText: text,
    })

    expect(result.positionStatus).toBe('attached')
    expect(result.quoteStatus).toBe('exact')
    expect(result.renderedRange && sliceByCodePoints(text, result.renderedRange.start, result.renderedRange.end)).toBe('目标文字')
  })

  it('refuses to choose between indistinguishable duplicate quotes', () => {
    const text = '重复。重复。'
    const result = resolveDriveAnnotationAnchor({
      selectors: selectors('重复', 0, 2),
      projection: projection(text),
      sourceText: text,
      renderedText: text,
    })

    expect(result.positionStatus).toBe('ambiguous')
    expect(result.renderedRange).toBeNull()
  })

  it('keeps a semantic range attached while reporting changed quoted text', () => {
    const text = '一段新版文字'
    const input = selectors('一段原始文字', 0, 6)
    const result = resolveDriveAnnotationAnchor({
      selectors: { ...input, semantic: { blockId: 'block', start: 0, end: 6, blockType: 'paragraph' } },
      projection: projection(text),
      sourceText: text,
      renderedText: text,
    })

    expect(result.positionStatus).toBe('attached')
    expect(result.quoteStatus).toBe('modified')
  })

  it('does not claim source deletion when a quote-only anchor loses its exact text', () => {
    const text = '一段新版文字'
    const result = resolveDriveAnnotationAnchor({
      selectors: selectors('一段原始文字', 0, 6),
      projection: projection(text),
      sourceText: text,
      renderedText: text,
    })

    expect(result.positionStatus).toBe('orphaned')
    expect(result.quoteStatus).toBe('deleted')
  })

  it('marks a non-empty CRDT selection as deleted when both relative positions collapse', () => {
    const text = '锚点前后文'
    const result = resolveDriveAnnotationAnchor({
      selectors: {
        ...selectors('已删除文字', 2, 7),
        crdt: { epoch: 'epoch-1', start: 'start', end: 'end' },
      },
      projection: projection(text),
      sourceText: text,
      renderedText: text,
      crdtSourceRange: { start: 2, end: 2 },
    })

    expect(result.positionStatus).toBe('source_deleted')
    expect(result.quoteStatus).toBe('deleted')
    expect(result.renderedRange).toBeNull()
  })

  it('uses the stable semantic range when a replacement collapses the CRDT positions', () => {
    const text = '前文全新后文'
    const result = resolveDriveAnnotationAnchor({
      selectors: {
        ...selectors('旧的', 2, 4),
        crdt: { epoch: 'epoch-1', start: 'start', end: 'end' },
        semantic: { blockId: 'block', start: 2, end: 4, blockType: 'paragraph' },
        quote: { exact: '旧的', prefix: '前文', suffix: '后文' },
      },
      projection: projection(text),
      sourceText: text,
      renderedText: text,
      crdtSourceRange: { start: 2, end: 2 },
    })

    expect(result.positionStatus).toBe('attached')
    expect(result.quoteStatus).toBe('modified')
    expect(result.renderedRange && sliceByCodePoints(text, result.renderedRange.start, result.renderedRange.end)).toBe('全新')
  })

  it('uses unique surrounding context when the stable block is no longer available', () => {
    const text = '前文全新后文'
    const result = resolveDriveAnnotationAnchor({
      selectors: {
        ...selectors('旧的', 2, 4),
        crdt: { epoch: 'epoch-1', start: 'start', end: 'end' },
        semantic: { blockId: 'missing-block', start: 2, end: 4, blockType: 'paragraph' },
        quote: { exact: '旧的', prefix: '前文', suffix: '后文' },
      },
      projection: projection(text),
      sourceText: text,
      renderedText: text,
      crdtSourceRange: { start: 2, end: 2 },
    })

    expect(result.positionStatus).toBe('attached')
    expect(result.quoteStatus).toBe('modified')
    expect(result.renderedRange && sliceByCodePoints(text, result.renderedRange.start, result.renderedRange.end)).toBe('全新')
  })

  it('continues to context fallback when a non-empty CRDT range points at replacement debris', () => {
    const text = '前文全新后文'
    const result = resolveDriveAnnotationAnchor({
      selectors: {
        ...selectors('旧的', 2, 4),
        crdt: { epoch: 'epoch-1', start: 'start', end: 'end' },
        semantic: { blockId: 'missing-block', start: 2, end: 4, blockType: 'paragraph' },
        quote: { exact: '旧的', prefix: '前文', suffix: '后文' },
      },
      projection: projection(text),
      sourceText: text,
      renderedText: text,
      crdtSourceRange: { start: 2, end: 3 },
    })

    expect(result.positionStatus).toBe('attached')
    expect(result.quoteStatus).toBe('modified')
    expect(result.renderedRange && sliceByCodePoints(text, result.renderedRange.start, result.renderedRange.end)).toBe('全新')
  })

  it('keeps a completely replaced CRDT selection attached when both surrounding contexts remain', () => {
    const text = '前文全新后文'
    const result = resolveDriveAnnotationAnchor({
      selectors: {
        ...selectors('旧的', 2, 4),
        crdt: { epoch: 'epoch-1', start: 'start', end: 'end' },
        quote: { exact: '旧的', prefix: '前文', suffix: '后文' },
      },
      projection: projection(text),
      sourceText: text,
      renderedText: text,
      crdtSourceRange: { start: 2, end: 4 },
    })

    expect(result.positionStatus).toBe('attached')
    expect(result.quoteStatus).toBe('modified')
  })

  it('does not keep an anchor attached to leftover Markdown delimiters when one context is gone', () => {
    const text = '前文``后文'
    const result = resolveDriveAnnotationAnchor({
      selectors: {
        ...selectors('代码 anchor_', 2, 12),
        crdt: { epoch: 'epoch-1', start: 'start', end: 'end' },
        quote: { exact: '代码 anchor_', prefix: '前文', suffix: 'code后文' },
      },
      projection: projection(text),
      sourceText: text,
      renderedText: text,
      crdtSourceRange: { start: 2, end: 4 },
    })

    expect(result.positionStatus).toBe('source_deleted')
    expect(result.quoteStatus).toBe('deleted')
    expect(result.renderedRange).toBeNull()
  })

  it('never returns an exact attachment to the wrong text under fixed-seed edits', () => {
    let seed = 0x5eed1234
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x1_0000_0000
    }
    const exact = '锚点🙂文字'
    for (let run = 0; run < 200; run += 1) {
      let text = `标题-${run} ${exact} 结尾`
      for (let edit = 0; edit < 8; edit += 1) {
        const points = Array.from(text)
        const index = Math.floor(random() * (points.length + 1))
        if (random() < 0.55) points.splice(index, 0, String.fromCodePoint(0x4e00 + Math.floor(random() * 100)))
        else if (points.length > 0) points.splice(Math.min(index, points.length - 1), 1)
        text = points.join('')
      }
      const result = resolveDriveAnnotationAnchor({
        selectors: selectors(exact, 0, Array.from(exact).length),
        projection: projection(text),
        sourceText: text,
        renderedText: text,
      })
      if (result.positionStatus === 'attached' && result.quoteStatus === 'exact') {
        expect(result.renderedRange).not.toBeNull()
        expect(sliceByCodePoints(text, result.renderedRange!.start, result.renderedRange!.end)).toBe(exact)
      }
    }
  })
})

function selectors(exact: string, start: number, end: number): DriveAnnotationSelectorsV2 {
  return {
    schemaVersion: 2,
    position: { start, end },
    renderedPosition: { start, end },
    quote: { exact, prefix: '', suffix: '' },
  }
}

function projection(text: string): DriveMarkdownProjectionDto {
  const length = Array.from(text).length
  return {
    schemaVersion: 1,
    parserVersion: 'test',
    sourceSha256: 'test',
    blocks: [{
      blockId: 'block',
      type: 'paragraph',
      parentBlockId: null,
      headingPath: [],
      sourceStart: 0,
      sourceEnd: length,
      renderedStart: 0,
      renderedEnd: length,
      textFingerprint: 'test',
    }],
    segments: [{
      segmentId: 'segment',
      blockId: 'block',
      sourceStart: 0,
      sourceEnd: length,
      renderedStart: 0,
      renderedEnd: length,
      mapping: 'identity',
    }],
  }
}
