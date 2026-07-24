import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
import { appsIpcModule } from "../ipc"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "../../../../src/lib/cheat-codes/names"

const systemAppWindowServiceMock = vi.hoisted(() => ({
  open: vi.fn(async () => undefined),
}))
const createDefaultSystemAppWindowServiceMock = vi.hoisted(() =>
  vi.fn(() => systemAppWindowServiceMock),
)
const cheatCodeStateServiceMock = vi.hoisted(() => ({
  getStates: vi.fn(async () => ({})),
}))

vi.mock("../../../services/system-app-window-service", () => ({
  createDefaultSystemAppWindowService: createDefaultSystemAppWindowServiceMock,
}))

describe("appsIpcModule", () => {
  beforeEach(() => {
    systemAppWindowServiceMock.open.mockClear()
    createDefaultSystemAppWindowServiceMock.mockClear()
    cheatCodeStateServiceMock.getStates.mockReset()
    cheatCodeStateServiceMock.getStates.mockResolvedValue({})
  })

  it("declares open system app channel", () => {
    expect(appsIpcModule.id).toBe("apps")
    expect(appsIpcModule.methods.openSystemApp.operationId).toBe("app.apps.system_app.open")
  })

  it("validates app ids and opens a valid app", async () => {
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "database" }).success).toBe(true)
    for (const removedAppId of [
      "document-template",
      "text-extractor",
      "file-opener",
      "text-file-writer",
      "html-generator",
      "json-repair",
      "skill-installer",
      "skill-uninstaller",
      "rule-installer",
      "sound-notifier",
      "system-notifier",
    ]) {
      expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: removedAppId }).success)
        .toBe(false)
    }
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

  it("rejects direct workflow windows while the workflow entry is hidden", async () => {
    cheatCodeStateServiceMock.getStates.mockResolvedValue({ [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: false })

    await expect(
      appsIpcModule.methods.openSystemApp.handler(createContext({}), { appId: "workflow" }),
    ).rejects.toThrow("工作流入口未启用")

    expect(systemAppWindowServiceMock.open).not.toHaveBeenCalled()
  })

  it("opens direct workflow windows when the workflow entry is visible", async () => {
    cheatCodeStateServiceMock.getStates.mockResolvedValue({ [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: true })

    await appsIpcModule.methods.openSystemApp.handler(createContext({}), { appId: "workflow" })

    expect(systemAppWindowServiceMock.open).toHaveBeenCalledWith("workflow", undefined)
  })
})

function createContext(windowManager: unknown): IpcHandlerContext {
  const resolve = <T,>(serviceId: string): T => {
    if (serviceId === "core.window-manager") return windowManager as T
    if (serviceId === "core.cheat-code-state") return cheatCodeStateServiceMock as T
    throw new Error(`Unexpected service id: ${serviceId}`)
  }

  return {
    moduleId: "apps",
    resolve,
  }
}
