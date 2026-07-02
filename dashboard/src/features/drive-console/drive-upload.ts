import type { DriveFolderUploadPrepareResult, DriveUploadPrepareResult } from '@synapse/shared'
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
  const looseFiles: File[] = []
  const folderGroups = new Map<string, Array<{ readonly file: File; readonly relativePath: string }>>()

  for (const file of input.files) {
    const folderFile = driveFolderUploadFile(file)
    if (folderFile) {
      const group = folderGroups.get(folderFile.folderName) ?? []
      group.push({ file, relativePath: folderFile.relativePath })
      folderGroups.set(folderFile.folderName, group)
      continue
    }
    looseFiles.push(file)
  }

  for (const file of looseFiles) {
    const result = await uploadOneDriveFile(input.parentId, file)
    completed += result.completed
    failed += result.failed
    skipped += result.skipped
    firstMessage ??= result.message
  }

  for (const [folderName, files] of folderGroups) {
    const result = await uploadOneDriveFolder(input.parentId, folderName, files)
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

function driveFolderUploadFile(file: File): { readonly folderName: string; readonly relativePath: string } | null {
  const relativePath = (file as File & { readonly webkitRelativePath?: string }).webkitRelativePath
  if (typeof relativePath !== 'string') return null
  const segments = relativePath.split(/[\\/]+/u).filter(Boolean)
  if (segments.length < 2) return null
  return { folderName: segments[0], relativePath: segments.slice(1).join('/') }
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

  return uploadPreparedDriveFile(prepared, file)
}

async function uploadOneDriveFolder(
  parentId: string | null,
  folderName: string,
  files: ReadonlyArray<{ readonly file: File; readonly relativePath: string }>,
): Promise<DriveWebUploadResult> {
  let prepared: DriveFolderUploadPrepareResult
  try {
    prepared = await driveApi.prepareFolderUpload({
      parentId,
      folderName,
      directories: folderDirectories(files.map((file) => file.relativePath)).map((relativePath) => ({ relativePath })),
      files: files.map(({ file, relativePath }) => ({
        relativePath,
        size: String(file.size),
        mimeType: file.type || null,
      })),
    })
  } catch (error) {
    return { completed: 0, failed: files.length, skipped: 0, message: errorMessage(error, '文件夹上传准备失败') }
  }

  const entries = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
  let completed = 0
  let failed = 0
  let firstMessage: string | undefined
  for (const { file, relativePath } of files) {
    const entry = entries.get(relativePath)
    if (!entry) {
      failed += 1
      firstMessage ??= '文件夹上传准备失败'
      continue
    }
    const result = await uploadPreparedDriveFile(entry, file)
    completed += result.completed
    failed += result.failed
    firstMessage ??= result.message
  }

  return {
    completed,
    failed,
    skipped: 0,
    ...(firstMessage ? { message: firstMessage } : {}),
  }
}

function folderDirectories(relativePaths: readonly string[]): string[] {
  const directories = new Set<string>()
  for (const relativePath of relativePaths) {
    const segments = relativePath.split('/').filter(Boolean)
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'))
    }
  }
  return [...directories]
}

async function uploadPreparedDriveFile(
  prepared: { readonly sessionId: string; readonly upload: DriveUploadPrepareResult['upload'] },
  file: File,
): Promise<DriveWebUploadResult> {
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
