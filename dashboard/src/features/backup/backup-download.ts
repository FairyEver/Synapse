import { toast } from 'sonner'

import { adminApi } from '@/lib/api'

type BackupDownloadDeps = {
  downloadBackup: (filename: string) => Promise<void>
  notifySuccess: (message: string) => void
  notifyError: (message: string) => void
}

const defaultDeps: BackupDownloadDeps = {
  downloadBackup: adminApi.downloadBackup,
  notifySuccess: toast.success,
  notifyError: toast.error,
}

export async function downloadBackupWithFeedback(
  filename: string,
  deps: BackupDownloadDeps = defaultDeps
): Promise<void> {
  try {
    await deps.downloadBackup(filename)
    deps.notifySuccess('备份下载中')
  } catch (err: unknown) {
    deps.notifyError(err instanceof Error ? err.message : '下载失败')
  }
}
