import { describe, expect, it, vi } from 'vitest'

import { downloadBackupWithFeedback } from './backup-download'

describe('downloadBackupWithFeedback', () => {
  it('downloads through the API client and reports success', async () => {
    const downloadBackup = vi.fn().mockResolvedValue(undefined)
    const notifySuccess = vi.fn()
    const notifyError = vi.fn()

    await downloadBackupWithFeedback('backup.tar.gz', {
      downloadBackup,
      notifySuccess,
      notifyError,
    })

    expect(downloadBackup).toHaveBeenCalledWith('backup.tar.gz')
    expect(notifySuccess).toHaveBeenCalledWith('备份下载中')
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('reports download failures instead of saving error responses', async () => {
    const downloadBackup = vi.fn().mockRejectedValue(new Error('备份文件不存在'))
    const notifySuccess = vi.fn()
    const notifyError = vi.fn()

    await downloadBackupWithFeedback('missing.tar.gz', {
      downloadBackup,
      notifySuccess,
      notifyError,
    })

    expect(notifyError).toHaveBeenCalledWith('备份文件不存在')
    expect(notifySuccess).not.toHaveBeenCalled()
  })
})
