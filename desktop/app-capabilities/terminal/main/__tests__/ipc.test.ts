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
const electronClipboardMock = vi.hoisted(() => ({
  writeText: vi.fn(),
  readText: vi.fn(() => ""),
  readImage: vi.fn(() => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) })),
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
  clipboard: electronClipboardMock,
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
    expect(terminalIpcModule.methods.getGlobalLaunchSettings.operationId).toBe("app.terminal.global_launch.get")
    expect(terminalIpcModule.methods.updateGlobalLaunchSettings.operationId).toBe("app.terminal.global_launch.update")
    expect(terminalIpcModule.methods.listCustomToolbarActions.operationId).toBe("app.terminal.toolbar_action.list")
    expect(terminalIpcModule.methods.createCustomToolbarAction.operationId).toBe("app.terminal.toolbar_action.create")
    expect(terminalIpcModule.methods.updateCustomToolbarAction.operationId).toBe("app.terminal.toolbar_action.update")
    expect(terminalIpcModule.methods.deleteCustomToolbarAction.operationId).toBe("app.terminal.toolbar_action.delete")
    expect(terminalIpcModule.methods.listGroups.operationId).toBe("app.terminal.group.list")
    expect(terminalIpcModule.methods.getGroup.operationId).toBe("app.terminal.group.get")
    expect(terminalIpcModule.methods.createGroup.operationId).toBe("app.terminal.group.create")
    expect(terminalIpcModule.methods.renameGroup.operationId).toBe("app.terminal.group.rename")
    expect(terminalIpcModule.methods.updateGroupSettings.operationId).toBe("app.terminal.group.update_settings")
    expect(terminalIpcModule.methods.getGroupCommand.operationId).toBe("app.terminal.group_command.get")
    expect(terminalIpcModule.methods.revealEnvironmentValue.operationId).toBe("app.terminal.environment.reveal")
    expect(terminalIpcModule.methods.copyEnvironmentValue.operationId).toBe("app.terminal.environment.copy")
    expect(terminalIpcModule.methods.materializeClipboardImage.operationId).toBe("app.terminal.clipboard.materialize_image")
    expect(terminalIpcModule.methods.chooseCwd.operationId).toBe("app.terminal.launch.choose_cwd")
    expect(terminalIpcModule.methods.createGroupCommand.operationId).toBe("app.terminal.group_command.create")
    expect(terminalIpcModule.methods.updateGroupCommand.operationId).toBe("app.terminal.group_command.update")
    expect(terminalIpcModule.methods.deleteGroupCommand.operationId).toBe("app.terminal.group_command.delete")
    expect(terminalIpcModule.methods.launchGroupCommand.operationId).toBe("app.terminal.group_command.launch")
    expect(terminalIpcModule.methods.deleteGroup.operationId).toBe("app.terminal.group.delete")
    expect(terminalIpcModule.methods.listWorkspaces.operationId).toBe("app.terminal.workspace.list")
    expect(terminalIpcModule.methods.getWorkspace.operationId).toBe("app.terminal.workspace.get")
    expect(terminalIpcModule.methods.getWorkspaceForSession.operationId).toBe("app.terminal.workspace.for_session")
    expect(terminalIpcModule.methods.renameWorkspace.operationId).toBe("app.terminal.workspace.rename")
    expect(terminalIpcModule.methods.splitPane.operationId).toBe("app.terminal.pane.split")
    expect(terminalIpcModule.methods.movePane.operationId).toBe("app.terminal.pane.move")
    expect(terminalIpcModule.methods.updateSplitRatio.operationId).toBe("app.terminal.split.resize")
    expect(terminalIpcModule.methods.closePane.operationId).toBe("app.terminal.pane.close")
    expect(terminalIpcModule.methods.closeWorkspace.operationId).toBe("app.terminal.workspace.close")
    expect(terminalIpcModule.methods.listSessions.operationId).toBe("app.terminal.session.list")
    expect(terminalIpcModule.methods.createSession.operationId).toBe("app.terminal.session.create")
    expect(terminalIpcModule.methods.getSession.operationId).toBe("app.terminal.session.get")
    expect(terminalIpcModule.methods.attachSession.operationId).toBe("app.terminal.session.attach")
    expect(terminalIpcModule.methods.readSession.operationId).toBe("app.terminal.session.read")
    expect(terminalIpcModule.methods.renameSession.operationId).toBe("app.terminal.session.rename")
    expect(terminalIpcModule.methods.writeSession.operationId).toBe("app.terminal.session.write")
    expect(terminalIpcModule.methods.resizeSession.operationId).toBe("app.terminal.session.resize")
    expect("setAgentControl" in terminalIpcModule.methods).toBe(false)
    expect(terminalIpcModule.methods.deleteSession.operationId).toBe("app.terminal.session.delete")
    expect(terminalIpcModule.methods.stopSession.operationId).toBe("app.terminal.session.stop")
    expect(terminalIpcModule.methods.runStartupCommand.operationId).toBe("app.terminal.session.run_startup_command")
    expect(terminalIpcModule.methods.openWorkspaceTree.operationId).toBe("app.terminal.workspace_tree.open")
    expect(terminalIpcModule.methods.listWorkspaceTree.operationId).toBe("app.terminal.workspace_tree.list")
    expect(terminalIpcModule.methods.resolveWorkspaceTreePaths.operationId).toBe("app.terminal.workspace_tree.resolve_paths")
    expect(terminalIpcModule.methods.closeWorkspaceTree.operationId).toBe("app.terminal.workspace_tree.close")
    expect(terminalIpcModule.events.data.operationId).toBe("app.terminal.operation.data")
    expect(terminalIpcModule.events.sessionChanged.operationId).toBe("app.terminal.operation.session_changed")
    expect(terminalIpcModule.events.sessionDeleted.operationId).toBe("app.terminal.operation.session_deleted")
    expect(terminalIpcModule.events.resized.operationId).toBe("app.terminal.operation.resized")
    expect(terminalIpcModule.events.workingDirectoryChanged.operationId)
      .toBe("app.terminal.operation.working_directory_changed")
    expect(terminalIpcModule.events.workspaceTreeChanged.operationId)
      .toBe("app.terminal.workspace_tree.changed")
  })

  it("chooses a terminal launch cwd through the native directory dialog", async () => {
    electronDialogMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/Users/liyang/project"],
    })

    await expect(terminalIpcModule.methods.chooseCwd.handler(createContext(createService()), undefined))
      .resolves.toBe("/Users/liyang/project")

    expect(electronDialogMock.showOpenDialog).toHaveBeenCalledWith({
      title: "选择工作目录",
      properties: ["openDirectory"],
    })
  })

  it("forwards custom toolbar action management to the terminal service", async () => {
    const service = createService()
    const context = createContext(service)
    const id = "00000000-0000-4000-8000-000000000001"

    await terminalIpcModule.methods.listCustomToolbarActions.handler(context, undefined)
    await terminalIpcModule.methods.createCustomToolbarAction.handler(context, {
      label: "检查状态",
      content: "git status",
      pressEnter: true,
    })
    await terminalIpcModule.methods.updateCustomToolbarAction.handler(context, {
      id,
      label: "检查分支",
      content: "git branch",
      pressEnter: false,
    })
    await terminalIpcModule.methods.deleteCustomToolbarAction.handler(context, { id })

    expect(service.listCustomToolbarActions).toHaveBeenCalledTimes(1)
    expect(service.createCustomToolbarAction).toHaveBeenCalledWith({
      label: "检查状态",
      content: "git status",
      pressEnter: true,
    })
    expect(service.updateCustomToolbarAction).toHaveBeenCalledWith({
      id,
      label: "检查分支",
      content: "git branch",
      pressEnter: false,
    })
    expect(service.deleteCustomToolbarAction).toHaveBeenCalledWith({ id })
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

  it("validates group mutation responses with saved command summaries", async () => {
    const service = createService()
    const groupWithCommand = (input: { groupId: string; name: string }) => ({
      id: input.groupId,
      name: input.name,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:01:00.000Z",
      sortOrder: 0,
      groupRevision: 2,
      launchRevision: 2,
      membershipRevision: 1,
      commandCollectionRevision: 2,
      settings: {
        defaultCwd: "/tmp",
        commands: [{
          id: "cmd-1",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
          commandRevision: 1,
        }],
      },
    })
    service.renameGroup = vi.fn(async (input) => groupWithCommand(input))
    service.updateGroupSettings = vi.fn(async (input) => groupWithCommand(input))

    const ctx = createContext(service)
    const renamed = await terminalIpcModule.methods.renameGroup.handler(ctx, {
      groupId: "group-1",
      name: "构建",
    })
    const updated = await terminalIpcModule.methods.updateGroupSettings.handler(ctx, {
      groupId: "group-1",
      name: "构建",
      expectedLaunchRevision: 1,
      settings: { defaultCwd: "/tmp" },
    })

    expect(() => terminalIpcModule.methods.renameGroup.response.parse(renamed)).not.toThrow()
    expect(() => terminalIpcModule.methods.updateGroupSettings.response.parse(updated)).not.toThrow()
    for (const response of [renamed, updated]) {
      expect(response).toMatchObject({
        settings: {
          commands: [{ id: "cmd-1", name: "dev", commandRevision: 1 }],
        },
      })
      expect(response.settings?.commands?.[0]).not.toHaveProperty("command")
    }
  })

  it("manages and launches terminal group commands through IPC", async () => {
    const service = createService()
    const ctx = createContext(service)

    await terminalIpcModule.methods.createGroupCommand.handler(ctx, {
      groupId: "group-1",
      name: "dev",
      command: "pnpm dev",
    })
    await terminalIpcModule.methods.updateGroupCommand.handler(ctx, {
      groupId: "group-1",
      commandId: "cmd-1",
      name: "test",
      command: "pnpm test",
    })
    await terminalIpcModule.methods.launchGroupCommand.handler(ctx, {
      groupId: "group-1",
      commandId: "cmd-1",
      cols: 120,
      rows: 40,
    })
    await terminalIpcModule.methods.deleteGroupCommand.handler(ctx, {
      groupId: "group-1",
      commandId: "cmd-1",
    })

    expect(service.createGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      name: "dev",
      command: "pnpm dev",
    })
    expect(service.updateGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
      name: "test",
      command: "pnpm test",
    })
    expect(service.launchGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
      cols: 120,
      rows: 40,
    })
    expect(service.deleteGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
    })
  })

  it("keeps list and session payloads free of launch values and command bodies", async () => {
    const session = { ...createSession(), launchEnvironment: { SECRET_TOKEN: "session-secret" } }
    const group = {
      id: "group-1",
      name: "构建",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      sortOrder: 0,
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
      settings: {
        environment: { SECRET_TOKEN: "group-secret" },
        commands: [{
          id: "cmd-1",
          name: "dev",
          command: "echo command-secret",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
          commandRevision: 1,
        }],
      },
    }
    const service = {
      ...createService(),
      listGroups: vi.fn(() => [group]),
      listSessions: vi.fn(() => [session]),
      getGlobalLaunchSettings: vi.fn(() => ({
        revision: 1,
        updatedAt: "2026-06-24T00:00:00.000Z",
        settings: { environment: { SECRET_TOKEN: "global-secret" } },
      })),
      getGroup: vi.fn(() => group),
    } as Partial<TerminalService>
    const ctx = createContext(service)

    const listedGroups = await terminalIpcModule.methods.listGroups.handler(ctx, undefined)
    const listedSessions = await terminalIpcModule.methods.listSessions.handler(ctx, undefined)
    expect(JSON.stringify({ listedGroups, listedSessions })).not.toMatch(/group-secret|command-secret|session-secret/)

    expect(terminalIpcModule.methods.revealEnvironmentValue.handler(ctx, {
      scope: "global",
      key: "SECRET_TOKEN",
    })).toBe("global-secret")
    await terminalIpcModule.methods.copyEnvironmentValue.handler(ctx, {
      scope: "group",
      groupId: "group-1",
      key: "SECRET_TOKEN",
    })
    expect(electronClipboardMock.writeText).toHaveBeenCalledWith("group-secret")
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
    expect(terminalIpcModule.events.resized.payload.safeParse({
      sessionId: "session-1",
      cols: 120,
      rows: 40,
      sizeRevision: 2,
      throughOutputSeq: 7,
    }).success).toBe(true)
    expect(terminalIpcModule.events.resized.payload.safeParse({
      sessionId: "session-1",
      cols: 120,
    }).success).toBe(false)
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
    ;(service.events as EventEmitter).emit("resized", {
      sessionId: "session-1",
      cols: 120,
      rows: 40,
      sizeRevision: 2,
      throughOutputSeq: 1,
    })
    ;(service.events as EventEmitter).emit("workingDirectoryChanged", { sessionId: "session-1" })

    expect(windowManager.broadcast).toHaveBeenCalledWith("synapse:app:terminal:operation:data", {
      sessionId: "session-1",
      chunk: {
        sessionId: "session-1",
        seq: 1,
        data: "hello",
        createdAt: "2026-06-24T00:00:00.000Z",
        source: "pty",
      },
    })
    expect(windowManager.broadcast).toHaveBeenCalledWith("synapse:app:terminal:operation:session_changed", createSession())
    expect(windowManager.broadcast).toHaveBeenCalledWith("synapse:app:terminal:operation:session_deleted", {
      sessionId: "session-1",
    })
    expect(windowManager.broadcast).toHaveBeenCalledWith("synapse:app:terminal:operation:resized", {
      sessionId: "session-1",
      cols: 120,
      rows: 40,
      sizeRevision: 2,
      throughOutputSeq: 1,
    })
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:terminal:operation:working_directory_changed",
      { sessionId: "session-1" },
    )
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
    getGlobalLaunchSettings: vi.fn(() => ({ revision: 1, updatedAt: "2026-06-24T00:00:00.000Z" })),
    updateGlobalLaunchSettings: vi.fn(async (input) => ({
      revision: input.expectedRevision + 1,
      updatedAt: "2026-06-24T00:00:00.000Z",
      settings: input.settings,
    })),
    listCustomToolbarActions: vi.fn(() => []),
    createCustomToolbarAction: vi.fn(async (input) => ({
      id: "00000000-0000-4000-8000-000000000001",
      ...input,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
      actionRevision: 1,
    })),
    updateCustomToolbarAction: vi.fn(async (input) => ({
      ...input,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:01:00.000Z",
      actionRevision: 2,
    })),
    deleteCustomToolbarAction: vi.fn(async () => undefined),
    listGroups: vi.fn(() => []),
    getGroup: vi.fn(() => ({
      id: "group-1",
      name: "构建",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      sortOrder: 0,
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
    })),
    getGroupCommand: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn((input) => ({
      id: input.groupId,
      name: input.name,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      sortOrder: 0,
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
    })),
    updateGroupSettings: vi.fn((input) => ({
      id: input.groupId,
      name: input.name,
      settings: input.settings,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      sortOrder: 0,
    })),
    createGroupCommand: vi.fn(async () => ({
      id: "cmd-1",
      name: "dev",
      command: "pnpm dev",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    })),
    updateGroupCommand: vi.fn(async () => ({
      id: "cmd-1",
      name: "test",
      command: "pnpm test",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:01:00.000Z",
    })),
    deleteGroupCommand: vi.fn(async () => undefined),
    launchGroupCommand: vi.fn(async () => createSession({ id: "session-command", title: "test" })),
    deleteGroup: vi.fn(),
    listSessions: vi.fn(() => []),
    createSession: vi.fn(),
    getSession: vi.fn(() => session),
    attachSession: vi.fn(async () => ({
      session,
      degraded: false,
      serialized: "",
      cols: 80,
      rows: 24,
      throughOutputSeq: 0,
      sizeRevision: 1,
      emulatorId: "xterm-headless",
      emulatorVersion: "6.0.0",
      scrollbackTruncated: false,
      reasons: [],
    })),
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

function createSession(overrides = {}) {
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
    ...overrides,
  }
}

function createWindowManager(): Pick<WindowManager, "broadcast"> {
  return {
    broadcast: vi.fn(() => 1),
  }
}
