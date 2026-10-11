import "reflect-metadata"
import { Test } from "@nestjs/testing"
import type { ExecutionContext } from "@nestjs/common"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { TodosController } from "./todos.controller"
import { TodosService } from "./todos.service"

describe("authenticated todo HTTP boundary", () => {
  it("uses only authenticated ownership and rejects user-controlled or invalid fields", async () => {
    const calls: unknown[] = []
    const service = {
      list: async (user: string, input: unknown) => { calls.push({ user, input }); return { items: [], nextOffset: null } },
      create: async (user: string, input: unknown) => { calls.push({ user, input }); return { id: "todo", version: 1 } },
    }
    const module = await Test.createTestingModule({ controllers: [TodosController], providers: [{ provide: TodosService, useValue: service }] })
      .overrideGuard(UserAuthGuard).useValue({ canActivate(context: ExecutionContext) { context.switchToHttp().getRequest().user = { id: "owner" }; return true } }).compile()
    const app = module.createNestApplication()
    await app.init()
    try {
      await request(app.getHttpServer()).get("/api/todos").expect(200, { items: [], nextOffset: null })
      await request(app.getHttpServer()).post("/api/todos").send({ title: "测试", userId: "other", clientRequestId: "00000000-0000-4000-8000-000000000001" }).expect(400)
      await request(app.getHttpServer()).get("/api/todos?limit=101").expect(400)
      expect(calls).toEqual([{ user: "owner", input: { filter: "pending", offset: 0, limit: 50 } }])
    } finally { await app.close() }
  })
})
