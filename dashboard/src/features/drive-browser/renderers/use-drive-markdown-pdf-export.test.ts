import { describe, expect, it } from 'vitest'
import { pdfFilename } from './use-drive-markdown-pdf-export'

describe('pdfFilename', () => {
  it.each([
    ['文档.md', '文档.pdf'],
    ['report.bin', 'report.pdf'],
    ['.notes', '.notes.pdf'],
  ])('converts %s to %s', (name, expected) => {
    expect(pdfFilename(name)).toBe(expected)
  })
})
