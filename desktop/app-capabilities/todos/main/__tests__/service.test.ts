import { describe, expect, it, vi } from "vitest"
import { TodoCloudService } from "../service"
import { todoFixture } from "./fixtures"
function harness() {
  let beforeIdentityChange!: () => void
  let userId = "u"
  const account = {
    getState: () => ({ status: "authenticated" as const, connectivity: "online" as const, profile: { user: { id: userId, email: "u@test", handle: "u", status: "active" as const }, syncedAt: "" } }),
    fetchAuthenticated: vi.fn(async () => Response.json(todoFixture)),
    onBeforeIdentityChange: (listener: () => void) => { beforeIdentityChange = listener; return () => undefined },
  }
  const events = { emit: vi.fn() }
  const service = new TodoCloudService({ account, eventBus: events as never })
  return { account, service, events, reset: () => beforeIdentityChange(), setUser: (id: string) => { userId = id } }
}
describe("TodoCloudService", () => {
  it.each(["u", "other-user"])("rejects late results after logout/relogin as %s", async (userId) => {
    const { account, service, reset, events, setUser } = harness()
    let release!: (response: Response) => void
    account.fetchAuthenticated.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = service.get({ id: "todo-1" })
    const rejected = expect(pending).rejects.toMatchObject({ code: "TODO_IDENTITY_CHANGED" })
    reset()
    setUser(userId)
    release(Response.json(todoFixture))
    await rejected
    expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({ domain: "account", type: "todos.reset" }))
  })
  it("distinguishes missing server endpoint from missing item and preserves conflicts", async () => {
    const { account, service } = harness()
    account.fetchAuthenticated.mockRejectedValueOnce(Object.assign(new Error("missing"), { status: 404 }))
    await expect(service.list({})).rejects.toMatchObject({ status: 404, code: "TODO_SERVER_UNSUPPORTED" })
    account.fetchAuthenticated.mockRejectedValueOnce(Object.assign(new Error("missing"), { status: 404 }))
    await expect(service.get({ id: "todo-1" })).rejects.toMatchObject({ status: 404, code: "TODO_UNAVAILABLE" })
    account.fetchAuthenticated.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409, code: "TODO_VERSION_CONFLICT" }))
    await expect(service.update("todo-1", { title: "新标题", expectedVersion: 1, clientRequestId: "32a7370b-3b19-4bd3-b3a5-99016bb2fc37" })).rejects.toMatchObject({ status: 409, code: "TODO_VERSION_CONFLICT" })
  })
  it("uses the authenticated client with an unchanged request UUID and no Authorization logic", async () => {
    const { account, service } = harness()
    const input = { title: "事项", clientRequestId: "32a7370b-3b19-4bd3-b3a5-99016bb2fc37" }
    await service.create(input)
    const [url, init] = account.fetchAuthenticated.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/todos")
    expect(JSON.parse(String(init.body))).toEqual(input)
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-synapse-todo-priority": "1", "x-synapse-todo-images": "1" })
  })
  it("forwards priority pagination and accepts a negotiated response", async () => {
    const { account, service } = harness()
    const page = { items: [{ ...todoFixture, priority: "high" }], nextOffset: 3 }
    account.fetchAuthenticated.mockResolvedValueOnce(Response.json(page))
    expect(await service.list({ priority: "high", sort: "priority", offset: 2, limit: 1 })).toEqual(page)
    const [url, init] = account.fetchAuthenticated.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain("priority=high&sort=priority&offset=2&limit=1")
    expect(init.headers).toEqual({ "x-synapse-todo-priority": "1", "x-synapse-todo-images": "1" })
  })
  it("sends image bytes without JSON and reads only the authenticated todo image route", async () => {
    const { account, service } = harness()
    const imageId = "00000000-0000-4000-8000-000000000011"
    account.fetchAuthenticated.mockResolvedValueOnce(Response.json({ imageId }))
    await expect(service.stageImage({ imageId, original: new Uint8Array([1, 2]), thumbnail: new Uint8Array([3]) })).resolves.toEqual({ imageId })
    const [url, init] = account.fetchAuthenticated.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/todos/images/${imageId}`)
    expect(init.headers).toEqual({ "Content-Type": "application/octet-stream", "x-synapse-todo-thumbnail-size": "1" })
    expect(Array.from(init.body as Uint8Array)).toEqual([1, 2, 3])
    account.fetchAuthenticated.mockResolvedValueOnce(new Response(new Uint8Array([3]), { headers: { "Content-Type": "image/webp" } }))
    await expect(service.readImage({ todoId: "todo-1", imageId, variant: "thumbnail" })).resolves.toEqual({ bytes: new Uint8Array([3]), mimeType: "image/webp" })
    expect(account.fetchAuthenticated).toHaveBeenLastCalledWith(`/todos/todo-1/images/${imageId}/thumbnail`, expect.objectContaining({ method: "GET" }), expect.any(String))
  })
  it("rejects malformed locators without any network call", async () => {
    const { account, service } = harness()
    await expect(service.get({ reference: "synapse://todos/x?delete=1" })).rejects.toThrow()
    expect(account.fetchAuthenticated).not.toHaveBeenCalled()
  })
})
