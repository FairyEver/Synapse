import "reflect-metadata"
import { Module, UnauthorizedException, type ExecutionContext } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { tunnelCreateSchema, tunnelListSchema, tunnelUpdateSchema } from "./tunnel.schemas"
import { TunnelService } from "./tunnel.service"
import { TunnelDeviceService } from "./tunnel-device.service"
import { TunnelController } from "./tunnel.controller"
import { TunnelModule } from "./tunnel.module"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { memoryTunnelRepository } from "./tunnel-test-fixture"

describe("tunnel management request boundary", () => {
  it("authenticates real routes, binds writes to a proven device, and never caches results", async () => {
    const repository = memoryTunnelRepository()
    const service = new TunnelService(repository, { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: 100 })
    const devices = new TunnelDeviceService(repository)
    let owner = "u1"
    @Module({ imports: [], controllers: [TunnelController], providers: [{ provide: TunnelService, useValue: service }, { provide: TunnelDeviceService, useValue: devices }] })
    class BoundaryModule extends TunnelModule {}
    const module = await Test.createTestingModule({ imports: [BoundaryModule] }).overrideGuard(UserAuthGuard).useValue({ canActivate(context: ExecutionContext) {
      if (!owner) throw new UnauthorizedException()
      context.switchToHttp().getRequest().user = { id: owner }; return true
    } }).compile()
    const app = module.createNestApplication()
    await app.init()
    try {
      const api = request(app.getHttpServer())
      const proof = { "x-synapse-tunnel-device": "d1", "x-synapse-tunnel-key": "a".repeat(43) }
      await api.put("/api/tunnels/device").set(proof).expect(200)
      const created = await api.post("/api/tunnels").set(proof).send({ port: 3000, requestId: "00000000-0000-4000-8000-000000000001" }).expect(201).expect("Cache-Control", "private, no-store")
      await api.get("/api/tunnels/operations/00000000-0000-4000-8000-000000000001").expect(200)
      await api.get("/api/tunnels?limit=101").expect(400)
      owner = "other"
      await api.get(`/api/tunnels/${created.body.id}`).expect(404)
      owner = ""
      await api.get("/api/tunnels").expect(401).expect("Cache-Control", "private, no-store")
    } finally { await app.close() }
  })
  it("rejects arbitrary targets and nonliteral ports", () => {
    const requestId = "00000000-0000-4000-8000-000000000001"
    for (const port of [0, 65536, "3000", 1.5]) expect(tunnelCreateSchema.safeParse({ port, requestId }).success).toBe(false)
    expect(tunnelCreateSchema.safeParse({ port: 3000, requestId, host: "10.0.0.1" }).success).toBe(false)
    expect(tunnelCreateSchema.parse({ port: 3000, requestId })).toEqual({ port: 3000, requestId })
  })
  it("consumes bounded pagination and requires an exact revision for updates", () => {
    expect(tunnelListSchema.parse({ offset: "20", limit: "20", clientInstanceId: "d1" })).toEqual({ offset: 20, limit: 20, clientInstanceId: "d1" })
    expect(tunnelListSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(tunnelUpdateSchema.safeParse({ port: 3001 }).success).toBe(false)
  })
})
