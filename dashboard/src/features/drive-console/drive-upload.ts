import type { DriveFolderUploadPrepareResult, DriveUploadPrepareResult } from '@synapse/shared'
import { ApiError, driveApi } from '@/lib/api'

export type DriveWebUploadInput = {
  readonly parentId: string | null
  readonly files: readonly File[]
  readonly folders?: readonly DriveWebFolderUploadInput[]
}

export type DriveWebFolderUploadFile = {
  readonly file: File
  readonly relativePath: string
}

export type DriveWebFolderUploadInput = {
  readonly folderName: string
  readonly directories: readonly string[]
  readonly files: readonly DriveWebFolderUploadFile[]
}

export type DriveWebUploadResult = {
  readonly completed: number
  readonly failed: number
  readonly skipped: number
  readonly message?: string
}

export type DriveFolderPickerResult =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'selected'; readonly folder: DriveWebFolderUploadInput }

type DriveFileSystemFileHandle = {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

type DriveFileSystemDirectoryHandle = {
  readonly kind: 'directory'
  readonly name: string
  values?: () => AsyncIterable<DriveFileSystemHandle>
  entries?: () => AsyncIterable<[string, DriveFileSystemHandle]>
}

type DriveFileSystemHandle = DriveFileSystemFileHandle | DriveFileSystemDirectoryHandle

type DriveDirectoryPickerGlobal = typeof globalThis & {
  showDirectoryPicker?: (options?: { readonly mode?: 'read' }) => Promise<DriveFileSystemDirectoryHandle>
}

export async function uploadDriveFiles(input: DriveWebUploadInput): Promise<DriveWebUploadResult> {
  let completed = 0
  let failed = 0
  let skipped = 0
  let firstMessage: string | undefined
  const looseFiles: File[] = []
  const folderGroups = new Map<string, {
    readonly folderName: string
    readonly directories: string[]
    readonly files: DriveWebFolderUploadFile[]
  }>()

  for (const file of input.files) {
    const folderFile = driveFolderUploadFile(file)
    if (folderFile) {
      const group = folderGroups.get(folderFile.folderName) ?? { folderName: folderFile.folderName, directories: [], files: [] }
      group.files.push({ file, relativePath: folderFile.relativePath })
      folderGroups.set(folderFile.folderName, group)
      continue
    }
    looseFiles.push(file)
  }

  for (const folder of input.folders ?? []) {
    const group = folderGroups.get(folder.folderName) ?? { folderName: folder.folderName, directories: [], files: [] }
    group.directories.push(...folder.directories)
    group.files.push(...folder.files)
    folderGroups.set(folder.folderName, group)
  }

  for (const file of looseFiles) {
    const result = await uploadOneDriveFile(input.parentId, file)
    completed += result.completed
    failed += result.failed
    skipped += result.skipped
    firstMessage ??= result.message
  }

  for (const folder of folderGroups.values()) {
    const result = await uploadOneDriveFolder(input.parentId, folder)
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

export async function pickDriveFolderForUpload(): Promise<DriveFolderPickerResult> {
  const picker = (globalThis as DriveDirectoryPickerGlobal).showDirectoryPicker
  if (!picker) return { kind: 'unsupported' }
  let root: DriveFileSystemDirectoryHandle
  try {
    root = await picker.call(globalThis, { mode: 'read' })
  } catch (error) {
    if (isPickerCancel(error)) return { kind: 'cancelled' }
    throw error
  }
  return { kind: 'selected', folder: await readDirectoryHandle(root) }
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
  folder: DriveWebFolderUploadInput,
): Promise<DriveWebUploadResult> {
  let prepared: DriveFolderUploadPrepareResult
  try {
    prepared = await driveApi.prepareFolderUpload({
      parentId,
      folderName: folder.folderName,
      directories: folderDirectories(folder.files.map((file) => file.relativePath), folder.directories).map((relativePath) => ({ relativePath })),
      files: folder.files.map(({ file, relativePath }) => ({
        relativePath,
        size: String(file.size),
        mimeType: file.type || null,
      })),
    })
  } catch (error) {
    return { completed: 0, failed: Math.max(folder.files.length, 1), skipped: 0, message: errorMessage(error, '文件夹上传准备失败') }
  }

  const entries = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
  let completed = 0
  let failed = 0
  let firstMessage: string | undefined
  for (const { file, relativePath } of folder.files) {
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
    ...(firstMessage ? { message: firstMessage } : folder.files.length === 0 ? { message: '已上传文件夹' } : {}),
  }
}

function folderDirectories(relativePaths: readonly string[], explicitDirectories: readonly string[] = []): string[] {
  const directories = new Set<string>()
  for (const directory of explicitDirectories) {
    const normalized = normalizeFolderRelativePath(directory)
    if (normalized) directories.add(normalized)
  }
  for (const relativePath of relativePaths) {
    const segments = relativePath.split('/').filter(Boolean)
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'))
    }
  }
  return [...directories]
}

async function readDirectoryHandle(root: DriveFileSystemDirectoryHandle): Promise<DriveWebFolderUploadInput> {
  const directories: string[] = []
  const files: DriveWebFolderUploadFile[] = []
  await collectDirectoryEntries(root, '', directories, files)
  return { folderName: root.name, directories, files }
}

async function collectDirectoryEntries(
  directory: DriveFileSystemDirectoryHandle,
  currentPath: string,
  directories: string[],
  files: DriveWebFolderUploadFile[],
): Promise<void> {
  for await (const child of directoryChildren(directory)) {
    const relativePath = [currentPath, child.name].filter(Boolean).join('/')
    if (child.kind === 'directory') {
      directories.push(relativePath)
      await collectDirectoryEntries(child, relativePath, directories, files)
      continue
    }
    files.push({ file: await child.getFile(), relativePath })
  }
}

async function* directoryChildren(directory: DriveFileSystemDirectoryHandle): AsyncIterable<DriveFileSystemHandle> {
  if (directory.values) {
    for await (const child of directory.values()) yield child
    return
  }
  if (directory.entries) {
    for await (const [, child] of directory.entries()) yield child
  }
}

function normalizeFolderRelativePath(relativePath: string): string | null {
  const normalized = relativePath.split(/[\\/]+/u).filter(Boolean).join('/')
  return normalized || null
}

function isPickerCancel(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && error.name === 'AbortError'
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
