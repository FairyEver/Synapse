import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { type ExecutionContext, Module, NotFoundException, UnauthorizedException } from "@nestjs/common"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { TodosController } from "./todos.controller"
import { TodosService } from "./todos.service"
import { TodosModule } from "./todos.module"

// Run the production route middleware with isolated service/guard fixtures.
@Module({ imports: [], controllers: [TodosController], providers: [{ provide: TodosService, useValue: {
  list: async () => ({ items: [], nextOffset: null }), get: async () => { throw new NotFoundException() },
} }] })
class TodoHttpTestModule extends TodosModule {}

describe("authenticated todo HTTP boundary", () => {
  it("prevents caching of every Todo success, validation, ownership and authentication response", async () => {
    let authenticated = true
    const fixture = await Test.createTestingModule({ imports: [TodoHttpTestModule] }).overrideGuard(UserAuthGuard).useValue({ canActivate(context: ExecutionContext) {
      if (!authenticated) throw new UnauthorizedException()
      context.switchToHttp().getRequest().user = { id: "owner" }; return true
    } }).compile()
    const app = fixture.createNestApplication()
    await app.init()
    try {
      await request(app.getHttpServer()).get("/api/todos").expect(200).expect("Cache-Control", "private, no-store")
      await request(app.getHttpServer()).get("/api/todos/missing").expect(404).expect("Cache-Control", "private, no-store")
      await request(app.getHttpServer()).get("/api/todos?limit=101").expect(400).expect("Cache-Control", "private, no-store")
      for (const [method, path] of [["post", "/api/todos"], ["patch", "/api/todos/id"], ["patch", "/api/todos/id/completion"], ["delete", "/api/todos/id"]] as const) {
        await request(app.getHttpServer())[method](path).send({}).expect(400).expect("Cache-Control", "private, no-store")
      }
      authenticated = false
      await request(app.getHttpServer()).get("/api/todos").expect(401).expect("Cache-Control", "private, no-store")
    } finally { await app.close() }
  })
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
