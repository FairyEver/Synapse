import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.2.355",
    isPackaged: false,
  },
  Notification: class {
    static isSupported() {
      return false
    }
  },
}))

vi.mock("electron-updater", () => ({
  autoUpdater: {},
  CancellationToken: class {},
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../../../generated/deployment-config.generated", () => ({
  SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG: {
    apiBaseUrl: "https://desktop.example.test/api",
  },
}))

import { updateService } from "../../../services/update-service"
import { updateIpcModule } from "../ipc"

const ipcContext = {
  moduleId: "update-test",
  resolve: <T>() => undefined as T,
}

describe("update IPC pending open requests", () => {
  it("keeps the latest request when an older request is acknowledged late", async () => {
    const first = updateService.publishUpdateOpenRequest(false)
    const second = updateService.publishUpdateOpenRequest(true)

    await updateIpcModule.methods.acknowledgeOpenRequest.handler(ipcContext, { id: first.id })
    await expect(
      updateIpcModule.methods.getPendingOpenRequest.handler(ipcContext, undefined),
    ).resolves.toEqual(second)

    await updateIpcModule.methods.acknowledgeOpenRequest.handler(ipcContext, { id: second.id })
    await expect(
      updateIpcModule.methods.getPendingOpenRequest.handler(ipcContext, undefined),
    ).resolves.toBeNull()
  })
})
