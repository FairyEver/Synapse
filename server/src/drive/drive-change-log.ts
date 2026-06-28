import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type {
  DriveChangeDto,
  DriveChangeListInput,
  DriveChangeListPageDto,
  DriveChangeType,
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
  readonly actor?: string | null
}

@Injectable()
export class DriveChangeLogService {
  constructor(private readonly prisma: PrismaService) {}

  append(input: DriveChangeAppendInput, client: DriveChangePrisma = this.prisma): Promise<DriveChangeDto> {
    return client.driveChange.create({
      data: {
        userId: input.userId,
        itemId: input.itemId,
        parentId: input.parentId,
        type: input.type,
        versionId: input.versionId ?? null,
        etag: input.etag ?? null,
        name: input.name ?? null,
        pathHint: input.pathHint ?? null,
        actor: input.actor ?? null,
      },
    }).then(toDriveChangeDto)
  }

  async list(userId: string, input: DriveChangeListInput = {}): Promise<DriveChangeListPageDto> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 500))
    const cursor = parseCursor(input.cursor)
    const rows = await this.prisma.driveChange.findMany({
      where: { userId, sequence: { gt: cursor } },
      orderBy: { sequence: "asc" },
      take: limit + 1,
    })
    const pageRows = rows.slice(0, limit)
    return {
      items: pageRows.map(toDriveChangeDto),
      nextCursor: pageRows.at(-1)?.sequence.toString() ?? input.cursor ?? null,
      hasMore: rows.length > limit,
      resyncRequired: false,
    }
  }
}

function parseCursor(cursor: string | null | undefined): bigint {
  if (!cursor) return 0n
  if (!/^\d+$/u.test(cursor)) return 0n
  return BigInt(cursor)
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
}): DriveChangeDto {
  return {
    id: change.id,
    sequence: change.sequence.toString(),
    itemId: change.itemId,
    parentId: change.parentId,
    type: change.type as DriveChangeType,
    versionId: change.versionId,
    etag: change.etag,
    name: change.name,
    pathHint: change.pathHint,
    actor: change.actor,
    occurredAt: change.occurredAt.toISOString(),
  }
}
