import { describe, expect, it, vi } from "vitest"
import { appsIpcModule } from "../ipc"

const systemAppWindowServiceMock = vi.hoisted(() => ({
  open: vi.fn(async () => undefined),
}))

vi.mock("../../../services/system-app-window-service", () => ({
  systemAppWindowService: systemAppWindowServiceMock,
}))

describe("appsIpcModule", () => {
  it("declares open system app channel", () => {
    expect(appsIpcModule.id).toBe("apps")
    expect(appsIpcModule.methods.openSystemApp.channel).toBe("synapse:apps:open-system-app")
  })

  it("validates app ids and opens a valid app", async () => {
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "database" }).success).toBe(true)
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "missing" }).success).toBe(false)

    await appsIpcModule.methods.openSystemApp.handler({} as never, { appId: "database" })

    expect(systemAppWindowServiceMock.open).toHaveBeenCalledWith("database", undefined)
  })

  it("passes optional content open requests through", async () => {
    const contentOpenRequest = {
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    }

    await appsIpcModule.methods.openSystemApp.handler({} as never, {
      appId: "resource-repository",
      options: { contentOpenRequest },
    })

    expect(systemAppWindowServiceMock.open).toHaveBeenCalledWith("resource-repository", {
      contentOpenRequest,
    })
  })
})
