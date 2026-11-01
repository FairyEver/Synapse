import "reflect-metadata"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudTableService, type CloudActor } from "./cloud-table.service"
import type { CloudTableDatabase } from "./cloud-table-database"
import { cloudTableConfig } from "./cloud-table-config"

const services: CloudTableService[] = []
afterEach(() => services.splice(0).forEach(service => service.onModuleDestroy()))
function setup() {
  const users = [{ id: "member", handle: "alice", nickname: "小明" }]
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ status: "active" }]),
    cloudTable: { findUnique: vi.fn().mockResolvedValue({ id: "table", ownerId: "owner", anonymous: {}, members: [], deletedAt: null }) },
    user: { findUnique: vi.fn().mockResolvedValue({ status: "active" }), findMany: vi.fn().mockResolvedValue(users) },
    cloudTableOperationLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const db = { config: cloudTableConfig(), transaction: (work: (client: typeof tx) => unknown) => work(tx) } as unknown as CloudTableDatabase
  const service = new CloudTableService(db); services.push(service)
  const search = (query: unknown, actor: CloudActor = { userId: "owner", console: true }) => service.execute(actor, "table", "member.search", { query }, { requestId: "search" })
  return { tx, users, search }
}
describe("cloud table collaborator search", () => {
  it.each(["alice@example.test", "Alice", "小明"])("matches %s against account email, handle and nickname", async term => {
    const { tx, users, search } = setup()
    await expect(search(` ${term} `)).resolves.toEqual({ data: users, hasMore: false })
    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: { status: "active", id: { not: "owner" }, OR: ["email", "handle", "nickname"].map(field => ({ [field]: { contains: term, mode: "insensitive" } })) },
      select: { id: true, handle: true, nickname: true }, orderBy: [{ handle: "asc" }, { id: "asc" }], take: 21,
    })
  })
  it("bounds results and indicates when a narrower search is needed", async () => {
    const { tx, search } = setup()
    tx.user.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ id: `u${i}`, handle: `user${i}`, nickname: "用户" })))
    await expect(search("user")).resolves.toMatchObject({ data: expect.any(Array), hasMore: true })
    expect((await search("user") as { data: unknown[] }).data).toHaveLength(20)
  })
  it("treats SQL pattern characters in an email or username as literal text", async () => {
    const { tx, search } = setup()
    await search("a_b%")
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ handle: { contains: "a\\_b\\%", mode: "insensitive" } }]) }) }))
  })
  it.each(["", " ", "x".repeat(321), null, 12])("rejects invalid query %s before looking up users", async query => {
    const { tx, search } = setup()
    await expect(search(query)).rejects.toMatchObject({ code: "INVALID_REQUEST" })
    expect(tx.user.findMany).not.toHaveBeenCalled()
  })
  it.each([{ userId: "other", console: true }, { userId: "owner", console: false }, { console: false }])("does not expose account search to non-owners or open API callers: %s", async actor => {
    const { tx, search } = setup()
    await expect(search("alice", actor)).rejects.toMatchObject({ statusCode: expect.any(Number) })
    expect(tx.user.findMany).not.toHaveBeenCalled()
  })
})
