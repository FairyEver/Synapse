import { describe, expect, it } from 'vitest'
import { isStandaloneDriveReaderHref } from './authenticated-layout'

describe('authenticated drive layout mode', () => {
  it('treats owner item pages as standalone by default', () => {
    expect(isStandaloneDriveReaderHref('/drive/items/file-1')).toBe(true)
    expect(isStandaloneDriveReaderHref('/drive/items/file-1?surface=standalone')).toBe(true)
  })

  it('keeps explicit console owner item pages in the console shell', () => {
    expect(isStandaloneDriveReaderHref('/drive/items/file-1?surface=console')).toBe(false)
    expect(isStandaloneDriveReaderHref('/console/drive/folders/folder-1')).toBe(false)
  })
})
