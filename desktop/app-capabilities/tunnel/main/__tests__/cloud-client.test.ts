import { describe, expect, it, vi } from "vitest"
import { TunnelCloudClient } from "../cloud-client"
import { fakeAccount } from "./fixtures"
describe("tunnel cloud identity boundary", () => {
  it("rejects responses arriving after an account change", async () => {
    const account = fakeAccount()
    let resolve!: (response: Response) => void
    account.fetchAuthenticated = vi.fn(() => new Promise<Response>(done => { resolve = done }))
    const cloud = new TunnelCloudClient(account)
    const result = cloud.list({})
    const rejected = expect(result).rejects.toMatchObject({ code: "TUNNEL_IDENTITY_CHANGED" })
    await account.changeOwner("other")
    resolve(new Response(JSON.stringify({ items: [], total: 0, nextOffset: null })))
    await rejected
    cloud.dispose()
  })
  it("does not return the device key or token in errors", async () => {
    const account = fakeAccount()
    account.fetchAuthenticated = vi.fn(async () => new Response(JSON.stringify({ code: "TUNNEL_DEVICE_CONFLICT", message: "secret=" + "s".repeat(43) }), { status: 409 }))
    const cloud = new TunnelCloudClient(account)
    const error = await cloud.register({ clientInstanceId: "d", key: "s".repeat(43) }).catch(e => e)
    expect(String(error)).not.toContain("s".repeat(43))
    cloud.dispose()
  })
})
