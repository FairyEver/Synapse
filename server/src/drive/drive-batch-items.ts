import { BadRequestException } from "@nestjs/common"
import { DRIVE_ITEM_BATCH_LIMIT, type DriveItemBatchResponse, type DriveItemAncestorDto } from "@synapse/shared"
import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { toDriveItemDto } from "./drive.types"

export async function readDriveItemsBatch(
  prisma: PrismaService, userId: string, itemIds: readonly string[], where: Prisma.DriveItemWhereInput,
  include: Prisma.DriveItemInclude,
): Promise<DriveItemBatchResponse> {
  if (!itemIds.length || itemIds.length > DRIVE_ITEM_BATCH_LIMIT || itemIds.some((id) => !id.trim() || id.length > 128)) {
    throw new BadRequestException("批量条目数量或 ID 无效。")
  }
  const ids = [...new Set(itemIds)]
  const roots = await prisma.driveItem.findMany({ where: { ...where, id: { in: ids } }, include })
  const nodes = new Map<string, DriveItemAncestorDto>(roots.map((item) => [item.id, {
    id: item.id, parentId: item.parentId, name: item.name, type: item.type === "folder" ? "folder" : "file",
  }]))
  let pending = [...new Set(roots.flatMap((item) => item.parentId && !nodes.has(item.parentId) ? [item.parentId] : []))]
  const queried = new Set(ids)
  for (let depth = 0; pending.length && depth < 256 && nodes.size < 4096; depth += 1) {
    const batch = pending.filter((id) => !queried.has(id)).slice(0, 4096 - nodes.size)
    if (!batch.length) break
    batch.forEach((id) => queried.add(id))
    const rows = await prisma.driveItem.findMany({ where: { ...where, id: { in: batch } }, select: { id: true, parentId: true, name: true, type: true } })
    for (const item of rows) nodes.set(item.id, { id: item.id, parentId: item.parentId, name: item.name, type: item.type === "folder" ? "folder" : "file" })
    pending = [...new Set(rows.flatMap((item) => item.parentId && !queried.has(item.parentId) ? [item.parentId] : []))]
  }
  const keys = roots.flatMap((item) => item.type === "file" && item.storageKey ? [item.storageKey] : [])
  const versions = keys.length ? await prisma.driveFileVersion.findMany({
    where: { userId, storageKey: { in: keys }, deletedAt: null },
    select: { id: true, itemId: true, storageKey: true, etag: true },
  }) : []
  const byId = new Map(roots.map((item) => [item.id, item]))
  const byKey = new Map(versions.map((version) => [version.storageKey, version]))
  return { results: ids.map((itemId) => {
    const item = byId.get(itemId)
    if (!item) return { itemId, data: null, error: { status: 404, code: "NOT_FOUND", message: "云盘条目不存在。" } }
    const ancestors: DriveItemAncestorDto[] = []
    const seen = new Set([itemId])
    let parentId = item.parentId
    while (parentId) {
      const parent = nodes.get(parentId)
      if (!parent || parent.type !== "folder" || seen.has(parentId) || seen.size >= 256) {
        return { itemId, data: null, error: { status: 409, code: "ANCESTRY_INCOMPLETE", message: "无法确认云盘父目录。" } }
      }
      seen.add(parentId)
      ancestors.unshift(parent)
      parentId = parent.parentId
    }
    const version = item.storageKey ? byKey.get(item.storageKey) : null
    return { itemId, error: null, data: { item: toDriveItemDto(item), ancestors, currentVersionId: version?.id ?? null, etag: version?.etag ?? null } }
  }) }
}
