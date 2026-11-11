import { createHash, randomBytes } from "node:crypto"
import { ConflictException, GoneException, HttpException, NotFoundException, ServiceUnavailableException } from "@nestjs/common"
import { buildTunnelUrl, createTunnelLabel, type TunnelMappingDto, type TunnelListInput, type TunnelPageDto, type TunnelCreateInput, type TunnelUpdateInput, type TunnelEnableInput, type TunnelDeleteInput, type TunnelRuntimeStatus } from "@synapse/shared/tunnel-contracts"
import type { TunnelDeviceActor } from "./tunnel-device.service"
import type { TunnelRepositoryPort, TunnelRow, TunnelStore } from "./tunnel.repository"
import { tunnelCreateSchema, tunnelDeleteSchema, tunnelEnableSchema, tunnelListSchema, tunnelUpdateSchema } from "./tunnel.schemas"

export interface TunnelRuntime {
  status(row: TunnelRow): TunnelRuntimeStatus
  invalidateMapping(id: string): void
}
export interface TunnelOptions { enabled: boolean; publicDomain: string; mappingsPerUser: number; label?: () => string }
export class TunnelService {
  private runtime: TunnelRuntime | null = null
  constructor(private readonly repository: TunnelRepositoryPort, readonly options: TunnelOptions) {}
  setRuntime(runtime: TunnelRuntime): void { this.runtime = runtime }
  assertEnabled(): void { if (!this.options.enabled) throw new ServiceUnavailableException({ code: "TUNNEL_DISABLED", message: "内网穿透尚未启用" }) }
  private dto(row: TunnelRow, names: Map<string, string>): TunnelMappingDto {
    return { id: row.id, clientInstanceId: row.clientInstanceId, deviceName: names.get(row.clientInstanceId) ?? "电脑", port: row.port,
      url: buildTunnelUrl(row.label, this.options.publicDomain), enabled: row.enabled, revision: row.revision,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), runtimeStatus: row.enabled ? this.runtime?.status(row) ?? "offline" : "stopped", lastErrorCode: null }
  }
  private async owned(tx: TunnelStore, userId: string, id: string, device?: string): Promise<TunnelRow> {
    const row = await tx.get(userId, id)
    if (!row || row.deletedAt || (device && row.clientInstanceId !== device)) throw new NotFoundException({ code: "TUNNEL_NOT_FOUND", message: "映射不存在" })
    return row
  }
  async list(userId: string, raw: TunnelListInput): Promise<TunnelPageDto> {
    this.assertEnabled()
    const input = tunnelListSchema.parse(raw)
    return this.repository.read(async tx => {
      const rows = await tx.list(userId, input.offset, input.limit, input.clientInstanceId)
      const total = await tx.count(userId, input.clientInstanceId)
      const names = await tx.names(userId, rows.map(row => row.clientInstanceId))
      return { items: rows.map(row => this.dto(row, names)), total, nextOffset: input.offset + rows.length < total ? input.offset + rows.length : null }
    })
  }
  async get(userId: string, id: string): Promise<TunnelMappingDto> {
    this.assertEnabled()
    return this.repository.read(async tx => { const row = await this.owned(tx, userId, id); return this.dto(row, await tx.names(userId, [row.clientInstanceId])) })
  }
  async operation(userId: string, requestId: string): Promise<TunnelMappingDto> {
    this.assertEnabled()
    return this.repository.read(async tx => {
      const op = await tx.operation(userId, requestId)
      if (!op) throw new NotFoundException({ code: "TUNNEL_OPERATION_NOT_FOUND", message: "申请尚未完成" })
      const row = await tx.get(userId, op.mappingId)
      if (!row || row.deletedAt) throw new GoneException({ code: "TUNNEL_DELETED", message: "映射已删除" })
      return this.dto(row, await tx.names(userId, [row.clientInstanceId]))
    })
  }
  async create(actor: TunnelDeviceActor, raw: TunnelCreateInput): Promise<TunnelMappingDto> {
    this.assertEnabled()
    const input = tunnelCreateSchema.parse(raw)
    const requestHash = createHash("sha256").update(JSON.stringify([actor.clientInstanceId, input.port])).digest("hex")
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.repository.withUserLock(actor.userId, async tx => {
          const old = await tx.operation(actor.userId, input.requestId)
          if (old) {
            if (old.requestHash !== requestHash) throw new ConflictException({ code: "TUNNEL_REQUEST_CONFLICT", message: "申请标识已用于其他参数" })
            const row = await tx.get(actor.userId, old.mappingId)
            if (!row || row.deletedAt) throw new GoneException({ code: "TUNNEL_DELETED", message: "映射已删除" })
            return this.dto(row, await tx.names(actor.userId, [row.clientInstanceId]))
          }
          if (await tx.count(actor.userId) >= this.options.mappingsPerUser) throw new HttpException({ code: "TUNNEL_QUOTA", message: "映射数量已达上限" }, 429)
          const row = await tx.create({ ...actor, label: this.options.label?.() ?? createTunnelLabel(randomBytes), port: input.port, enabled: true })
          await tx.saveOperation({ userId: actor.userId, requestId: input.requestId, requestHash, mappingId: row.id })
          return this.dto(row, await tx.names(actor.userId, [row.clientInstanceId]))
        })
      } catch (error) {
        const failure = error as { code?: string; meta?: { target?: unknown } }
        if (attempt < 4 && failure.code === "P2002" && String(failure.meta?.target).includes("label")) continue
        throw error
      }
    }
    throw new ServiceUnavailableException("域名分配失败")
  }
  async update(actor: TunnelDeviceActor, id: string, raw: TunnelUpdateInput): Promise<TunnelMappingDto> {
    const input = tunnelUpdateSchema.parse(raw)
    return this.change(actor.userId, id, input.expectedRevision, { port: input.port }, actor.clientInstanceId)
  }
  async setEnabled(actor: TunnelDeviceActor, id: string, raw: TunnelEnableInput): Promise<TunnelMappingDto> {
    const input = tunnelEnableSchema.parse(raw)
    return this.change(actor.userId, id, input.expectedRevision, { enabled: input.enabled }, actor.clientInstanceId)
  }
  private async change(userId: string, id: string, revision: number, change: Partial<Pick<TunnelRow, "port" | "enabled" | "deletedAt">>, device?: string): Promise<TunnelMappingDto> {
    this.assertEnabled()
    const result = await this.repository.withUserLock(userId, async tx => {
      const row = await this.owned(tx, userId, id, device)
      if (row.revision !== revision) throw new ConflictException({ code: "TUNNEL_VERSION_CONFLICT", message: "映射已变更，请刷新" })
      return this.dto(await tx.update(id, change), await tx.names(userId, [row.clientInstanceId]))
    })
    this.runtime?.invalidateMapping(id)
    return result
  }
  async delete(userId: string, id: string, raw: TunnelDeleteInput): Promise<{ id: string; deleted: true }> {
    const input = tunnelDeleteSchema.parse(raw)
    await this.change(userId, id, input.expectedRevision, { deletedAt: new Date(), enabled: false })
    return { id, deleted: true }
  }
  findPublic(label: string): Promise<TunnelRow | null> { this.assertEnabled(); return this.repository.findPublic(label) }
}
