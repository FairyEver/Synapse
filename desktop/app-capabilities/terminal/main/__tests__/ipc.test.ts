import { describe, expect, it, vi } from "vitest"

import { registeredIpcModules } from "../../../../electron/bootstrap/ipc-registry"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import type { TerminalService } from "../service"
import { terminalIpcModule } from "../ipc"

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
  dialog: {},
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
    expect(terminalIpcModule.methods.listSessions.channel).toBe("synapse:terminal:session:list")
    expect(terminalIpcModule.methods.createSession.channel).toBe("synapse:terminal:session:create")
    expect(terminalIpcModule.methods.getSession.channel).toBe("synapse:terminal:session:get")
    expect(terminalIpcModule.methods.readSession.channel).toBe("synapse:terminal:session:read")
    expect(terminalIpcModule.methods.writeSession.channel).toBe("synapse:terminal:session:write")
    expect(terminalIpcModule.methods.resizeSession.channel).toBe("synapse:terminal:session:resize")
    expect(terminalIpcModule.methods.setAgentControl.channel).toBe("synapse:terminal:session:agent-control")
    expect(terminalIpcModule.methods.stopSession.channel).toBe("synapse:terminal:session:stop")
    expect(terminalIpcModule.events.data.channel).toBe("synapse:terminal:data")
    expect(terminalIpcModule.events.sessionChanged.channel).toBe("synapse:terminal:session-changed")
  })

  it("writes and stops sessions as the user actor", async () => {
    const service = createService()
    const ctx = createContext(service)

    await terminalIpcModule.methods.writeSession.handler(ctx, {
      sessionId: "session-1",
      data: "pwd\n",
    })
    await terminalIpcModule.methods.stopSession.handler(ctx, {
      sessionId: "session-1",
      force: true,
    })

    expect(service.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "pwd\n",
      actor: "user",
    })
    expect(service.stopSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      force: true,
      actor: "user",
    })
  })

  it("sets agent control through the terminal service", async () => {
    const service = createService()
    const ctx = createContext(service)

    await terminalIpcModule.methods.setAgentControl.handler(ctx, {
      sessionId: "session-1",
      enabled: true,
    })

    expect(service.setAgentControl).toHaveBeenCalledWith({
      sessionId: "session-1",
      enabled: true,
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
      agentControl: "disabled",
      cols: 80,
      rows: 24,
      lastOutputSeq: 0,
    }).success).toBe(true)
    expect(terminalIpcModule.events.sessionChanged.payload.safeParse({
      id: "session-1",
      status: "running",
    }).success).toBe(false)
  })

  it("is included in registered IPC modules", () => {
    expect(registeredIpcModules).toContain(terminalIpcModule)
  })
})

function createContext(service: Partial<TerminalService>): IpcHandlerContext {
  return {
    moduleId: "terminal",
    resolve: <T>(serviceId: string): T => {
      if (serviceId !== "core.terminal") {
        throw new Error(`Unexpected service: ${serviceId}`)
      }
      return service as T
    },
  }
}

function createService(): Partial<TerminalService> {
  const session = {
    id: "session-1",
    groupId: "group-1",
    title: "zsh",
    cwd: "/Users/liyang",
    shell: "/bin/zsh",
    status: "running" as const,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    agentControl: "disabled" as const,
    cols: 80,
    rows: 24,
    lastOutputSeq: 0,
  }
  return {
    listGroups: vi.fn(() => []),
    createGroup: vi.fn(),
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
    writeSession: vi.fn(),
    resizeSession: vi.fn(),
    setAgentControl: vi.fn(() => session),
    stopSession: vi.fn(),
    events: {
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as TerminalService["events"],
  }
}
