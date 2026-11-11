import { Injectable } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"

export interface TunnelRow {
  id: string; userId: string; clientInstanceId: string; label: string; port: number; enabled: boolean; revision: number
  createdAt: Date; updatedAt: Date; deletedAt: Date | null
}
export interface TunnelOperation { userId: string; requestId: string; requestHash: string; mappingId: string }
export interface TunnelStore {
  get(userId: string, id: string): Promise<TunnelRow | null>
  operation(userId: string, requestId: string): Promise<TunnelOperation | null>
  count(userId: string, clientInstanceId?: string): Promise<number>
  list(userId: string, offset: number, limit: number, clientInstanceId?: string): Promise<TunnelRow[]>
  create(input: Pick<TunnelRow, "userId" | "clientInstanceId" | "label" | "port" | "enabled">): Promise<TunnelRow>
  update(id: string, change: Partial<Pick<TunnelRow, "port" | "enabled" | "deletedAt">>): Promise<TunnelRow>
  saveOperation(input: TunnelOperation): Promise<void>
  credential(userId: string, clientInstanceId: string): Promise<string | null>
  saveCredential(userId: string, clientInstanceId: string, keyHash: string): Promise<void>
  names(userId: string, ids: string[]): Promise<Map<string, string>>
}
export interface TunnelRepositoryPort {
  withUserLock<T>(userId: string, work: (store: TunnelStore) => Promise<T>): Promise<T>
  read<T>(work: (store: TunnelStore) => Promise<T>): Promise<T>
  findPublic(label: string): Promise<TunnelRow | null>
}
function store(db: Prisma.TransactionClient): TunnelStore {
  return {
    get: (userId, id) => db.userTunnel.findFirst({ where: { userId, id } }),
    operation: (userId, requestId) => db.userTunnelOperation.findUnique({ where: { userId_requestId: { userId, requestId } } }),
    count: (userId, clientInstanceId) => db.userTunnel.count({ where: { userId, clientInstanceId, deletedAt: null } }),
    list: (userId, offset, limit, clientInstanceId) => db.userTunnel.findMany({ where: { userId, clientInstanceId, deletedAt: null }, skip: offset, take: limit, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    create: input => db.userTunnel.create({ data: input }),
    update: (id, change) => db.userTunnel.update({ where: { id }, data: { ...change, revision: { increment: 1 } } }),
    async saveOperation(input) { await db.userTunnelOperation.create({ data: input }) },
    async credential(userId, clientInstanceId) { return (await db.tunnelDeviceCredential.findUnique({ where: { userId_clientInstanceId: { userId, clientInstanceId } } }))?.keyHash ?? null },
    async saveCredential(userId, clientInstanceId, keyHash) { await db.tunnelDeviceCredential.create({ data: { userId, clientInstanceId, keyHash } }) },
    async names(userId, ids) {
      const rows = await db.userDevice.findMany({ where: { userId, clientInstanceId: { in: ids } }, select: { clientInstanceId: true, displayName: true, deviceName: true }, take: 100 })
      return new Map(rows.map(row => [row.clientInstanceId, row.displayName || row.deviceName]))
    },
  }
}
@Injectable()
export class TunnelRepository implements TunnelRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  withUserLock<T>(userId: string, work: (store: TunnelStore) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      // A user row lock serializes quota checks, idempotency and credentials across API processes.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
      return work(store(tx))
    }, { timeout: 10_000 })
  }
  read<T>(work: (store: TunnelStore) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(tx => work(store(tx)), { isolationLevel: "RepeatableRead" })
  }
  findPublic(label: string): Promise<TunnelRow | null> { return this.prisma.userTunnel.findUnique({ where: { label } }) }
}
