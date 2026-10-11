import "reflect-metadata"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TodoRepository } from "../src/todos/todo.repository"
import { TodosService } from "../src/todos/todos.service"

describe("todo PostgreSQL commit and ownership", () => {
  let prisma: PrismaClient
  let service: TodosService
  let owner: string
  let other: string
  beforeAll(async () => {
    if (!process.env.TODOS_E2E_DATABASE_URL) throw new Error("TODOS_E2E_DATABASE_URL is required")
    prisma = new PrismaClient({ datasources: { db: { url: process.env.TODOS_E2E_DATABASE_URL } } })
    await prisma.$connect()
    service = new TodosService(new TodoRepository(prisma as never))
    const suffix = randomUUID()
    owner = (await prisma.user.create({ data: { email: suffix + "@todo.invalid", handle: suffix, nickname: "测试", passwordHash: "test-only" } })).id
    other = (await prisma.user.create({ data: { email: suffix + "-other@todo.invalid", handle: suffix + "-other", nickname: "测试", passwordHash: "test-only" } })).id
  })
  afterAll(async () => {
    if (prisma) { await prisma.user.deleteMany({ where: { id: { in: [owner, other].filter(Boolean) } } }); await prisma.$disconnect() }
  })
  it("commit_then_lost_response_retry creates exactly one row and receipt", async () => {
    const input = { title: "丢失响应", clientRequestId: randomUUID() }
    const committed = await service.create(owner, input)
    const replay = await service.create(owner, input)
    expect(replay).toEqual(committed)
    expect(await prisma.todoItem.count({ where: { userId: owner, createRequestId: input.clientRequestId } })).toBe(1)
    await expect(service.create(owner, { ...input, title: "另一内容" })).rejects.toMatchObject({ status: 409 })
  })
  it("two_writers_one_version commits only one real concurrent update", async () => {
    const item = await service.create(owner, { title: "版本竞争", clientRequestId: randomUUID() })
    const outcomes = await Promise.allSettled(["甲", "乙"].map((title) => service.update(owner, item.id, { title, expectedVersion: 1, clientRequestId: randomUUID() })))
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1)
    const rejected = outcomes.find((x) => x.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason.getResponse().code).toBe("TODO_VERSION_CONFLICT")
    expect((await service.get(owner, item.id)).version).toBe(2)
  })
  it("treats equivalent normalized creation content as the same request", async () => {
    const input = { title: " 规范内容 ", clientRequestId: randomUUID() }
    const item = await service.create(owner, input)
    expect(await service.create(owner, { ...input, title: "规范内容", note: null, dueAt: null, reminder: "none", offsetMinutes: null, remindAt: null })).toEqual(item)
  })
  it("foreign and deleted records have the same inaccessible result", async () => {
    const item = await service.create(owner, { title: "权限", clientRequestId: randomUUID() })
    await expect(service.get(other, item.id)).rejects.toMatchObject({ status: 404 })
    await expect(service.update(other, item.id, { title: "修改", expectedVersion: 1, clientRequestId: randomUUID() })).rejects.toMatchObject({ status: 404 })
    await service.delete(owner, item.id, { expectedVersion: 1, clientRequestId: randomUUID() })
    await expect(service.get(owner, item.id)).rejects.toMatchObject({ status: 404 })
  })
  it("create_key_survives_receipt_cleanup and pagination matches literal percent", async () => {
    const input = { title: "百分号%事项", clientRequestId: randomUUID() }
    const item = await service.create(owner, input)
    await prisma.todoMutationReceipt.deleteMany({ where: { userId: owner, clientRequestId: input.clientRequestId } })
    expect((await service.create(owner, input)).id).toBe(item.id)
    const page = await service.list(owner, { query: "%" })
    expect(page.items.map((x) => x.id)).toEqual([item.id])
    expect(page.nextOffset).toBeNull()
  })
  it("stable_page_order keeps due ascending, no due last, and completion descending", async () => {
    const query = randomUUID()
    const later = await service.create(owner, { title: query, dueAt: "2026-10-13T01:00:00Z", clientRequestId: randomUUID() })
    const earlier = await service.create(owner, { title: query, dueAt: "2026-10-12T01:00:00Z", clientRequestId: randomUUID() })
    const noDate = await service.create(owner, { title: query, clientRequestId: randomUUID() })
    expect((await service.list(owner, { query })).items.map((x) => x.id)).toEqual([earlier.id, later.id, noDate.id])
    await service.setCompleted(owner, earlier.id, { completed: true, expectedVersion: 1, clientRequestId: randomUUID() })
    expect((await service.list(owner, { filter: "all", query })).items.map((x) => x.id)).toEqual([later.id, noDate.id, earlier.id])
  })
})
