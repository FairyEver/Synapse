import { type INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { AgentPersonasController } from "./agent-personas.controller"
import { AgentPersonasService } from "./agent-personas.service"

type SupertestResponse = { readonly body: unknown }
type SupertestRequest = {
  readonly send: (body: unknown) => SupertestRequest
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly post: (path: string) => SupertestRequest
  readonly put: (path: string) => SupertestRequest
  readonly delete: (path: string) => SupertestRequest
}

describe("AgentPersonasController", () => {
  let app: INestApplication | null = null
  const service = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateBuiltinPreference: vi.fn(),
  }

  beforeEach(async () => {
    service.list.mockResolvedValue({ items: [] })
    service.create.mockResolvedValue(persona("persona-1"))
    service.update.mockResolvedValue(persona("persona-1"))
    service.delete.mockResolvedValue(undefined)
    service.updateBuiltinPreference.mockResolvedValue({ ...persona("builtin-1"), source: "builtin", readonly: true })

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentPersonasController],
      providers: [{ provide: AgentPersonasService, useValue: service }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: { id: string } } } }) => {
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

  it("routes authenticated list and writes to the current user", async () => {
    await request(app!.getHttpServer()).get("/api/agent-personas").expect(200)
    expect(service.list).toHaveBeenCalledWith("user-1")

    await request(app!.getHttpServer()).post("/api/agent-personas").send({
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      toolPolicy: null,
    }).expect(201)
    expect(service.create).toHaveBeenCalledWith("user-1", expect.objectContaining({ name: "产品顾问" }))
  })

  it("routes update, delete and built-in preferences", async () => {
    await request(app!.getHttpServer()).put("/api/agent-personas/persona-1").send({
      name: "翻译助手",
      description: "翻译文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: null,
      toolPolicy: null,
    }).expect(200)
    expect(service.update).toHaveBeenCalledWith("user-1", "persona-1", expect.objectContaining({ name: "翻译助手" }))

    await request(app!.getHttpServer()).put("/api/agent-personas/builtin/builtin-1/preferences").send({
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    }).expect(200)
    expect(service.updateBuiltinPreference).toHaveBeenCalledWith("user-1", "builtin-1", expect.objectContaining({ toolPolicy: { mode: "disabled" } }))

    await request(app!.getHttpServer()).delete("/api/agent-personas/persona-1").expect(200)
    expect(service.delete).toHaveBeenCalledWith("user-1", "persona-1")
  })

  it("rejects invalid payloads", async () => {
    await request(app!.getHttpServer()).post("/api/agent-personas").send({
      name: "",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      toolPolicy: null,
    }).expect(400)
  })
})

function persona(id: string) {
  return {
    id,
    schemaVersion: 1,
    name: "产品顾问",
    description: "整理产品判断。",
    systemPrompt: "你是产品顾问。",
    providerModel: null,
    toolPolicy: null,
    source: "user",
    readonly: false,
    version: 1,
  }
}
