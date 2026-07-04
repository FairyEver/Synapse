import { describe, expect, it } from 'vitest'
import type { AdminDriveItemRow } from '@/lib/api'
import {
  canDeleteAdminDriveItem,
  canRestoreAdminDriveItem,
  driveDisplayStatusLabel,
  driveItemTypeLabel,
  driveLifecycleStatusLabel,
  driveStatusLabel,
  formatDriveBytes,
} from '.'

describe('drive admin format helpers', () => {
  it('formats item type and status labels', () => {
    expect(driveItemTypeLabel('file')).toBe('文件')
    expect(driveItemTypeLabel('folder')).toBe('文件夹')
    expect(driveStatusLabel('active')).toBe('正常')
    expect(driveStatusLabel('delete_pending')).toBe('删除中')
    expect(driveLifecycleStatusLabel('trashed')).toBe('已移到回收站')
    expect(driveLifecycleStatusLabel('hidden')).toBe('已隐藏')
  })

  it('prefers lifecycle state for the visible admin drive status', () => {
    expect(driveDisplayStatusLabel(createDriveItem({
      storageStatus: 'active',
      lifecycleStatus: 'trashed',
    }))).toBe('已移到回收站')
    expect(driveDisplayStatusLabel(createDriveItem({
      storageStatus: 'active',
      lifecycleStatus: 'hidden',
    }))).toBe('已隐藏')
    expect(driveDisplayStatusLabel(createDriveItem({
      storageStatus: 'delete_pending',
      lifecycleStatus: 'active',
    }))).toBe('删除中')
  })

  it('formats byte values', () => {
    expect(formatDriveBytes('512')).toBe('512 B')
    expect(formatDriveBytes('2048')).toBe('2.0 KB')
    expect(formatDriveBytes('bad')).toBe('-')
  })

  it('only allows useful delete actions', () => {
    expect(canDeleteAdminDriveItem(createDriveItem())).toBe(true)
    expect(canDeleteAdminDriveItem(createDriveItem({
      lifecycleStatus: 'trashed',
    }))).toBe(true)
    expect(canDeleteAdminDriveItem(createDriveItem({
      storageStatus: 'delete_pending',
      storageDeletePending: true,
      lifecycleStatus: 'deleted',
    }))).toBe(false)
    expect(canDeleteAdminDriveItem(createDriveItem({
      storageStatus: 'delete_pending',
      storageDeletePending: false,
    }))).toBe(false)
    expect(canDeleteAdminDriveItem(createDriveItem({
      storageStatus: 'failed',
      storageDeletePending: true,
    }))).toBe(false)
  })

  it('only allows restore actions for recoverable lifecycle states', () => {
    expect(canRestoreAdminDriveItem(createDriveItem({
      lifecycleStatus: 'trashed',
    }))).toBe(true)
    expect(canRestoreAdminDriveItem(createDriveItem({
      lifecycleStatus: 'hidden',
    }))).toBe(true)
    expect(canRestoreAdminDriveItem(createDriveItem({
      lifecycleStatus: 'active',
    }))).toBe(false)
    expect(canRestoreAdminDriveItem(createDriveItem({
      lifecycleStatus: 'legacy_missing',
    }))).toBe(false)
  })
})

function createDriveItem(
  overrides: Partial<AdminDriveItemRow> = {}
): AdminDriveItemRow {
  return {
    id: 'item-1',
    parentId: null,
    type: 'file',
    name: 'report.pdf',
    size: '1024',
    mimeType: 'application/pdf',
    storageStatus: 'active',
    shared: false,
    activeShareId: null,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    userId: 'user-1',
    userEmail: 'admin@example.com',
    storageDeletePending: false,
    lifecycleStatus: 'active',
    ...overrides,
  }
}
