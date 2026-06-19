import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import { LiveClientRegistry } from "./live-client-registry"
import type { LiveClientInstance, LiveClientStatus, LiveClientDisconnectReason } from "./live.types"

type UserDeviceRow = Prisma.UserDeviceGetPayload<Record<string, never>>
type AdminUserDeviceRow = Prisma.UserDeviceGetPayload<{
  include: {
    user: {
      select: {
        id: true
        email: true
        displayName: true
      }
    }
  }
}>

export interface DashboardDeviceRow {
  readonly userId?: string
  readonly userEmail?: string
  readonly userDisplayName?: string | null
  readonly clientInstanceId: string
  readonly displayName: string | null
  readonly deviceName: string
  readonly platform: string
  readonly appVersion: string
  readonly status: LiveClientStatus
  readonly connectedAt: string | null
  readonly firstSeenAt: string
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: LiveClientDisconnectReason
}

export interface UpsertDeviceHelloInput {
  readonly userId: string
  readonly clientInstanceId: string
  readonly deviceName: string
  readonly platform: string
  readonly appVersion: string
  readonly seenAt: Date
}

const deviceNameLimit = 120
const platformLimit = 80
const appVersionLimit = 80

@Injectable()
export class LiveDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: LiveClientRegistry,
  ) {}

  async upsertFromHello(input: UpsertDeviceHelloInput): Promise<void> {
    const deviceName = boundedText(input.deviceName, deviceNameLimit)
    const platform = boundedText(input.platform, platformLimit)
    const appVersion = boundedText(input.appVersion, appVersionLimit)

    await this.prisma.userDevice.upsert({
      where: {
        userId_clientInstanceId: {
          userId: input.userId,
          clientInstanceId: input.clientInstanceId,
        },
      },
      create: {
        userId: input.userId,
        clientInstanceId: input.clientInstanceId,
        deviceName,
        platform,
        appVersion,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
      },
      update: {
        deviceName,
        platform,
        appVersion,
        lastSeenAt: input.seenAt,
      },
    })
  }

  async listUserDevices(userId: string, pagination: PaginationQuery): Promise<PaginatedResponse<DashboardDeviceRow>> {
    const liveClients = this.registry.listByUser(userId)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.userDevice.findMany({
        ...toPrismaArgs(pagination),
        where: { userId },
      }),
      this.prisma.userDevice.count({ where: { userId } }),
    ])
    const liveKeysWithRows = await this.findPersistedLiveDeviceKeys(liveClients)
    const liveByClient = new Map(
      liveClients.map((client) => [client.clientInstanceId, client]),
    )
    const devices = rows.map((row) => {
      const live = liveByClient.get(row.clientInstanceId)
      liveByClient.delete(row.clientInstanceId)
      return toDeviceRow(row, live, { includeUser: false })
    })

    const liveOnlyDevices = Array.from(liveByClient.values())
      .filter((live) => !liveKeysWithRows.has(deviceKey(live.userId, live.clientInstanceId)))
      .map((live) => toLiveOnlyDeviceRow(live, { includeUser: false }))

    return {
      data: [
        ...devices,
        ...(pagination.page === 1 ? liveOnlyDevices : []),
      ].sort(compareDevicesByObservedAt),
      total: total + liveOnlyDevices.length,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  async listAdminDevices(pagination: PaginationQuery): Promise<PaginatedResponse<DashboardDeviceRow>> {
    const liveClients = this.registry.listAll()
    const { orderBy } = toPrismaArgs(pagination)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.userDevice.findMany({
        orderBy,
        include: {
          user: {
            select: { id: true, email: true, displayName: true },
          },
        },
      }),
      this.prisma.userDevice.count(),
    ])
    const liveKeysWithRows = await this.findPersistedLiveDeviceKeys(liveClients)
    const liveByKey = new Map(
      liveClients.map((client) => [deviceKey(client.userId, client.clientInstanceId), client]),
    )
    const devices = rows.map((row) => {
      const key = deviceKey(row.userId, row.clientInstanceId)
      const live = liveByKey.get(key)
      liveByKey.delete(key)
      return toDeviceRow(row, live, { includeUser: true })
    })
    const liveOnlyDevices = Array.from(liveByKey.values())
      .filter((live) => !liveKeysWithRows.has(deviceKey(live.userId, live.clientInstanceId)))
      .map((live) => toLiveOnlyDeviceRow(live, { includeUser: true }))
    const offset = (pagination.page - 1) * pagination.pageSize
    const data = [
      ...devices,
      ...liveOnlyDevices,
    ].sort(compareDevicesByObservedAt)

    return {
      data: data.slice(offset, offset + pagination.pageSize),
      total: total + liveOnlyDevices.length,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  async renameUserDevice(
    userId: string,
    clientInstanceId: string,
    displayName: string,
  ): Promise<DashboardDeviceRow> {
    const nextDisplayName = displayName.trim()
    try {
      const row = await this.prisma.userDevice.update({
        where: {
          userId_clientInstanceId: {
            userId,
            clientInstanceId,
          },
        },
        data: { displayName: nextDisplayName },
      })
      const live = this.registry.listByUser(userId).find((client) => client.clientInstanceId === clientInstanceId)
      return toDeviceRow(row, live, { includeUser: false })
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        const live = this.registry.listByUser(userId).find((client) => client.clientInstanceId === clientInstanceId)
        if (!live) throw new NotFoundException("设备不存在。")

        const observedAt = liveDeviceObservedAt(live)
        const row = await this.prisma.userDevice.upsert({
          where: {
            userId_clientInstanceId: {
              userId,
              clientInstanceId,
            },
          },
          create: {
            userId,
            clientInstanceId,
            displayName: nextDisplayName,
            deviceName: boundedText(live.deviceName, deviceNameLimit),
            platform: boundedText(live.platform, platformLimit),
            appVersion: boundedText(live.appVersion, appVersionLimit),
            firstSeenAt: observedAt,
            lastSeenAt: observedAt,
          },
          update: { displayName: nextDisplayName },
        })
        return toDeviceRow(row, live, { includeUser: false })
      }
      throw error
    }
  }

  private async findPersistedLiveDeviceKeys(liveClients: readonly LiveClientInstance[]): Promise<ReadonlySet<string>> {
    if (liveClients.length === 0) return new Set()
    const rows = await this.prisma.userDevice.findMany({
      where: {
        OR: liveClients.map((client) => ({
          userId: client.userId,
          clientInstanceId: client.clientInstanceId,
        })),
      },
      select: {
        userId: true,
        clientInstanceId: true,
      },
    })
    return new Set(rows.map((row) => deviceKey(row.userId, row.clientInstanceId)))
  }
}

function toDeviceRow(
  row: UserDeviceRow | AdminUserDeviceRow,
  live: LiveClientInstance | undefined,
  options: { readonly includeUser: boolean },
): DashboardDeviceRow {
  return {
    ...(options.includeUser ? userFields(row as AdminUserDeviceRow) : undefined),
    clientInstanceId: row.clientInstanceId,
    displayName: row.displayName,
    deviceName: live?.deviceName ?? row.deviceName,
    platform: live?.platform ?? row.platform,
    appVersion: live?.appVersion ?? row.appVersion,
    status: live?.status ?? "offline",
    connectedAt: live?.connectedAt ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: live?.lastSeenAt ?? row.lastSeenAt.toISOString(),
    ...(live?.disconnectedAt ? { disconnectedAt: live.disconnectedAt } : undefined),
    ...(live?.disconnectReason ? { disconnectReason: live.disconnectReason } : undefined),
  }
}

function toLiveOnlyDeviceRow(
  live: LiveClientInstance,
  options: { readonly includeUser: boolean },
): DashboardDeviceRow {
  const firstSeenAt = live.connectedAt ?? live.lastSeenAt ?? new Date(0).toISOString()
  return {
    ...(options.includeUser ? {
      userId: live.userId,
    } : undefined),
    clientInstanceId: live.clientInstanceId,
    displayName: null,
    deviceName: live.deviceName,
    platform: live.platform,
    appVersion: live.appVersion,
    status: live.status,
    connectedAt: live.connectedAt,
    firstSeenAt,
    lastSeenAt: live.lastSeenAt,
    ...(live.disconnectedAt ? { disconnectedAt: live.disconnectedAt } : undefined),
    ...(live.disconnectReason ? { disconnectReason: live.disconnectReason } : undefined),
  }
}

function userFields(row: AdminUserDeviceRow) {
  return {
    userId: row.user.id,
    userEmail: row.user.email,
    userDisplayName: row.user.displayName,
  }
}

function compareDevicesByObservedAt(left: DashboardDeviceRow, right: DashboardDeviceRow): number {
  return observedAt(right) - observedAt(left)
}

function observedAt(row: DashboardDeviceRow): number {
  return Math.max(
    parseDeviceTime(row.lastSeenAt),
    parseDeviceTime(row.connectedAt),
    parseDeviceTime(row.disconnectedAt),
    parseDeviceTime(row.firstSeenAt),
  )
}

function liveDeviceObservedAt(live: LiveClientInstance): Date {
  const timestamp = live.lastSeenAt ?? live.connectedAt
  const parsed = timestamp ? new Date(timestamp) : null
  if (parsed && Number.isFinite(parsed.getTime())) return parsed
  return new Date()
}

function parseDeviceTime(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : 0
}

function boundedText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength)
}

function deviceKey(userId: string, clientInstanceId: string): string {
  return `${userId}:${clientInstanceId}`
}

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025"
}
