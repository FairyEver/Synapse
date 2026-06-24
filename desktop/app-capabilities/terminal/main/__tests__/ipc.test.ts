import { describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"

import { createIpcRegistry, registeredIpcModules } from "../../../../electron/bootstrap/ipc-registry"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../../electron/runtime/window"
import type { TerminalService } from "../service"
import { terminalIpcModule } from "../ipc"

const electronDialogMock = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-terminal-ipc-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    getAppPath: () => "/tmp/synapse-test-app",
    isPackaged: false,
    on: () => {},
    once: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() {
      return []
    }
    static getFocusedWindow() {
      return null
    }
  },
  dialog: electronDialogMock,
  ipcMain: { handle: () => {}, on: () => {} },
  shell: {},
  Tray: class {},
  Menu: { buildFromTemplate: () => ({}) },
  Notification: class {
    static isSupported() {
      return false
    }
    on() {}
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: {},
}))

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: () => {},
    once: () => {},
    setFeedURL: () => {},
    checkForUpdates: () => Promise.resolve(null),
    downloadUpdate: () => Promise.resolve([]),
    quitAndInstall: () => {},
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    fullChangelog: false,
    forceDevUpdateConfig: false,
    logger: null,
  },
  CancellationToken: class {},
}))

describe("terminalIpcModule", () => {
  it("declares stable method and event channels", () => {
    expect(terminalIpcModule.id).toBe("terminal")
    expect(terminalIpcModule.methods.listGroups.channel).toBe("synapse:terminal:group:list")
    expect(terminalIpcModule.methods.createGroup.channel).toBe("synapse:terminal:group:create")
    expect(terminalIpcModule.methods.renameGroup.channel).toBe("synapse:terminal:group:rename")
    expect(terminalIpcModule.methods.updateGroupSettings.channel).toBe("synapse:terminal:group:update-settings")
    expect(terminalIpcModule.methods.chooseDefaultCwd.channel).toBe("synapse:terminal:group:choose-default-cwd")
    expect(terminalIpcModule.methods.deleteGroup.channel).toBe("synapse:terminal:group:delete")
    expect(terminalIpcModule.methods.listSessions.channel).toBe("synapse:terminal:session:list")
    expect(terminalIpcModule.methods.createSession.channel).toBe("synapse:terminal:session:create")
    expect(terminalIpcModule.methods.getSession.channel).toBe("synapse:terminal:session:get")
    expect(terminalIpcModule.methods.readSession.channel).toBe("synapse:terminal:session:read")
    expect(terminalIpcModule.methods.renameSession.channel).toBe("synapse:terminal:session:rename")
    expect(terminalIpcModule.methods.writeSession.channel).toBe("synapse:terminal:session:write")
    expect(terminalIpcModule.methods.resizeSession.channel).toBe("synapse:terminal:session:resize")
    expect("setAgentControl" in terminalIpcModule.methods).toBe(false)
    expect(terminalIpcModule.methods.deleteSession.channel).toBe("synapse:terminal:session:delete")
    expect(terminalIpcModule.methods.stopSession.channel).toBe("synapse:terminal:session:stop")
    expect(terminalIpcModule.methods.runStartupCommand.channel).toBe("synapse:terminal:session:run-startup-command")
    expect(terminalIpcModule.events.data.channel).toBe("synapse:terminal:data")
    expect(terminalIpcModule.events.sessionChanged.channel).toBe("synapse:terminal:session-changed")
    expect(terminalIpcModule.events.sessionDeleted.channel).toBe("synapse:terminal:session-deleted")
  })

  it("chooses a terminal group default cwd through the native directory dialog", async () => {
    electronDialogMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/Users/liyang/project"],
    })

    await expect(terminalIpcModule.methods.chooseDefaultCwd.handler(createContext(createService()), undefined))
      .resolves.toBe("/Users/liyang/project")

    expect(electronDialogMock.showOpenDialog).toHaveBeenCalledWith({
      title: "选择默认目录",
      properties: ["openDirectory"],
    })
  })

  it("renames and deletes groups plus sessions as the user actor", async () => {
    const service = createService()
    const ctx = createContext(service)

    await terminalIpcModule.methods.renameGroup.handler(ctx, {
      groupId: "group-1",
      name: "构建",
    })
    await terminalIpcModule.methods.updateGroupSettings.handler(ctx, {
      groupId: "group-1",
      name: "构建",
      settings: {
        defaultCwd: "/tmp",
        startupCommand: "pnpm dev",
      },
    })
    await terminalIpcModule.methods.deleteGroup.handler(ctx, {
      groupId: "group-1",
    })
    await terminalIpcModule.methods.renameSession.handler(ctx, {
      sessionId: "session-1",
      title: "Logs",
    })
    await terminalIpcModule.methods.writeSession.handler(ctx, {
      sessionId: "session-1",
      data: "pwd\n",
    })
    await terminalIpcModule.methods.deleteSession.handler(ctx, {
      sessionId: "session-1",
    })
    await terminalIpcModule.methods.stopSession.handler(ctx, {
      sessionId: "session-1",
      force: true,
    })
    await terminalIpcModule.methods.runStartupCommand.handler(ctx, {
      sessionId: "session-1",
    })

    expect(service.renameGroup).toHaveBeenCalledWith({
      groupId: "group-1",
      name: "构建",
    })
    expect(service.updateGroupSettings).toHaveBeenCalledWith({
      groupId: "group-1",
      name: "构建",
      settings: {
        defaultCwd: "/tmp",
        startupCommand: "pnpm dev",
      },
    })
    expect(service.deleteGroup).toHaveBeenCalledWith({
      groupId: "group-1",
    })
    expect(service.renameSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      title: "Logs",
    })
    expect(service.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "pwd\n",
    })
    expect(service.deleteSession).toHaveBeenCalledWith({
      sessionId: "session-1",
    })
    expect(service.stopSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      force: true,
    })
    expect(service.runStartupCommand).toHaveBeenCalledWith({
      sessionId: "session-1",
    })
  })

  it("validates event payloads", () => {
    expect(terminalIpcModule.events.data.payload.safeParse({
      sessionId: "session-1",
      chunk: {
        sessionId: "session-1",
        seq: 1,
        data: "hello",
        createdAt: "2026-06-24T00:00:00.000Z",
        source: "pty",
      },
    }).success).toBe(true)
    expect(terminalIpcModule.events.data.payload.safeParse({
      sessionId: "session-1",
      chunk: { data: "missing-seq" },
    }).success).toBe(false)

    expect(terminalIpcModule.events.sessionChanged.payload.safeParse({
      id: "session-1",
      groupId: "group-1",
      title: "zsh",
      cwd: "/Users/liyang",
      shell: "/bin/zsh",
      status: "running",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      startedAt: "2026-06-24T00:00:00.000Z",
      cols: 80,
      rows: 24,
      lastOutputSeq: 0,
    }).success).toBe(true)
    expect(terminalIpcModule.events.sessionChanged.payload.safeParse({
      id: "session-1",
      status: "running",
    }).success).toBe(false)

    expect(terminalIpcModule.events.sessionDeleted.payload.safeParse({
      sessionId: "session-1",
    }).success).toBe(true)
    expect(terminalIpcModule.events.sessionDeleted.payload.safeParse({}).success).toBe(false)
  })

  it("is included in registered IPC modules", () => {
    expect(registeredIpcModules).toContain(terminalIpcModule)
  })

  it("does not resolve the terminal service during IPC registry setup", () => {
    const resolved: string[] = []

    expect(() =>
      createIpcRegistry({
        moduleId: "main",
        resolve: <T>(serviceId: string): T => {
          resolved.push(serviceId)
          if (serviceId === "core.terminal") {
            throw new Error("core.terminal is not running")
          }
          if (serviceId === "core.window-manager") {
            return createWindowManager() as T
          }
          return {} as T
        },
      }),
    ).not.toThrow()

    expect(resolved).not.toContain("core.terminal")
  })

  it("wires terminal event forwarding after a terminal IPC method resolves the service", async () => {
    const service = createService()
    const windowManager = createWindowManager()
    const ctx = createContext(service, windowManager)

    await terminalIpcModule.methods.listGroups.handler(ctx, undefined)
    ;(service.events as EventEmitter).emit("data", {
      sessionId: "session-1",
      chunk: {
        sessionId: "session-1",
        seq: 1,
        data: "hello",
        createdAt: "2026-06-24T00:00:00.000Z",
        source: "pty",
      },
    })
    ;(service.events as EventEmitter).emit("sessionChanged", createSession())
    ;(service.events as EventEmitter).emit("sessionDeleted", { sessionId: "session-1" })

    expect(windowManager.broadcast).toHaveBeenCalledWith("synapse:terminal:data", {
      sessionId: "session-1",
      chunk: {
        sessionId: "session-1",
        seq: 1,
        data: "hello",
        createdAt: "2026-06-24T00:00:00.000Z",
        source: "pty",
      },
    })
    expect(windowManager.broadcast).toHaveBeenCalledWith("synapse:terminal:session-changed", createSession())
    expect(windowManager.broadcast).toHaveBeenCalledWith("synapse:terminal:session-deleted", {
      sessionId: "session-1",
    })
  })
})

function createContext(
  service: Partial<TerminalService>,
  windowManager: Partial<WindowManager> = createWindowManager(),
): IpcHandlerContext {
  return {
    moduleId: "terminal",
    resolve: <T>(serviceId: string): T => {
      if (serviceId === "core.terminal") {
        return service as T
      }
      if (serviceId === "core.window-manager") {
        return windowManager as T
      }
      throw new Error(`Unexpected service: ${serviceId}`)
    },
  }
}

function createService(): Partial<TerminalService> {
  const session = createSession()
  return {
    listGroups: vi.fn(() => []),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    updateGroupSettings: vi.fn((input) => ({
      id: input.groupId,
      name: input.name,
      settings: input.settings,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      sortOrder: 0,
    })),
    deleteGroup: vi.fn(),
    listSessions: vi.fn(() => []),
    createSession: vi.fn(),
    getSession: vi.fn(() => session),
    readSession: vi.fn(() => ({
      session,
      chunks: [],
      nextSeq: 0,
      truncated: false,
      firstSeq: 0,
    })),
    renameSession: vi.fn(() => session),
    writeSession: vi.fn(),
    resizeSession: vi.fn(),
    deleteSession: vi.fn(),
    stopSession: vi.fn(),
    runStartupCommand: vi.fn(),
    events: new EventEmitter() as TerminalService["events"],
  }
}

function createSession() {
  return {
    id: "session-1",
    groupId: "group-1",
    title: "zsh",
    cwd: "/Users/liyang",
    shell: "/bin/zsh",
    status: "running" as const,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    cols: 80,
    rows: 24,
    lastOutputSeq: 0,
  }
}

function createWindowManager(): Pick<WindowManager, "broadcast"> {
  return {
    broadcast: vi.fn(() => 1),
  }
}
