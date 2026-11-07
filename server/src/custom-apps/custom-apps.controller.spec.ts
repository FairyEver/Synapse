import { type INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { UserAuthGuard } from "../auth/user-auth.guard"
import { CustomAppsController } from "./custom-apps.controller"
import { CustomAppsService } from "./custom-apps.service"

type SupertestResponse = { readonly body: unknown }
type SupertestRequest = {
  readonly send: (body: unknown) => SupertestRequest
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly post: (path: string) => SupertestRequest
  readonly patch: (path: string) => SupertestRequest
  readonly delete: (path: string) => SupertestRequest
}

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

describe("CustomAppsController", () => {
  let app: INestApplication | null = null
  const service = {
    snapshot: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bootstrap: vi.fn(),
    applyDockOperation: vi.fn(),
  }

  beforeEach(async () => {
    const snapshot = {
      schemaVersion: 1,
      revision: 1,
      initialized: true,
      dockCatalogVersion: 1,
      apps: [],
      dockAppIds: ["launcher"],
      dockMigrationIds: [],
    }
    service.snapshot.mockResolvedValue(snapshot)
    service.create.mockResolvedValue(snapshot)
    service.update.mockResolvedValue(snapshot)
    service.delete.mockResolvedValue(snapshot)
    service.bootstrap.mockResolvedValue(snapshot)
    service.applyDockOperation.mockResolvedValue(snapshot)

    const moduleRef = await Test.createTestingModule({
      controllers: [CustomAppsController],
      providers: [{ provide: CustomAppsService, useValue: service }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: { id: string } } }
        }) => {
          ctx.switchToHttp().getRequest().user = { id: "user-1" }
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
    vi.clearAllMocks()
  })

  it("scopes snapshot and mutations to the authenticated user", async () => {
    await request(app!.getHttpServer()).get("/api/custom-apps/snapshot").expect(200)
    expect(service.snapshot).toHaveBeenCalledWith("user-1")

    const createBody = {
      operationId: "create-1",
      id: appId,
      name: "阅读",
      startUrl: "https://example.com/read",
      iconSource: "favicon",
    }
    await request(app!.getHttpServer()).post("/api/custom-apps/apps").send(createBody).expect(201)
    expect(service.create).toHaveBeenCalledWith("user-1", expect.objectContaining({
      id: appId,
      name: "阅读",
    }))

    await request(app!.getHttpServer()).patch(`/api/custom-apps/apps/${appId}`).send({
      operationId: "update-1",
      name: "稍后阅读",
    }).expect(200)
    expect(service.update).toHaveBeenCalledWith("user-1", appId, expect.objectContaining({
      name: "稍后阅读",
    }))

    await request(app!.getHttpServer()).delete(`/api/custom-apps/apps/${appId}`).send({
      operationId: "delete-1",
    }).expect(200)
    expect(service.delete).toHaveBeenCalledWith("user-1", appId, { operationId: "delete-1" })
  })

  it("rejects invalid app ids, names and URLs before dispatch", async () => {
    await request(app!.getHttpServer()).post("/api/custom-apps/apps").send({
      operationId: "create-1",
      id: "agent",
      name: "阅读",
      startUrl: "javascript:alert(1)",
      iconSource: "favicon",
    }).expect(400)

    await request(app!.getHttpServer()).patch(`/api/custom-apps/apps/${appId}`).send({
      operationId: "update-1",
      name: "",
    }).expect(400)

    expect(service.create).not.toHaveBeenCalled()
    expect(service.update).not.toHaveBeenCalled()
  })

  it("routes Dock bootstrap and operations to the current user", async () => {
    await request(app!.getHttpServer()).post("/api/custom-apps/bootstrap").send({
      operationId: "bootstrap-1",
      dockAppIds: ["agent", "launcher"],
      dockMigrationIds: [],
    }).expect(201)
    expect(service.bootstrap).toHaveBeenCalledWith("user-1", {
      operationId: "bootstrap-1",
      dockAppIds: ["agent", "launcher"],
      dockMigrationIds: [],
    })

    await request(app!.getHttpServer()).post("/api/custom-apps/dock/operations").send({
      operationId: "pin-1",
      type: "pin",
      appId,
    }).expect(201)
    expect(service.applyDockOperation).toHaveBeenCalledWith("user-1", {
      operationId: "pin-1",
      type: "pin",
      appId,
    })
  })
})
