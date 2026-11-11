import { createHash, timingSafeEqual } from "node:crypto"
import { ConflictException, UnauthorizedException } from "@nestjs/common"
import type { TunnelRepositoryPort } from "./tunnel.repository"

export interface TunnelDeviceActor { userId: string; clientInstanceId: string }
export function validTunnelDevice(clientInstanceId: unknown, key: unknown): clientInstanceId is string {
  return typeof clientInstanceId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(clientInstanceId)
    && typeof key === "string" && /^[A-Za-z0-9_-]{43}$/u.test(key)
}
function digest(key: string): string { return createHash("sha256").update(key).digest("hex") }
function equal(a: string, b: string): boolean { return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)) }
export class TunnelDeviceService {
  constructor(private readonly repository: TunnelRepositoryPort) {}
  async register(userId: string, clientInstanceId: string, key: string): Promise<void> {
    if (!validTunnelDevice(clientInstanceId, key)) throw new UnauthorizedException({ code: "TUNNEL_DEVICE_INVALID", message: "设备凭据无效" })
    await this.repository.withUserLock(userId, async tx => {
      const existing = await tx.credential(userId, clientInstanceId)
      if (existing && !equal(existing, digest(key))) throw new ConflictException({ code: "TUNNEL_DEVICE_CONFLICT", message: "设备凭据不匹配" })
      if (!existing) await tx.saveCredential(userId, clientInstanceId, digest(key))
    })
  }
  async verify(userId: string, clientInstanceId: string, key: string): Promise<TunnelDeviceActor> {
    if (!validTunnelDevice(clientInstanceId, key)) throw new UnauthorizedException({ code: "TUNNEL_DEVICE_INVALID", message: "设备凭据无效" })
    const existing = await this.repository.read(tx => tx.credential(userId, clientInstanceId))
    if (!existing || !equal(existing, digest(key))) throw new UnauthorizedException({ code: "TUNNEL_DEVICE_INVALID", message: "设备凭据无效" })
    return { userId, clientInstanceId }
  }
}
