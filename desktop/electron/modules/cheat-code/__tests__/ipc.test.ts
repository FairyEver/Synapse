import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc/registry"
import { cheatCodeIpcModule } from "../ipc"

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => logger,
}))

const service = {
  getStates: vi.fn(),
  setState: vi.fn(),
  toggleState: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  service.getStates.mockResolvedValue({ "settings:test": false })
  service.setState.mockResolvedValue({ active: true, name: "settings:test" })
  service.toggleState.mockResolvedValue({ active: true, name: "settings:test" })
})

describe("cheatCodeIpcModule", () => {
  it("returns canonical states", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:app:cheat_code:states:get", {
      names: ["settings:test"],
    })).resolves.toEqual({ "settings:test": false })

    expect(service.getStates).toHaveBeenCalledWith(["settings:test"])
    expect(logger.info).toHaveBeenCalledWith("Cheat code IPC get states requested.", {
      requestedCount: 1,
      allStates: false,
    })
  })

  it("sets and toggles state", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:app:cheat_code:state:set", {
      active: true,
      name: "settings:test",
    })).resolves.toEqual({ active: true, name: "settings:test" })
    await expect(harness.invoke("synapse:app:cheat_code:state:toggle", {
      name: "settings:test",
    })).resolves.toEqual({ active: true, name: "settings:test" })

    expect(service.setState).toHaveBeenCalledWith({ active: true, name: "settings:test" })
    expect(service.toggleState).toHaveBeenCalledWith("settings:test")
    expect(logger.info).toHaveBeenCalledWith("Cheat code IPC set state requested.", {
      name: "settings:test",
      active: true,
    })
    expect(logger.info).toHaveBeenCalledWith("Cheat code IPC toggle state requested.", {
      name: "settings:test",
    })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("sequence")
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  harness.registry.register(cheatCodeIpcModule, {
    moduleId: "cheat-code",
    resolve<T>(id: string): T {
      if (id === "core.cheat-code-state") {
        return service as T
      }
      throw new Error(`Unexpected service id: ${id}`)
    },
  })
  return harness
}
