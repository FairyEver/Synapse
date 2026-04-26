import { describe, expect, it, vi } from "vitest"

import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import { connectorsIpcModule } from "../ipc"

describe("connectorsIpcModule", () => {
  it("routes Feishu IPC calls to FeishuConnectorService", async () => {
    const service = {
      getStatus: vi.fn().mockResolvedValue({
        projectId: "project-1",
        configured: true,
        running: false,
        connector: {
          id: "feishu:project-1",
          projectId: "project-1",
          platform: "feishu",
          appId: "cli_a",
          status: "disabled",
          allowlist: { mode: "all" },
          sessionKeyPolicy: { mode: "per-user" },
        },
      }),
      beginSetup: vi.fn(),
      pollSetup: vi.fn(),
      saveSetup: vi.fn(),
      saveManualCredentials: vi.fn(),
      startProject: vi.fn(),
      stopProject: vi.fn(),
      list: vi.fn(),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.feishu-connector") return service as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(connectorsIpcModule, { moduleId: "connectors", resolve })

    const result = await harness.invoke("synapse:connectors:feishu:get-status", {
      projectId: "project-1",
    })

    expect(service.getStatus).toHaveBeenCalledWith("project-1")
    expect(result).toEqual(expect.objectContaining({
      projectId: "project-1",
      configured: true,
      running: false,
    }))
  })
})
