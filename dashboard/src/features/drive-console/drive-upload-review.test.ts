import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveItemDto } from '@synapse/shared'
import { driveApi, driveFileVersionsApi } from '@/lib/api'
import { prepareDriveUploadReview, reviewDriveFileReplacement } from './drive-upload-review'

vi.mock('@/features/drive-browser/shared/drive-telemetry', () => ({ startDriveOperation: () => () => undefined }))

vi.mock('@/lib/api', () => ({
  driveBrowserApi: {}, driveAnnotationApi: {}, driveMessageApi: {},
  driveApi: { listItems: vi.fn() },
  driveFileVersionsApi: { list: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(driveApi.listItems).mockResolvedValue({ items: [], total: 0, fileCount: 0, folderCount: 0, page: { hasMore: false, nextOffset: null } })
  vi.mocked(driveFileVersionsApi.list).mockResolvedValue({ items: [{ id: 'v1', isCurrent: true }], total: 1 } as never)
})
afterEach(() => vi.resetAllMocks())

function item(id: string, name: string, parentId: string | null = null, type = 'file') {
  return { id, name, parentId, type, size: '3' } as DriveItemDto
}

describe('Drive upload review', () => {
  it('binds an explicit replacement to the original name and reviewed current version', async () => {
    const file = new File(['new'], 'local.MD')
    const review = await reviewDriveFileReplacement(item('cloud', 'cloud.md', 'parent'), file)
    expect(review.files[0]).toMatchObject({ file, name: 'cloud.md', guard: { expectedItemId: 'cloud', expectedVersionId: 'v1' } })
    expect(review.overwrites).toEqual([{ path: 'cloud.md', itemId: 'cloud', size: '3' }])
    expect(review.parentId).toBe('parent')
  })

  it('rejects a different extension before requesting a version', async () => {
    await expect(reviewDriveFileReplacement(item('cloud', 'cloud.md'), new File(['new'], 'local.txt'))).rejects.toThrow('扩展名')
    expect(driveFileVersionsApi.list).not.toHaveBeenCalled()
  })

  it('fails closed when the current version cannot be determined', async () => {
    vi.mocked(driveFileVersionsApi.list).mockResolvedValue({ items: [], total: 0 } as never)
    await expect(reviewDriveFileReplacement(item('cloud', 'cloud.md'), new File(['new'], 'local.md'))).rejects.toThrow('当前版本')
  })

  it('reviews every directory page and binds matching loose file identities', async () => {
    vi.mocked(driveApi.listItems)
      .mockResolvedValueOnce({ items: [], page: { hasMore: true, nextOffset: 200 } } as never)
      .mockResolvedValueOnce({ items: [item('cloud', 'notes.md', 'parent')], page: { hasMore: false, nextOffset: null } } as never)
    const file = new File(['new'], 'notes.md')
    const review = await prepareDriveUploadReview({ parentId: 'parent', files: [file, new File(['x'], 'new.md')] })
    expect(review.files[0].guard).toEqual({ expectedItemId: 'cloud', expectedVersionId: 'v1' })
    expect(review.files[1].guard).toEqual({ createOnly: true })
    expect(review.overwrites).toHaveLength(1)
    expect(driveApi.listItems).toHaveBeenLastCalledWith({ parentId: 'parent', offset: 200, limit: 200 })
  })

  it('rejects duplicate new-file destinations before creating upload sessions', async () => {
    await expect(prepareDriveUploadReview({ parentId: null, files: [new File(['a'], 'same.md'), new File(['b'], 'same.md')] })).rejects.toThrow('重复的上传目标')
  })

  it('reviews nested folder collisions and keeps absent cloud files outside the upload manifest', async () => {
    const cloudItems = [
      item('root', 'Project', null, 'folder'), item('docs', 'docs', 'root', 'folder'),
      item('cloud', 'notes.md', 'docs'), item('untouched', 'old.md', 'docs'),
    ]
    vi.mocked(driveApi.listItems).mockImplementation(async ({ parentId } = {}) => ({ items: cloudItems.filter((entry) => entry.parentId === parentId), page: { hasMore: false, nextOffset: null } } as never))
    const review = await prepareDriveUploadReview({ parentId: null, files: [], folders: [{ folderName: 'Project', directories: ['docs'], files: [{ file: new File(['new'], 'notes.md'), relativePath: 'docs/notes.md' }] }] })
    expect(review.folders[0]).toMatchObject({ expectedRootItemId: 'root', files: [{ guard: { expectedItemId: 'cloud', expectedVersionId: 'v1' } }] })
    expect(review.overwrites.map((entry) => entry.path)).toEqual(['Project/docs/notes.md'])
    expect(review.folders[0].files).toHaveLength(1)
    expect(driveApi.listItems).toHaveBeenCalledTimes(3)
  })
})
