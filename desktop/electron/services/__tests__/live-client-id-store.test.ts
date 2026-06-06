import { describe, expect, it, vi } from "vitest"
import { LiveClientIdStore } from "../live-client-id-store"

describe("LiveClientIdStore", () => {
  it("reuses an existing client instance id", async () => {
    const namespace = {
      getSingleton: vi.fn().mockResolvedValue({ clientInstanceId: "client-existing" }),
      setSingleton: vi.fn(),
    }
    const store = new LiveClientIdStore({ namespace: namespace as never, createId: () => "client-new" })

    await expect(store.getOrCreate()).resolves.toBe("client-existing")
    expect(namespace.setSingleton).not.toHaveBeenCalled()
  })

  it("creates and stores a new client instance id", async () => {
    const namespace = {
      getSingleton: vi.fn().mockResolvedValue(null),
      setSingleton: vi.fn().mockResolvedValue(undefined),
    }
    const store = new LiveClientIdStore({ namespace: namespace as never, createId: () => "client-new" })

    await expect(store.getOrCreate()).resolves.toBe("client-new")
    expect(namespace.setSingleton).toHaveBeenCalledWith({ clientInstanceId: "client-new" })
  })
})
