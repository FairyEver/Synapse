import { describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
import { appsIpcModule } from "../ipc"

const systemAppWindowServiceMock = vi.hoisted(() => ({
  open: vi.fn(async () => undefined),
}))
const createDefaultSystemAppWindowServiceMock = vi.hoisted(() =>
  vi.fn(() => systemAppWindowServiceMock),
)

vi.mock("../../../services/system-app-window-service", () => ({
  createDefaultSystemAppWindowService: createDefaultSystemAppWindowServiceMock,
}))

describe("appsIpcModule", () => {
  it("declares open system app channel", () => {
    expect(appsIpcModule.id).toBe("apps")
    expect(appsIpcModule.methods.openSystemApp.channel).toBe("synapse:apps:open-system-app")
  })

  it("validates app ids and opens a valid app", async () => {
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "database" }).success).toBe(true)
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "document-template" }).success).toBe(true)
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "missing" }).success).toBe(false)

    const windowManager = {}

    await appsIpcModule.methods.openSystemApp.handler(createContext(windowManager), { appId: "database" })

    expect(createDefaultSystemAppWindowServiceMock).toHaveBeenCalledWith(windowManager)
    expect(systemAppWindowServiceMock.open).toHaveBeenCalledWith("database", undefined)
  })

  it("passes optional content open requests through", async () => {
    const contentOpenRequest = {
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    }

    await appsIpcModule.methods.openSystemApp.handler(createContext({}), {
      appId: "resource-repository",
      options: { contentOpenRequest },
    })

    expect(systemAppWindowServiceMock.open).toHaveBeenCalledWith("resource-repository", {
      contentOpenRequest,
    })
  })
})

function createContext(windowManager: unknown): IpcHandlerContext {
  const resolve = <T,>(serviceId: string): T => {
    if (serviceId === "core.window-manager") return windowManager as T
    throw new Error(`Unexpected service id: ${serviceId}`)
  }

  return {
    moduleId: "apps",
    resolve,
  }
}
