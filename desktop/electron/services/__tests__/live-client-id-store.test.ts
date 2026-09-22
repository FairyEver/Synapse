import { describe, expect, it, vi } from "vitest"
import { LiveClientIdStore } from "../live-client-id-store"

describe("LiveClientIdStore", () => {
  function memoryStore(initial: Record<string, unknown> | null) {
    let record = initial
    return {
      getSingleton: vi.fn(async () => record),
      setSingleton: vi.fn(async (value: Record<string, unknown>) => { record = value }),
    }
  }

  it("binds a legacy installation without changing its id, then rotates once after migration", async () => {
    const namespace = memoryStore({ clientInstanceId: "old", deviceName: "公司电脑" })
    const readMachineFingerprint = vi.fn().mockResolvedValue("machine-a")
    const createId = vi.fn(() => "new")
    const store = new LiveClientIdStore({ namespace: namespace as never, createId, readMachineFingerprint })
    expect(await store.getOrCreate()).toBe("old")
    expect(store.getMachineFingerprint()).toBe("machine-a")
    readMachineFingerprint.mockResolvedValue("machine-b")
    expect(await store.getOrCreate()).toBe("new")
    expect(await store.getOrCreate()).toBe("new")
    expect(createId).toHaveBeenCalledTimes(1)
    expect(await store.getDeviceName()).toBe("公司电脑")
  })

  it("keeps the id and stored binding when lookup fails, without claiming the old hardware is current", async () => {
    const namespace = memoryStore({ clientInstanceId: "old", machineFingerprint: "machine-a" })
    const store = new LiveClientIdStore({ namespace: namespace as never, readMachineFingerprint: async () => null })
    expect(await store.getOrCreate()).toBe("old")
    expect(store.getMachineFingerprint()).toBeNull()
    expect(namespace.setSingleton).not.toHaveBeenCalled()
  })

  it("serializes naming and identity writes so neither is lost", async () => {
    const namespace = memoryStore(null)
    const store = new LiveClientIdStore({ namespace: namespace as never, createId: () => "id", readMachineFingerprint: async () => "machine-a" })
    await Promise.all([store.getOrCreate(), store.setDeviceName("家里电脑")])
    expect(await namespace.getSingleton()).toEqual({ clientInstanceId: "id", machineFingerprint: "machine-a", deviceName: "家里电脑" })
    expect(await store.getDeviceName()).toBe("家里电脑")
  })

  it("propagates persistence failures and allows a later retry", async () => {
    const namespace = memoryStore(null)
    namespace.setSingleton.mockRejectedValueOnce(new Error("disk full"))
    const store = new LiveClientIdStore({ namespace: namespace as never, createId: () => "id" })
    await expect(store.getOrCreate()).rejects.toThrow("disk full")
    await expect(store.getOrCreate()).resolves.toBe("id")
  })
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

  it("replaces an existing client instance id and keeps the rest of the record", async () => {
    const namespace = {
      getSingleton: vi.fn().mockResolvedValue({ clientInstanceId: "client-existing", note: "kept" }),
      setSingleton: vi.fn().mockResolvedValue(undefined),
    }
    const store = new LiveClientIdStore({ namespace: namespace as never, createId: () => "client-new" })

    await expect(store.reissue()).resolves.toBe("client-new")
    expect(namespace.setSingleton).toHaveBeenCalledWith({
      clientInstanceId: "client-new",
      note: "kept",
    })
  })
})
