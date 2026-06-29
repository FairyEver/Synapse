import type { DriveUploadPrepareResult } from '@synapse/shared'
import { ApiError, driveApi } from '@/lib/api'

export type DriveWebUploadInput = {
  readonly parentId: string | null
  readonly files: readonly File[]
}

export type DriveWebUploadResult = {
  readonly completed: number
  readonly failed: number
  readonly skipped: number
  readonly message?: string
}

export async function uploadDriveFiles(input: DriveWebUploadInput): Promise<DriveWebUploadResult> {
  let completed = 0
  let failed = 0
  let skipped = 0
  let firstMessage: string | undefined

  for (const file of input.files) {
    if (isFolderLikeFile(file)) {
      skipped += 1
      firstMessage ??= '不支持文件夹上传'
      continue
    }

    const result = await uploadOneDriveFile(input.parentId, file)
    completed += result.completed
    failed += result.failed
    skipped += result.skipped
    firstMessage ??= result.message
  }

  return {
    completed,
    failed,
    skipped,
    ...(firstMessage ? { message: firstMessage } : {}),
  }
}

function isFolderLikeFile(file: File): boolean {
  const relativePath = (file as File & { readonly webkitRelativePath?: string }).webkitRelativePath
  return typeof relativePath === 'string' && relativePath.includes('/')
}

async function uploadOneDriveFile(parentId: string | null, file: File): Promise<DriveWebUploadResult> {
  let prepared: DriveUploadPrepareResult
  try {
    prepared = await driveApi.prepareUpload({
      parentId,
      name: file.name,
      size: String(file.size),
      mimeType: file.type || null,
    })
  } catch (error) {
    return { completed: 0, failed: 1, skipped: 0, message: errorMessage(error, '上传准备失败') }
  }

  try {
    const response = await fetch(prepared.upload.url, {
      method: prepared.upload.method,
      headers: prepared.upload.headers,
      body: file,
    })
    if (!response.ok) {
      throw new ApiError(await uploadResponseMessage(response), response.status)
    }
    await driveApi.completeUpload(prepared.sessionId)
    return { completed: 1, failed: 0, skipped: 0 }
  } catch (error) {
    try {
      await driveApi.cancelUpload(prepared.sessionId)
    } catch {
      // The upload error is more useful to the user than a cleanup failure.
    }
    return { completed: 0, failed: 1, skipped: 0, message: errorMessage(error, '上传失败') }
  }
}

async function uploadResponseMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: unknown }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  } catch {
    return response.statusText || '上传失败'
  }
  return response.statusText || '上传失败'
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
