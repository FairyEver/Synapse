import type { DriveFileReplacePreviewDto, DriveItemDto } from "@synapse/shared"
import type { DriveLocalUploadItem, DriveLocalUploadRequest } from "@/types/bridge"

export interface DriveLocalUploadReview {
  readonly request: DriveLocalUploadRequest
  readonly replacements: readonly { readonly path: string; readonly preview: DriveFileReplacePreviewDto }[]
}
export interface DriveLocalUploadReviewApi {
  readonly list: (parentId: string | null, offset: number) => Promise<{ readonly items: readonly DriveItemDto[]; readonly nextOffset: number | null }>
  readonly preview: (itemId: string, filePath: string) => Promise<DriveFileReplacePreviewDto>
}

/** Resolve exact file identities only along selected branches; stale retry tokens are never reused. */
export async function reviewDriveLocalUpload(request: DriveLocalUploadRequest, api: DriveLocalUploadReviewApi): Promise<DriveLocalUploadReview> {
  const listing = new Map<string | null, Promise<readonly DriveItemDto[]>>()
  const replacements: Array<{ path: string; preview: DriveFileReplacePreviewDto }> = []
  function children(parentId: string | null) {
    let response = listing.get(parentId)
    if (!response) {
      response = (async () => {
        const items: DriveItemDto[] = []
        let offset: number | null = 0
        const seen = new Set<number>()
        while (offset !== null) {
          if (seen.has(offset)) throw new Error("云端列表分页异常，请刷新重试")
          seen.add(offset)
          const page = await api.list(parentId, offset)
          items.push(...page.items); offset = page.nextOffset
        }
        return items
      })()
      listing.set(parentId, response)
    }
    return response
  }
  async function find(parentId: string | null, name: string, kind: "file" | "folder") {
    const named = (await children(parentId)).filter((candidate) => candidate.name === name)
    const matching = named.filter((candidate) => candidate.type === kind)
    if (matching.length > 1) throw new Error(`云端存在多个「${name}」，请从目标文件菜单上传新版本`)
    if (matching.length === 0 && named.length) throw new Error(`「${name}」与云端同名项目的类型不同，请先重命名`)
    return matching[0] ?? null
  }
  async function reviewFile(parentId: string | null, name: string, filePath: string, displayPath: string) {
    const item = await find(parentId, name, "file")
    if (!item) return {}
    const preview = await api.preview(item.id, filePath)
    if (preview.name !== name) throw new Error(`云端文件「${name}」已改名，请刷新后重新上传`)
    replacements.push({ path: displayPath, preview })
    return { expectedItemId: item.id, replacementToken: preview.confirmationToken }
  }
  const items: DriveLocalUploadItem[] = []
  for (const item of request.items) {
    if (item.kind === "file") {
      const base = { kind: "file" as const, name: item.name, path: item.path, mimeType: item.mimeType }
      items.push({ ...base, ...await reviewFile(request.parentId ?? null, item.name, item.path, item.name) })
      continue
    }
    const root = await find(request.parentId ?? null, item.folderName, "folder")
    const files = []
    for (const file of item.files) {
      const segments = file.relativePath.replace(/\\/gu, "/").split("/")
      const name = segments.pop()!
      let parent = root
      for (const segment of segments) {
        if (!parent) break
        parent = await find(parent.id, segment, "folder")
      }
      files.push({ path: file.path, relativePath: file.relativePath, mimeType: file.mimeType,
        ...parent ? await reviewFile(parent.id, name, file.path, `${item.folderName}/${file.relativePath}`) : {},
      })
    }
    items.push({ kind: "folder", folderName: item.folderName, directories: item.directories, files,
      ...(root ? { expectedRootItemId: root.id } : { createRootOnly: true }),
    })
  }
  return { request: { ...request, items }, replacements }
}
