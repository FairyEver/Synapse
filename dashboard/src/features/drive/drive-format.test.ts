import { describe, expect, it } from 'vitest'
import { driveItemTypeLabel, driveStatusLabel, formatDriveBytes } from '.'

describe('drive admin format helpers', () => {
  it('formats item type and status labels', () => {
    expect(driveItemTypeLabel('file')).toBe('文件')
    expect(driveItemTypeLabel('folder')).toBe('文件夹')
    expect(driveStatusLabel('active')).toBe('正常')
    expect(driveStatusLabel('delete_pending')).toBe('删除中')
  })

  it('formats byte values', () => {
    expect(formatDriveBytes('512')).toBe('512 B')
    expect(formatDriveBytes('2048')).toBe('2.0 KB')
    expect(formatDriveBytes('bad')).toBe('-')
  })
})
