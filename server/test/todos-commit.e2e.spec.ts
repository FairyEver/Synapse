import "reflect-metadata"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TodoRepository } from "../src/todos/todo.repository"
import { TodosService } from "../src/todos/todos.service"
import { todoRequestHash } from "../src/todos/todo-idempotency"
import { TodoImageService } from "../src/todos/todo-image.service"

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
  it("filters and sorts optional priority before paging, preserving date ties and completed ordering", async () => {
    const query = randomUUID()
    const make = (priority: "high" | "medium" | "low" | null, day: number) => service.create(owner, {
      title: query, priority, dueAt: `2026-10-${day}T01:00:00Z`, clientRequestId: randomUUID(),
    })
    const unassigned = await make(null, 11)
    const low = await make("low", 12)
    const medium = await make("medium", 13)
    const highLater = await make("high", 16)
    const highEarlier = await make("high", 15)
    const completedHigh = await make("high", 14)
    await service.setCompleted(owner, completedHigh.id, { completed: true, expectedVersion: 1, clientRequestId: randomUUID() })
    expect((await service.list(owner, { query, limit: 2 })).items.map((item) => item.id)).toEqual([unassigned.id, low.id])
    const sorted = { query, filter: "all", sort: "priority", limit: 2 } as const
    const first = await service.list(owner, sorted)
    expect(first.items.map((item) => item.id)).toEqual([highEarlier.id, highLater.id])
    expect(first.nextOffset).toBe(2)
    expect((await service.list(owner, { ...sorted, offset: 2 })).items.map((item) => item.id)).toEqual([medium.id, low.id])
    expect((await service.list(owner, { ...sorted, offset: 4 })).items.map((item) => item.id)).toEqual([unassigned.id, completedHigh.id])
    expect((await service.list(owner, { query, priority: "medium", limit: 1 })).items.map((item) => item.id)).toEqual([medium.id])
    const renamed = await service.update(owner, medium.id, { title: query + "修改", expectedVersion: 1, clientRequestId: randomUUID() })
    expect(renamed.priority).toBe("medium")
    const clear = { priority: null, expectedVersion: renamed.version, clientRequestId: randomUUID() }
    const cleared = await service.update(owner, medium.id, clear)
    expect(cleared).toMatchObject({ priority: null, version: renamed.version + 1, reminderGeneration: medium.reminderGeneration })
    expect(await service.update(owner, medium.id, clear)).toEqual(cleared)
    expect((await service.list(owner, { query, priority: "none" })).items.map((item) => item.id)).toEqual([unassigned.id, medium.id])
  })
  it("retries a legacy create hash after the optional priority column is added", async () => {
    const clientRequestId = randomUUID()
    const input = { title: "旧客户端重试", clientRequestId, note: null, dueAt: null, reminder: "none" as const, offsetMinutes: null, remindAt: null }
    const old = await prisma.todoItem.create({ data: { userId: owner, title: input.title, createRequestId: clientRequestId, createRequestHash: todoRequestHash("create", null, input) } })
    const replay = await service.create(owner, { ...input, priority: null })
    expect(replay).toMatchObject({ id: old.id, priority: null })
    await expect(service.create(owner, { ...input, priority: "high" })).rejects.toMatchObject({ status: 409 })
  })

  it("stages image pairs, binds them atomically, and hides them after removal or across owners", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex")
    const thumbnail = Buffer.from("RIFF0000WEBP")
    const objects = new Map<string, Buffer>()
    let failThumbnail = true
    const images = new TodoImageService(prisma as never, {
      async putObject(key: string, bytes: Buffer) {
        if (failThumbnail && key.endsWith("/thumbnail")) { failThumbnail = false; throw new Error("upload interrupted") }
        objects.set(key, bytes)
      },
      async getObjectStream(key: string) { return { stream: Readable.from([objects.get(key)!]) } },
      async deleteObject(key: string) { objects.delete(key) },
    } as never)
    const imageId = randomUUID()
    await expect(images.stage(owner, imageId, png, thumbnail)).rejects.toMatchObject({ status: 503 })
    const input = { title: "图片待办", imageIds: [imageId], clientRequestId: randomUUID() }
    await expect(service.create(owner, input)).rejects.toMatchObject({ status: 400 })
    expect(await prisma.todoItem.count({ where: { userId: owner, createRequestId: input.clientRequestId } })).toBe(0)
    await images.stage(owner, imageId, png, thumbnail)
    await expect(images.stage(other, imageId, png, thumbnail)).rejects.toMatchObject({ status: 404 })
    await expect(service.create(other, input)).rejects.toMatchObject({ status: 400 })
    const created = await service.create(owner, input)
    expect(created.imageIds).toEqual([imageId])
    expect(await service.create(owner, input)).toEqual(created)
    expect((await service.list(owner, { query: "图片待办" })).items[0]?.imageIds).toEqual([imageId])
    await expect(images.open(other, created.id, imageId, "original")).rejects.toMatchObject({ status: 404 })
    await expect(images.open(owner, "wrong-todo", imageId, "thumbnail")).rejects.toMatchObject({ status: 404 })
    expect(await images.open(owner, created.id, imageId, "thumbnail")).toMatchObject({ mimeType: "image/webp", byteSize: thumbnail.length })
    expect(await images.open(owner, created.id, imageId, "original")).toMatchObject({ mimeType: "image/png", byteSize: png.length })
    const renamed = await service.update(owner, created.id, { title: "修改标题", expectedVersion: created.version, clientRequestId: randomUUID() })
    expect(renamed.imageIds).toEqual([imageId])
    const cleared = await service.update(owner, created.id, { imageIds: [], expectedVersion: renamed.version, clientRequestId: randomUUID() })
    expect(cleared.version).toBe(renamed.version + 1)
    await expect(images.open(owner, created.id, imageId, "thumbnail")).rejects.toMatchObject({ status: 404 })
    await images.prune()
    expect(objects.size).toBe(0)
    expect(await prisma.todoImage.findUnique({ where: { id: imageId } })).toBeNull()
  })
})
