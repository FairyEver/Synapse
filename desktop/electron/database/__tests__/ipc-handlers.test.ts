import { beforeEach, describe, expect, it, vi } from "vitest"

import { DATABASE_IPC_CHANNELS } from "../channels"

const mocks = vi.hoisted(() => ({
  databaseService: {
    databaseRowDelete: vi.fn(),
    databaseRowUpdate: vi.fn(),
    recordOperation: vi.fn(),
  },
  handlers: new Map<string, (event: unknown, params: unknown) => unknown>(),
  handleValidatedIpc: vi.fn((channel: string, handler: (event: unknown, params: unknown) => unknown) => {
    mocks.handlers.set(channel, handler)
  }),
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}))

vi.mock("../service", () => ({
  databaseService: mocks.databaseService,
}))

vi.mock("../../ipc/validated-ipc", () => ({
  handleValidatedIpc: mocks.handleValidatedIpc,
}))

vi.mock("../http-server", () => ({
  getHttpPort: vi.fn(() => 0),
}))

vi.mock("../mcp-installer", () => ({
  getMcpServers: vi.fn(() => []),
  getMcpStatus: vi.fn(() => ({ registered: false })),
  openMcpSettings: vi.fn(),
  registerMcp: vi.fn(),
}))

vi.mock("../mcp-server", () => ({
  getMcpServerPort: vi.fn(() => 0),
  getMcpServerUrl: vi.fn(() => null),
  isMcpServerRunning: vi.fn(() => false),
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
  }),
}))

describe("database IPC handlers", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.handlers.clear()
    mocks.handleValidatedIpc.mockClear()
    mocks.databaseService.databaseRowDelete.mockReset()
    mocks.databaseService.databaseRowUpdate.mockReset()
    mocks.databaseService.recordOperation.mockReset()
  })

  it("records the affected count returned by single-row update and delete", async () => {
    const { registerDatabaseHandlers } = await import("../ipc-handlers")
    registerDatabaseHandlers()
    mocks.databaseService.databaseRowUpdate.mockReturnValueOnce({ affected: 0 })
    mocks.databaseService.databaseRowDelete.mockReturnValueOnce({ affected: 0 })

    await mocks.handlers.get(DATABASE_IPC_CHANNELS.databaseRowUpdate)?.({}, {
      data: { title: "Done" },
      id: 10,
      table: "tasks",
    })
    await mocks.handlers.get(DATABASE_IPC_CHANNELS.databaseRowDelete)?.({}, {
      id: 10,
      table: "tasks",
    })

    expect(mocks.databaseService.recordOperation).toHaveBeenCalledWith({
      source: "ipc",
      action: "database.row.update",
      table: "tasks",
      affected: 0,
    })
    expect(mocks.databaseService.recordOperation).toHaveBeenCalledWith({
      source: "ipc",
      action: "database.row.delete",
      table: "tasks",
      affected: 0,
    })
  })
})
