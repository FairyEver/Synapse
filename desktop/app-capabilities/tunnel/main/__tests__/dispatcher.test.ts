import { describe, expect, it, vi } from "vitest"
import { createTunnelCapabilityDispatcher } from "../dispatcher"
import { tunnelIpcModule } from "../ipc"
describe("tunnel capability boundary", () => {
  it("registers exactly six strict management operations", () => {
    expect(Object.values(tunnelIpcModule.methods).map(m => m.operationId)).toEqual(["app.tunnel.mapping.list", "app.tunnel.mapping.get", "app.tunnel.mapping.create", "app.tunnel.mapping.update", "app.tunnel.mapping.set_enabled", "app.tunnel.mapping.delete"])
    expect(tunnelIpcModule.methods.create!.request.safeParse({ port: 3000, deviceKey: "forged" }).success).toBe(false)
    expect(tunnelIpcModule.methods.update!.request.safeParse({ id: "m1", port: 3000 }).success).toBe(false)
  })
  it("consumes pagination and denies the original actor before calling service", async () => {
    const list = vi.fn(async () => ({ items: [], total: 101, nextOffset: 40 })), check = vi.fn(async () => ({ allowed: true }))
    const d = createTunnelCapabilityDispatcher({ service: { list } as never, permissionGuard: { check } as never })
    expect(await d.dispatch("app.tunnel.mapping.list", { offset: 20, limit: 20 }, { actor: { kind: "agent", id: "agent" } })).toMatchObject({ ok: true, data: { nextOffset: 40 } })
    expect(list).toHaveBeenCalledWith({ offset: 20, limit: 20 })
    expect(check.mock.calls[0]).toMatchObject([{ actor: { kind: "agent", id: "agent" } }])
    check.mockResolvedValueOnce({ allowed: false })
    await expect(d.dispatch("app.tunnel.mapping.list", {}, {})).rejects.toThrow()
    expect(list).toHaveBeenCalledTimes(1)
  })
})
