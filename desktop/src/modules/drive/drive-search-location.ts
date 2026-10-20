import type { DriveItemDto, DriveItemListInput, DriveItemListPageDto } from "@synapse/shared"
import { DRIVE_SEARCH_PAGE_SIZE } from "@synapse/shared/drive-search"

type Reader = { get: (input: { itemId: string }) => Promise<DriveItemDto>; list: (input: DriveItemListInput) => Promise<DriveItemListPageDto | readonly DriveItemDto[]> }

/** 搜索路径只供显示；导航重新按身份读取父链，并加载到目标实际所在的目录批次。 */
export async function resolveDriveSearchLocation(itemId: string, enterFolder: boolean, reader: Reader, isCurrent: () => boolean) {
  const target = await reader.get({ itemId })
  if (!isCurrent()) return null
  if (enterFolder && target.type !== "folder") throw new Error("文件夹已变化，请刷新搜索结果。")
  const chain: DriveItemDto[] = [target]
  const seen = new Set([target.id])
  let parentId = target.parentId
  while (parentId) {
    if (seen.has(parentId) || seen.size >= 256) throw new Error("云盘目录层级无效。")
    seen.add(parentId)
    const parent = await reader.get({ itemId: parentId })
    if (!isCurrent()) return null
    if (parent.type !== "folder") throw new Error("云盘目录已变化，请刷新后重试。")
    chain.push(parent); parentId = parent.parentId
  }
  const folderId = enterFolder ? target.id : target.parentId
  const items: DriveItemDto[] = []
  const ids = new Set<string>()
  let offset = 0
  while (isCurrent()) {
    const result = await reader.list({ parentId: folderId, offset, limit: DRIVE_SEARCH_PAGE_SIZE })
    if (!isCurrent()) return null
    const page: DriveItemListPageDto = Array.isArray(result)
      ? { items: result, page: { offset, limit: DRIVE_SEARCH_PAGE_SIZE, hasMore: false, nextOffset: null } }
      : result as DriveItemListPageDto
    for (const item of page.items) if (!ids.has(item.id)) { ids.add(item.id); items.push(item) }
    if (enterFolder || ids.has(target.id)) {
      return { folderId, items, page: page.page, path: [{ id: null, name: "根目录" }, ...(enterFolder ? chain : chain.slice(1)).reverse().map(item => ({ id: item.id, name: item.name }))], locatedItemId: enterFolder ? null : target.id }
    }
    if (!page.page.hasMore) throw new Error("文件位置已变化，请刷新搜索结果。")
    if (page.page.nextOffset === null || page.page.nextOffset <= offset) throw new Error("目录分页信息无效，请重试。")
    offset = page.page.nextOffset
  }
  return null
}
