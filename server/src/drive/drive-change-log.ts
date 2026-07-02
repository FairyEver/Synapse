import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type {
  DriveChangeDto,
  DriveChangeListInput,
  DriveChangeListPageDto,
  DriveChangeType,
  DriveItemType,
} from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"

type DriveChangePrisma = PrismaService | Prisma.TransactionClient

export type DriveChangeAppendInput = {
  readonly userId: string
  readonly itemId: string
  readonly parentId: string | null
  readonly type: DriveChangeType
  readonly versionId?: string | null
  readonly etag?: string | null
  readonly name?: string | null
  readonly pathHint?: string | null
  readonly itemKind?: DriveItemType | null
  readonly actor?: string | null
}

@Injectable()
export class DriveChangeLogService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: DriveChangeAppendInput, client: DriveChangePrisma = this.prisma): Promise<DriveChangeDto> {
    const metadata = await resolveItemMetadata(client, input.userId, [input.itemId])
    const itemMetadata = metadata.get(input.itemId)
    const change = await client.driveChange.create({
      data: {
        userId: input.userId,
        itemId: input.itemId,
        parentId: input.parentId,
        type: input.type,
        versionId: input.versionId ?? null,
        etag: input.etag ?? null,
        name: input.name ?? null,
        pathHint: input.pathHint ?? itemMetadata?.pathHint ?? null,
        actor: input.actor ?? null,
      },
    })
    return toDriveChangeDto(change, {
      itemKind: input.itemKind ?? itemMetadata?.itemKind ?? null,
      pathHint: change.pathHint ?? itemMetadata?.pathHint ?? null,
    })
  }

  async list(userId: string, input: DriveChangeListInput = {}): Promise<DriveChangeListPageDto> {
    if (input.cursor === "latest") return this.currentCursor(userId)
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 500))
    const cursor = parseCursor(input.cursor)
    const scopeWhere = driveChangeScopeWhere(input)
    const rows = await this.prisma.driveChange.findMany({
      where: { userId, sequence: { gt: cursor }, ...scopeWhere },
      orderBy: { sequence: "asc" },
      take: limit + 1,
    })
    const pageRows = rows.slice(0, limit)
    const metadata = await resolveItemMetadata(
      this.prisma,
      userId,
      pageRows.map((row) => row.itemId),
    )
    return {
      items: pageRows.map((row) => toDriveChangeDto(row, metadata.get(row.itemId))),
      nextCursor: pageRows.at(-1)?.sequence.toString() ?? input.cursor ?? null,
      hasMore: rows.length > limit,
      resyncRequired: false,
    }
  }

  private async currentCursor(userId: string): Promise<DriveChangeListPageDto> {
    const latest = await this.prisma.driveChange.findFirst({
      where: { userId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    })
    return {
      items: [],
      nextCursor: latest?.sequence.toString() ?? null,
      hasMore: false,
      resyncRequired: false,
    }
  }
}

function parseCursor(cursor: string | null | undefined): bigint {
  if (!cursor) return 0n
  if (!/^\d+$/u.test(cursor)) return 0n
  return BigInt(cursor)
}

function driveChangeScopeWhere(input: DriveChangeListInput): Prisma.DriveChangeWhereInput {
  const rootItemId = normalizeScopeValue(input.rootItemId)
  const rootPathHint = normalizeRootPathHint(input.rootPathHint)
  const conditions: Prisma.DriveChangeWhereInput[] = []
  if (rootItemId) {
    conditions.push({ itemId: rootItemId }, { parentId: rootItemId })
  }
  if (rootPathHint) {
    conditions.push(
      { pathHint: rootPathHint },
      { pathHint: { startsWith: `${rootPathHint}/` } },
    )
  }
  return conditions.length > 0 ? { OR: conditions } : {}
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeRootPathHint(value: string | null | undefined): string | null {
  const trimmed = normalizeScopeValue(value)
  if (!trimmed || trimmed === "/") return null
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/u, "")
}

type DriveChangeItemMetadata = {
  readonly itemKind: DriveItemType | null
  readonly pathHint: string | null
}

type DriveItemPathRow = {
  readonly id: string
  readonly parentId: string | null
  readonly type: string
  readonly name: string
}

async function resolveItemMetadata(
  client: DriveChangePrisma,
  userId: string,
  itemIds: readonly string[],
): Promise<Map<string, DriveChangeItemMetadata>> {
  const pending = new Set(itemIds.filter(Boolean))
  const items = new Map<string, DriveItemPathRow>()

  while (pending.size > 0) {
    const ids = [...pending]
    pending.clear()
    const rows = await client.driveItem.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, parentId: true, type: true, name: true },
    })
    for (const row of rows) {
      items.set(row.id, row)
      if (row.parentId && !items.has(row.parentId)) pending.add(row.parentId)
    }
  }

  return new Map(itemIds.map((itemId) => {
    const item = items.get(itemId)
    return [itemId, {
      itemKind: toDriveItemKind(item?.type),
      pathHint: item ? buildPathHint(item, items) : null,
    }]
  }))
}

function buildPathHint(item: DriveItemPathRow, items: ReadonlyMap<string, DriveItemPathRow>): string {
  const parts = [item.name]
  let parentId = item.parentId
  while (parentId) {
    const parent = items.get(parentId)
    if (!parent) break
    parts.unshift(parent.name)
    parentId = parent.parentId
  }
  return `/${parts.join("/")}`
}

function toDriveItemKind(value: string | null | undefined): DriveItemType | null {
  return value === "file" || value === "folder" ? value : null
}

function toDriveChangeDto(change: {
  readonly id: string
  readonly sequence: bigint
  readonly itemId: string
  readonly parentId: string | null
  readonly type: string
  readonly versionId: string | null
  readonly etag: string | null
  readonly name: string | null
  readonly pathHint: string | null
  readonly actor: string | null
  readonly occurredAt: Date
}, metadata?: DriveChangeItemMetadata): DriveChangeDto {
  return {
    id: change.id,
    sequence: change.sequence.toString(),
    itemId: change.itemId,
    parentId: change.parentId,
    type: change.type as DriveChangeType,
    versionId: change.versionId,
    etag: change.etag,
    name: change.name,
    pathHint: change.pathHint ?? metadata?.pathHint ?? null,
    itemKind: metadata?.itemKind ?? null,
    actor: change.actor,
    occurredAt: change.occurredAt.toISOString(),
  }
}
