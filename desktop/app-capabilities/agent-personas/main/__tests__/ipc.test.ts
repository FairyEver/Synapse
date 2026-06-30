import { describe, expect, it, vi } from "vitest"
import { agentPersonasIpcModule } from "../ipc"

describe("agentPersonasIpcModule", () => {
  it("registers agent persona channels", () => {
    expect(agentPersonasIpcModule.methods.list.channel).toBe("synapse:agent-personas:list")
    expect(agentPersonasIpcModule.methods.create.channel).toBe("synapse:agent-personas:create")
    expect(agentPersonasIpcModule.methods.update.channel).toBe("synapse:agent-personas:update")
    expect(agentPersonasIpcModule.methods.delete.channel).toBe("synapse:agent-personas:delete")
    expect(agentPersonasIpcModule.events.changed.channel).toBe("synapse:agent-personas:changed")
  })

  it("dispatches list through the core service", async () => {
    const service = {
      events: { on: vi.fn() },
      list: vi.fn(async () => []),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.agent-personas") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }

    await expect(agentPersonasIpcModule.methods.list.handler(ctx as never, undefined))
      .resolves.toEqual([])
    expect(service.list).toHaveBeenCalled()
  })
})
