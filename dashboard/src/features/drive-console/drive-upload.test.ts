import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, driveApi } from '@/lib/api'
import { uploadDriveFiles } from './drive-upload'

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  driveApi: {
    prepareUpload: vi.fn(),
    completeUpload: vi.fn(),
    cancelUpload: vi.fn(),
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('uploadDriveFiles', () => {
  it('uploads loose files through prepare, PUT, and complete', async () => {
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })
    vi.mocked(driveApi.prepareUpload).mockResolvedValue({
      sessionId: 'session-1',
      item: {} as never,
      upload: {
        method: 'PUT',
        url: 'https://upload.example/one',
        expiresAt: '2026-06-29T00:00:00.000Z',
        headers: { 'content-type': 'text/markdown' },
      },
    })
    vi.mocked(driveApi.completeUpload).mockResolvedValue({} as never)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    const result = await uploadDriveFiles({ parentId: 'folder-1', files: [file] })

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 0 })
    expect(driveApi.prepareUpload).toHaveBeenCalledWith({
      parentId: 'folder-1',
      name: 'notes.md',
      size: String(file.size),
      mimeType: 'text/markdown',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://upload.example/one', {
      method: 'PUT',
      headers: { 'content-type': 'text/markdown' },
      body: file,
    })
    expect(driveApi.completeUpload).toHaveBeenCalledWith('session-1')
    expect(driveApi.cancelUpload).not.toHaveBeenCalled()
  })

  it('skips folder-like files and never calls prepare for them', async () => {
    const folderFile = new File(['x'], 'nested.md', { type: 'text/markdown' })
    Object.defineProperty(folderFile, 'webkitRelativePath', { value: 'Folder/nested.md' })

    const result = await uploadDriveFiles({ parentId: null, files: [folderFile] })

    expect(result).toEqual({
      completed: 0,
      failed: 0,
      skipped: 1,
      message: '不支持文件夹上传',
    })
    expect(driveApi.prepareUpload).not.toHaveBeenCalled()
  })

  it('continues after one file fails and cancels the failed session', async () => {
    const first = new File(['bad'], 'bad.md')
    const second = new File(['ok'], 'ok.md')
    vi.mocked(driveApi.prepareUpload)
      .mockResolvedValueOnce({
        sessionId: 'session-bad',
        item: {} as never,
        upload: { method: 'PUT', url: 'https://upload.example/bad', expiresAt: '', headers: {} },
      })
      .mockResolvedValueOnce({
        sessionId: 'session-ok',
        item: {} as never,
        upload: { method: 'PUT', url: 'https://upload.example/ok', expiresAt: '', headers: {} },
      })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'upload failed' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.mocked(driveApi.completeUpload).mockResolvedValue({} as never)
    vi.mocked(driveApi.cancelUpload).mockResolvedValue({ ok: true })

    const result = await uploadDriveFiles({ parentId: null, files: [first, second] })

    expect(result.completed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.message).toBe('upload failed')
    expect(driveApi.cancelUpload).toHaveBeenCalledWith('session-bad')
    expect(driveApi.completeUpload).toHaveBeenCalledWith('session-ok')
  })

  it('keeps the original failure message when cancel also fails', async () => {
    const file = new File(['bad'], 'bad.md')
    vi.mocked(driveApi.prepareUpload).mockResolvedValue({
      sessionId: 'session-bad',
      item: {} as never,
      upload: { method: 'PUT', url: 'https://upload.example/bad', expiresAt: '', headers: {} },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'upload failed' }), { status: 500 }))
    vi.mocked(driveApi.cancelUpload).mockRejectedValue(new Error('cancel failed'))

    const result = await uploadDriveFiles({ parentId: null, files: [file] })

    expect(result).toMatchObject({ completed: 0, failed: 1, skipped: 0, message: 'upload failed' })
  })

  it('uses ApiError messages from prepare failures', async () => {
    const file = new File(['large'], 'large.bin')
    vi.mocked(driveApi.prepareUpload).mockRejectedValue(new ApiError('文件超过 100MB 限制。', 400))

    const result = await uploadDriveFiles({ parentId: null, files: [file] })

    expect(result).toMatchObject({ completed: 0, failed: 1, skipped: 0, message: '文件超过 100MB 限制。' })
  })
})
