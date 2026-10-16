import type { DriveItemDto } from '@synapse/shared'
import { trackedDriveApi as driveApi, trackedDriveFileVersionsApi as versionsApi } from '@/features/drive-browser/shared/drive-telemetry-api'
import type { DriveWebFolderUploadInput, DriveWebUploadInput } from './drive-upload'

export type DriveUploadGuard =
  | { readonly expectedItemId: string; readonly expectedVersionId: string }
  | { readonly createOnly: true }

export type DriveReviewedFile = { readonly file: File; readonly name: string; readonly guard: DriveUploadGuard }
export type DriveReviewedFolder = Omit<DriveWebFolderUploadInput, 'files'> & {
  readonly expectedRootItemId?: string
  readonly createRootOnly?: true
  readonly files: readonly { readonly file: File; readonly relativePath: string; readonly guard: DriveUploadGuard }[]
}
export type DriveWebUploadReview = {
  readonly parentId: string | null
  readonly files: readonly DriveReviewedFile[]
  readonly folders: readonly DriveReviewedFolder[]
  readonly overwrites: readonly { readonly path: string; readonly itemId: string; readonly size: string }[]
}

export function driveFileExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index).toLowerCase() : ''
}

export async function reviewDriveFileReplacement(item: Pick<DriveItemDto, 'id' | 'name' | 'parentId' | 'size' | 'type'>, file: File): Promise<DriveWebUploadReview> {
  if (item.type !== 'file' || driveFileExtension(item.name) !== driveFileExtension(file.name)) {
    throw new Error('请选择与云端文件扩展名相同的文件')
  }
  const expectedVersionId = await currentVersion(item.id)
  return {
    parentId: item.parentId,
    files: [{ file, name: item.name, guard: { expectedItemId: item.id, expectedVersionId } }],
    folders: [],
    overwrites: [{ path: item.name, itemId: item.id, size: item.size }],
  }
}

export async function prepareDriveUploadReview(input: DriveWebUploadInput): Promise<DriveWebUploadReview> {
  const directories = new Map<string | null, Promise<Map<string, DriveItemDto>>>()
  const loadChildren = (parentId: string | null): Promise<Map<string, DriveItemDto>> => {
    const cached = directories.get(parentId)
    if (cached) return cached
    const pending = (async () => {
      const children = new Map<string, DriveItemDto>()
      let offset: number | null = 0
      while (offset !== null) {
        const page = await driveApi.listItems({ parentId, offset, limit: 200 })
        for (const item of page.items) children.set(`${item.type}:${item.name}`, item)
        offset = page.page.hasMore ? page.page.nextOffset : null
      }
      return children
    })()
    directories.set(parentId, pending)
    return pending
  }
  const lookup = async (parentId: string | null, type: string, name: string) => (await loadChildren(parentId)).get(`${type}:${name}`)
  const overwrites: { path: string; itemId: string; size: string }[] = []
  const reviewedIds = new Set<string>()
  const plannedPaths = new Set<string>()
  const guardFor = async (target: DriveItemDto | undefined, path: string): Promise<DriveUploadGuard> => {
    if (plannedPaths.has(path)) throw new Error(`重复的上传目标：${path}`)
    plannedPaths.add(path)
    if (!target) return { createOnly: true }
    if (reviewedIds.has(target.id)) throw new Error(`重复的上传目标：${path}`)
    reviewedIds.add(target.id)
    const expectedVersionId = await currentVersion(target.id)
    overwrites.push({ path, itemId: target.id, size: target.size })
    return { expectedItemId: target.id, expectedVersionId }
  }
  const grouped = groupUploadFiles(input)
  const files: DriveReviewedFile[] = []
  for (const file of grouped.files) {
    files.push({ file, name: file.name, guard: await guardFor(await lookup(input.parentId, 'file', file.name), file.name) })
  }
  const folders: DriveReviewedFolder[] = []
  for (const folder of grouped.folders) {
    const root = await lookup(input.parentId, 'folder', folder.folderName)
    const folderFiles: DriveReviewedFolder['files'][number][] = []
    for (const entry of folder.files) {
      const segments = entry.relativePath.split('/')
      let parent = root
      for (const segment of segments.slice(0, -1)) parent = parent ? await lookup(parent.id, 'folder', segment) : undefined
      const target = parent ? await lookup(parent.id, 'file', segments[segments.length - 1]) : undefined
      folderFiles.push({ ...entry, guard: await guardFor(target, `${folder.folderName}/${entry.relativePath}`) })
    }
    folders.push({ ...folder, files: folderFiles, ...(root ? { expectedRootItemId: root.id } : { createRootOnly: true }) })
  }
  return { parentId: input.parentId, files, folders, overwrites }
}

async function currentVersion(itemId: string): Promise<string> {
  const page = await versionsApi.list(itemId, { offset: 0, limit: 1 })
  const version = page.items.find((item) => item.isCurrent)
  if (!version) throw new Error('无法读取当前版本，请刷新后重试')
  return version.id
}

function groupUploadFiles(input: DriveWebUploadInput): { files: File[]; folders: DriveWebFolderUploadInput[] } {
  const files: File[] = []
  const folders = new Map<string, { folderName: string; directories: string[]; files: { file: File; relativePath: string }[] }>()
  for (const file of input.files) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    const segments = relativePath?.split(/[\\/]+/u).filter(Boolean) ?? []
    if (segments.length < 2) { files.push(file); continue }
    const group = folders.get(segments[0]) ?? { folderName: segments[0], directories: [], files: [] }
    group.files.push({ file, relativePath: segments.slice(1).join('/') })
    folders.set(group.folderName, group)
  }
  for (const folder of input.folders ?? []) {
    const group = folders.get(folder.folderName) ?? { folderName: folder.folderName, directories: [], files: [] }
    group.directories.push(...folder.directories)
    group.files.push(...folder.files)
    folders.set(group.folderName, group)
  }
  return { files, folders: [...folders.values()] }
}
