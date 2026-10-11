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
    expect(init.headers).toEqual({ "Content-Type": "application/json" })
  })
  it("rejects malformed locators without any network call", async () => {
    const { account, service } = harness()
    await expect(service.get({ reference: "synapse://todos/x?delete=1" })).rejects.toThrow()
    expect(account.fetchAuthenticated).not.toHaveBeenCalled()
  })
})
