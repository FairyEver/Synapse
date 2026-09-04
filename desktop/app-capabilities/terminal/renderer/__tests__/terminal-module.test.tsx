/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  SynapseTerminalDataEvent,
  SynapseTerminalGlobalLaunchSettings,
  SynapseTerminalGroup,
  SynapseTerminalGroupCommand,
  SynapseTerminalOutputChunk,
  SynapseTerminalSession,
  SynapseTerminalUpdateGroupSettingsInput,
  SynapseTerminalWorkspace,
} from "../../../../src/types/terminal"
import {
  WORKSPACE_FILE_TREE_DRAG_TYPE,
  writeWorkspaceFileTreeDrag,
} from "../../../../src/lib/workspace-file-tree-drag"

const bridgeState = vi.hoisted(() => ({
  globalLaunch: {
    revision: 1,
    updatedAt: "2026-08-08T00:00:00.000Z",
  } as SynapseTerminalGlobalLaunchSettings,
  groups: [] as SynapseTerminalGroup[],
  workspaces: [] as SynapseTerminalWorkspace[],
  sessions: [] as SynapseTerminalSession[],
  chunks: [] as SynapseTerminalOutputChunk[],
  nextSeq: 0,
  dataListener: null as ((event: SynapseTerminalDataEvent) => void) | null,
  sessionChangedListener: null as ((session: SynapseTerminalSession) => void) | null,
  sessionDeletedListener: null as ((event: { sessionId: string }) => void) | null,
  resizedListener: null as ((event: {
    sessionId: string
    cols: number
    rows: number
    sizeRevision: number
    throughOutputSeq: number
  }) => void) | null,
  workingDirectoryChangedListener: null as ((event: { sessionId: string }) => void) | null,
  domainChangedListener: null as ((event: unknown) => void) | null,
  dataUnsubscribe: vi.fn(),
  sessionChangedUnsubscribe: vi.fn(),
  sessionDeletedUnsubscribe: vi.fn(),
  resizedUnsubscribe: vi.fn(),
  workingDirectoryChangedUnsubscribe: vi.fn(),
  domainChangedUnsubscribe: vi.fn(),
  deferredAttach: null as null | {
    promise: Promise<unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  },
}))

const terminalBridge = vi.hoisted(() => ({
  chooseCwd: vi.fn(async () => "/repo/app"),
  revealEnvironmentValue: vi.fn(async () => null),
  copyEnvironmentValue: vi.fn(async () => undefined),
  materializeClipboardImage: vi.fn(async (): Promise<string | null> => null),
  getGlobalLaunchSettings: vi.fn(async () => bridgeState.globalLaunch),
  updateGlobalLaunchSettings: vi.fn(async ({ expectedRevision, settings }: {
    expectedRevision: number
    settings?: SynapseTerminalGlobalLaunchSettings["settings"]
  }) => {
    bridgeState.globalLaunch = {
      revision: expectedRevision + 1,
      updatedAt: "2026-08-08T00:01:00.000Z",
      settings,
    }
    return bridgeState.globalLaunch
  }),
  listGroups: vi.fn(async () => bridgeState.groups),
  getGroup: vi.fn(async ({ groupId }: { groupId: string }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found")
    return group
  }),
  createGroup: vi.fn(async ({ name }: { name: string }) => {
    const group = createGroup({
      id: `group-${bridgeState.groups.length + 1}`,
      name: name.trim(),
      sortOrder: bridgeState.groups.length,
    })
    return group
  }),
  renameGroup: vi.fn(async ({ groupId, name }: { groupId: string; name: string }) => {
    const group = {
      ...bridgeState.groups.find((item) => item.id === groupId),
      id: groupId,
      name: name.trim(),
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:02:00.000Z",
      sortOrder: 0,
    } as SynapseTerminalGroup
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? group : item)
    return group
  }),
  updateGroupSettings: vi.fn(async ({ groupId, name, settings }: SynapseTerminalUpdateGroupSettingsInput) => {
    const group = {
      ...bridgeState.groups.find((item) => item.id === groupId),
      id: groupId,
      name: name.trim(),
      settings,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:03:00.000Z",
      sortOrder: 0,
    } as SynapseTerminalGroup
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? group : item)
    return group
  }),
  getGroupCommand: vi.fn(async ({ groupId, commandId }: { groupId: string; commandId: string }) => {
    const command = bridgeState.groups.find((item) => item.id === groupId)?.settings?.commands?.find((item) => item.id === commandId)
    if (!command) throw new Error("Command not found")
    return command
  }),
  createGroupCommand: vi.fn(async ({ groupId, name, command }: {
    groupId: string
    name: string
    command: string
  }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found")
    const nextCommand = {
      id: `cmd-${(group.settings?.commands?.length ?? 0) + 1}`,
      name: name.trim(),
      command: command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
      createdAt: "2026-06-24T00:03:00.000Z",
      updatedAt: "2026-06-24T00:03:00.000Z",
    } satisfies SynapseTerminalGroupCommand
    const updated = {
      ...group,
      settings: {
        ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
        commands: [...(group.settings?.commands ?? []), nextCommand],
      },
    }
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? updated : item)
    return nextCommand
  }),
  updateGroupCommand: vi.fn(async ({ groupId, commandId, name, command }: {
    groupId: string
    commandId: string
    name: string
    command: string
  }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found")
    const currentCommand = group.settings?.commands?.find((item) => item.id === commandId)
    const updatedCommand = {
      id: commandId,
      name: name.trim(),
      command: command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
      createdAt: currentCommand?.createdAt ?? "2026-06-24T00:03:00.000Z",
      updatedAt: "2026-06-24T00:04:00.000Z",
    } satisfies SynapseTerminalGroupCommand
    const updated = {
      ...group,
      settings: {
        ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
        commands: (group.settings?.commands ?? []).map((item) => item.id === commandId ? updatedCommand : item),
      },
    }
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? updated : item)
    return updatedCommand
  }),
  deleteGroupCommand: vi.fn(async ({ groupId, commandId }: { groupId: string; commandId: string }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found")
    const commands = (group.settings?.commands ?? []).filter((item) => item.id !== commandId)
    const settings = group.settings?.defaultCwd || commands.length
      ? {
          ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
          ...(commands.length ? { commands } : {}),
        }
      : undefined
    bridgeState.groups = bridgeState.groups.map((item) => item.id === groupId ? { ...group, settings } : item)
  }),
  launchGroupCommand: vi.fn(async ({ groupId, commandId, cols, rows }: {
    groupId: string
    commandId: string
    cols?: number
    rows?: number
  }) => {
    const group = bridgeState.groups.find((item) => item.id === groupId)
    const command = group?.settings?.commands?.find((item) => item.id === commandId)
    if (!command) throw new Error("Command not found")
    return createSession({
      id: `session-${bridgeState.sessions.length + 1}`,
      groupId,
      title: command.name,
      cols: cols ?? 80,
      rows: rows ?? 24,
    })
  }),
  deleteGroup: vi.fn(async ({ groupId }: { groupId: string }) => {
    const removedSessionIds = new Set(bridgeState.sessions
      .filter((session) => session.groupId === groupId)
      .map((session) => session.id))
    bridgeState.groups = bridgeState.groups.filter((group) => group.id !== groupId)
    bridgeState.workspaces = bridgeState.workspaces.filter((workspace) => workspace.groupId !== groupId)
    bridgeState.sessions = bridgeState.sessions.filter((session) => session.groupId !== groupId)
    bridgeState.chunks = bridgeState.chunks.filter((chunk) => !removedSessionIds.has(chunk.sessionId))
  }),
  listWorkspaces: vi.fn(async () => bridgeState.workspaces),
  getWorkspace: vi.fn(async ({ workspaceId }: { workspaceId: string }) => getWorkspace(workspaceId)),
  getWorkspaceForSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
    const workspace = bridgeState.workspaces.find((item) => workspaceHasSession(item, sessionId))
    if (!workspace) throw new Error("Workspace not found")
    return workspace
  }),
  renameWorkspace: vi.fn(async ({ workspaceId, title }: { workspaceId: string; title: string }) => {
    const current = getWorkspace(workspaceId)
    const workspace = {
      ...current,
      title: title.trim(),
      layoutRevision: current.layoutRevision + 1,
      updatedAt: "2026-06-24T00:02:00.000Z",
    }
    bridgeState.workspaces = bridgeState.workspaces.map((item) => item.id === workspaceId ? workspace : item)
    return workspace
  }),
  closeWorkspace: vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
    const workspace = getWorkspace(workspaceId)
    const sessionIds = workspace.layout.type === "leaf" ? [workspace.layout.sessionId] : []
    bridgeState.workspaces = bridgeState.workspaces.filter((item) => item.id !== workspaceId)
    bridgeState.sessions = bridgeState.sessions.filter((session) => !sessionIds.includes(session.id))
    return { workspaceId, state: "deleted" as const, remainingSessionIds: [] }
  }),
  splitPane: vi.fn(async ({ workspaceId, paneId, direction }: {
    workspaceId: string
    paneId: string
    direction: "right" | "down"
  }) => {
    const current = getWorkspace(workspaceId)
    if (current.layout.type !== "leaf" || current.layout.paneId !== paneId) throw new Error("Pane not found")
    const session = createSession({
      id: `session-${bridgeState.sessions.length + 1}`,
      groupId: current.groupId,
      title: `Session ${bridgeState.sessions.length + 1}`,
    })
    bridgeState.workspaces = bridgeState.workspaces.filter((workspace) => workspace.id !== `workspace-${session.id}`)
    const nextPaneId = `pane-${session.id}`
    const workspace = {
      ...current,
      layout: {
        type: "split" as const,
        splitId: `split-${session.id}`,
        direction: direction === "right" ? "horizontal" as const : "vertical" as const,
        ratio: 0.5,
        first: current.layout,
        second: { type: "leaf" as const, paneId: nextPaneId, sessionId: session.id },
      },
      layoutRevision: current.layoutRevision + 1,
    }
    bridgeState.workspaces = bridgeState.workspaces.map((item) => item.id === workspaceId ? workspace : item)
    return { workspace, paneId: nextPaneId, sessionId: session.id }
  }),
  movePane: vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
    const current = getWorkspace(workspaceId)
    const workspace = { ...current, layoutRevision: current.layoutRevision + 1 }
    bridgeState.workspaces = bridgeState.workspaces.map((item) => item.id === workspaceId ? workspace : item)
    return workspace
  }),
  updateSplitRatio: vi.fn(async ({ workspaceId }: { workspaceId: string }) => getWorkspace(workspaceId)),
  closePane: vi.fn(async ({ workspaceId }: { workspaceId: string }) => ({
    workspaceId,
    state: "closing" as const,
    remainingSessionIds: [],
  })),
  listSessions: vi.fn(async () => bridgeState.sessions),
  createSession: vi.fn(async (input: {
    groupId?: string
    title?: string
    cwd?: string
    cols?: number
    rows?: number
  } = {}) => createSession({
    groupId: input.groupId ?? "group-1",
    title: input.title ?? `Session ${bridgeState.sessions.length + 1}`,
    cwd: input.cwd ?? "/tmp",
    cols: input.cols ?? 80,
    rows: input.rows ?? 24,
  })),
  getSession: vi.fn(async ({ sessionId }: { sessionId: string }) => getSession(sessionId)),
  attachSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
    if (bridgeState.deferredAttach) return bridgeState.deferredAttach.promise
    const session = getSession(sessionId)
    const chunks = bridgeState.chunks.filter((chunk) => chunk.sessionId === sessionId)
    return {
      session,
      degraded: false as const,
      serialized: chunks.map((chunk) => chunk.data).join(""),
      cols: session.cols,
      rows: session.rows,
      throughOutputSeq: chunks.at(-1)?.seq ?? session.lastOutputSeq,
      sizeRevision: session.sizeRevision,
      emulatorId: "xterm-headless" as const,
      emulatorVersion: "6.0.0" as const,
      scrollbackTruncated: false,
      reasons: [] as [],
    }
  }),
  readSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
    return {
      session: getSession(sessionId),
      chunks: bridgeState.chunks.filter((chunk) => chunk.sessionId === sessionId),
      nextSeq: bridgeState.nextSeq,
      truncated: false,
      firstSeq: bridgeState.chunks[0]?.seq ?? 0,
    }
  }),
  renameSession: vi.fn(async ({ sessionId, title }: { sessionId: string; title: string }) => {
    const session = {
      ...getSession(sessionId),
      title: title.trim(),
      updatedAt: "2026-06-24T00:02:00.000Z",
    }
    bridgeState.sessions = bridgeState.sessions.map((item) => item.id === sessionId ? session : item)
    return session
  }),
  writeSession: vi.fn(async () => undefined),
  resizeSession: vi.fn(async () => undefined),
  deleteSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
    bridgeState.workspaces = bridgeState.workspaces.filter((workspace) =>
      workspace.layout.type !== "leaf" || workspace.layout.sessionId !== sessionId)
    bridgeState.sessions = bridgeState.sessions.filter((session) => session.id !== sessionId)
    bridgeState.chunks = bridgeState.chunks.filter((chunk) => chunk.sessionId !== sessionId)
  }),
  stopSession: vi.fn(async () => undefined),
  runStartupCommand: vi.fn(async () => undefined),
  onData: vi.fn((listener: (event: SynapseTerminalDataEvent) => void) => {
    bridgeState.dataListener = listener
    return bridgeState.dataUnsubscribe
  }),
  onSessionChanged: vi.fn((listener: (session: SynapseTerminalSession) => void) => {
    bridgeState.sessionChangedListener = listener
    return bridgeState.sessionChangedUnsubscribe
  }),
  onSessionDeleted: vi.fn((listener: (event: { sessionId: string }) => void) => {
    bridgeState.sessionDeletedListener = listener
    return bridgeState.sessionDeletedUnsubscribe
  }),
  onResized: vi.fn((listener: NonNullable<typeof bridgeState.resizedListener>) => {
    bridgeState.resizedListener = listener
    return bridgeState.resizedUnsubscribe
  }),
  openWorkspaceTree: vi.fn(async () => ({ scopeId: "scope-1", rootName: "project", revision: 0 })),
  listWorkspaceTree: vi.fn(async ({ scopeId, relativePath }: {
    scopeId: string
    relativePath: string
  }) => ({ scopeId, relativePath, revision: 0, entries: [] })),
  closeWorkspaceTree: vi.fn(async () => undefined),
  resolveWorkspaceTreePaths: vi.fn(async ({ scopeId }: { scopeId: string }) => ({ scopeId, paths: [] as string[] })),
  onWorkspaceTreeChanged: vi.fn(() => () => undefined),
  onWorkingDirectoryChanged: vi.fn((listener: NonNullable<typeof bridgeState.workingDirectoryChangedListener>) => {
    bridgeState.workingDirectoryChangedListener = listener
    return bridgeState.workingDirectoryChangedUnsubscribe
  }),
  onDomainChanged: vi.fn((listener: (event: unknown) => void) => {
    bridgeState.domainChangedListener = listener
    return bridgeState.domainChangedUnsubscribe
  }),
}))

const terminalDomainCache = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }))

const droppedPathState = vi.hoisted(() => ({
  paths: new WeakMap<object, string | null>(),
}))

const shellBridge = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  filePathForDroppedFile: vi.fn((file: File) => droppedPathState.paths.get(file) ?? null),
}))

const xtermState = vi.hoisted(() => ({
  instances: [] as Array<{
    open: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    getSelection: ReturnType<typeof vi.fn>
    hasSelection: ReturnType<typeof vi.fn>
    paste: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    cols: number
    rows: number
    options: { disableStdin?: boolean; fontSize?: number; lineHeight?: number }
    emitInput: (data: string) => void
    emitKeyEvent: (event: KeyboardEvent) => boolean | undefined
    inputDispose: ReturnType<typeof vi.fn>
    inputListener: ((data: string) => void) | null
    keyEventHandler: ((event: KeyboardEvent) => boolean) | null
  }>,
  fitInstances: [] as Array<{ fit: ReturnType<typeof vi.fn>; proposeDimensions: ReturnType<typeof vi.fn> }>,
  webLinksInstances: [] as Array<{
    handler: ((event: MouseEvent, uri: string) => void) | undefined
  }>,
}))

const webglState = vi.hoisted(() => ({
  instances: [] as Array<{
    onContextLoss: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    clearTextureAtlas: ReturnType<typeof vi.fn>
    contextLossDispose: ReturnType<typeof vi.fn>
  }>,
}))

const toastState = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "terminal") return terminalDomainCache.value ??= {
      globalLaunch: {
        get: terminalBridge.getGlobalLaunchSettings,
        update: terminalBridge.updateGlobalLaunchSettings,
      },
      launch: {
        chooseCwd: terminalBridge.chooseCwd,
        revealEnvironmentValue: terminalBridge.revealEnvironmentValue,
        copyEnvironmentValue: terminalBridge.copyEnvironmentValue,
      },
      clipboard: {
        materializeImage: terminalBridge.materializeClipboardImage,
      },
      group: {
        list: terminalBridge.listGroups,
        get: terminalBridge.getGroup,
        create: terminalBridge.createGroup,
        rename: terminalBridge.renameGroup,
        updateSettings: terminalBridge.updateGroupSettings,
        delete: terminalBridge.deleteGroup,
      },
      groupCommand: {
        get: terminalBridge.getGroupCommand,
        create: terminalBridge.createGroupCommand,
        update: terminalBridge.updateGroupCommand,
        delete: terminalBridge.deleteGroupCommand,
        launch: terminalBridge.launchGroupCommand,
      },
      workspace: {
        list: terminalBridge.listWorkspaces,
        get: terminalBridge.getWorkspace,
        getForSession: terminalBridge.getWorkspaceForSession,
        rename: terminalBridge.renameWorkspace,
        close: terminalBridge.closeWorkspace,
      },
      pane: {
        split: terminalBridge.splitPane,
        move: terminalBridge.movePane,
        updateRatio: terminalBridge.updateSplitRatio,
        close: terminalBridge.closePane,
      },
      session: {
        list: terminalBridge.listSessions,
        create: terminalBridge.createSession,
        get: terminalBridge.getSession,
        attach: terminalBridge.attachSession,
        read: terminalBridge.readSession,
        rename: terminalBridge.renameSession,
        write: terminalBridge.writeSession,
        resize: terminalBridge.resizeSession,
        delete: terminalBridge.deleteSession,
        stop: terminalBridge.stopSession,
        runStartupCommand: terminalBridge.runStartupCommand,
      },
      workspaceTree: {
        open: terminalBridge.openWorkspaceTree,
        list: terminalBridge.listWorkspaceTree,
        resolve: terminalBridge.resolveWorkspaceTreePaths,
        close: terminalBridge.closeWorkspaceTree,
        onChanged: terminalBridge.onWorkspaceTreeChanged,
      },
      operation: {
        onData: terminalBridge.onData,
        onSessionChanged: terminalBridge.onSessionChanged,
        onSessionDeleted: terminalBridge.onSessionDeleted,
        onResized: terminalBridge.onResized,
        onWorkingDirectoryChanged: terminalBridge.onWorkingDirectoryChanged,
        onDomainChanged: terminalBridge.onDomainChanged,
      },
    }
    if (domain === "shell") return shellBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function TerminalMock(options: {
    cols?: number
    rows?: number
    disableStdin?: boolean
  } = {}) {
    const instance = {
      open: vi.fn((container: HTMLElement) => {
        const terminal = document.createElement("div")
        const screen = document.createElement("div")
        const helpers = document.createElement("div")
        const textarea = document.createElement("textarea")
        const composition = document.createElement("div")
        terminal.className = "xterm"
        screen.className = "xterm-screen"
        helpers.className = "xterm-helpers"
        textarea.className = "xterm-helper-textarea"
        composition.className = "composition-view"
        helpers.append(textarea, composition)
        screen.append(helpers)
        terminal.append(screen)
        container.append(terminal)
      }),
      focus: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.()
      }),
      clear: vi.fn(),
      getSelection: vi.fn(() => ""),
      hasSelection: vi.fn(() => false),
      paste: vi.fn(),
      refresh: vi.fn(),
      resize: vi.fn((cols: number, rows: number) => {
        instance.cols = cols
        instance.rows = rows
      }),
      loadAddon: vi.fn(),
      attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        instance.keyEventHandler = handler
      }),
      onData: vi.fn((listener: (data: string) => void) => {
        instance.inputListener = listener
        return { dispose: instance.inputDispose }
      }),
      dispose: vi.fn(),
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      options,
      emitInput: (data: string) => instance.inputListener?.(data),
      emitKeyEvent: (event: KeyboardEvent) => instance.keyEventHandler?.(event),
      inputDispose: vi.fn(),
      inputListener: null as ((data: string) => void) | null,
      keyEventHandler: null as ((event: KeyboardEvent) => boolean) | null,
    }
    xtermState.instances.push(instance)
    return instance
  }),
}))

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function FitAddonMock() {
    const instance = {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 100, rows: 30 })),
    }
    xtermState.fitInstances.push(instance)
    return instance
  }),
}))

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function WebLinksAddonMock(
    handler?: (event: MouseEvent, uri: string) => void,
  ) {
    const instance = { handler }
    xtermState.webLinksInstances.push(instance)
    return instance
  }),
}))

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function WebglAddonMock() {
    const instance = {
      onContextLoss: vi.fn(() => ({ dispose: instance.contextLossDispose })),
      dispose: vi.fn(),
      clearTextureAtlas: vi.fn(),
      contextLossDispose: vi.fn(),
    }
    webglState.instances.push(instance)
    return instance
  }),
}))

vi.mock("@xterm/xterm/css/xterm.css", () => ({}))

vi.mock("sonner", () => ({
  toast: toastState,
}))

vi.mock("../../../../src/components/sidebar-content-layout", () => ({
  SidebarContentLayout: ({
    sidebar,
    children,
    contentScrollable,
    sidebarCollapsed,
    sidebarResizable,
  }: {
    readonly sidebar: ReactNode
    readonly children: ReactNode
    readonly contentScrollable?: boolean
    readonly sidebarCollapsed?: boolean
    readonly sidebarResizable?: boolean
  }) => (
    <div
      data-testid="terminal-sidebar-content-layout"
      data-content-scrollable={String(contentScrollable)}
      data-sidebar-collapsed={String(sidebarCollapsed)}
      data-sidebar-resizable={String(sidebarResizable)}
    >
      {!sidebarCollapsed ? <div data-testid="terminal-sidebar">{sidebar}</div> : null}
      {children}
    </div>
  ),
}))

import { Terminal as XtermTerminal } from "@xterm/xterm"
import { WebglAddon } from "@xterm/addon-webgl"
import { TerminalModule } from "../index"
import { EmbeddedSystemAppShell } from "../../../../src/modules/apps/components/embedded-system-app-shell"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const resizeObservers: Array<{ disconnect: ReturnType<typeof vi.fn>; trigger: () => void }> = []

;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  private readonly callback: ResizeObserverCallback
  readonly disconnect = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObservers.push({
      disconnect: this.disconnect,
      trigger: () => this.callback([], this),
    })
  }

  observe() {}
  unobserve() {}
} as typeof ResizeObserver

let roots: Root[] = []

beforeEach(() => {
  window.synapse = { platform: "darwin" } as typeof window.synapse
  window.localStorage.clear()
  bridgeState.globalLaunch = { revision: 1, updatedAt: "2026-08-08T00:00:00.000Z" }
  bridgeState.groups = []
  bridgeState.workspaces = []
  bridgeState.sessions = []
  bridgeState.chunks = []
  bridgeState.nextSeq = 0
  bridgeState.dataListener = null
  bridgeState.sessionChangedListener = null
  bridgeState.sessionDeletedListener = null
  bridgeState.resizedListener = null
  bridgeState.workingDirectoryChangedListener = null
  bridgeState.domainChangedListener = null
  bridgeState.deferredAttach = null
  bridgeState.dataUnsubscribe.mockClear()
  bridgeState.sessionChangedUnsubscribe.mockClear()
  bridgeState.sessionDeletedUnsubscribe.mockClear()
  bridgeState.resizedUnsubscribe.mockClear()
  bridgeState.workingDirectoryChangedUnsubscribe.mockClear()
  bridgeState.domainChangedUnsubscribe.mockClear()
  terminalBridge.listGroups.mockClear()
  terminalBridge.getGroup.mockClear()
  terminalBridge.chooseCwd.mockClear()
  terminalBridge.revealEnvironmentValue.mockClear()
  terminalBridge.copyEnvironmentValue.mockClear()
  terminalBridge.materializeClipboardImage.mockReset()
  terminalBridge.materializeClipboardImage.mockResolvedValue(null)
  terminalBridge.getGlobalLaunchSettings.mockClear()
  terminalBridge.updateGlobalLaunchSettings.mockClear()
  terminalBridge.createGroup.mockClear()
  terminalBridge.renameGroup.mockClear()
  terminalBridge.updateGroupSettings.mockClear()
  terminalBridge.getGroupCommand.mockClear()
  terminalBridge.createGroupCommand.mockClear()
  terminalBridge.updateGroupCommand.mockClear()
  terminalBridge.deleteGroupCommand.mockClear()
  terminalBridge.launchGroupCommand.mockClear()
  terminalBridge.deleteGroup.mockClear()
  terminalBridge.listWorkspaces.mockClear()
  terminalBridge.getWorkspace.mockClear()
  terminalBridge.getWorkspaceForSession.mockClear()
  terminalBridge.renameWorkspace.mockClear()
  terminalBridge.closeWorkspace.mockClear()
  terminalBridge.splitPane.mockClear()
  terminalBridge.movePane.mockClear()
  terminalBridge.updateSplitRatio.mockClear()
  terminalBridge.closePane.mockClear()
  terminalBridge.listSessions.mockClear()
  terminalBridge.createSession.mockClear()
  terminalBridge.getSession.mockClear()
  terminalBridge.attachSession.mockClear()
  terminalBridge.readSession.mockClear()
  terminalBridge.renameSession.mockClear()
  terminalBridge.writeSession.mockClear()
  terminalBridge.resizeSession.mockClear()
  terminalBridge.deleteSession.mockClear()
  terminalBridge.stopSession.mockClear()
  terminalBridge.runStartupCommand.mockClear()
  shellBridge.openExternal.mockClear()
  shellBridge.filePathForDroppedFile.mockClear()
  droppedPathState.paths = new WeakMap<object, string | null>()
  toastState.error.mockClear()
  toastState.success.mockClear()
  terminalBridge.onData.mockClear()
  terminalBridge.onSessionChanged.mockClear()
  terminalBridge.onSessionDeleted.mockClear()
  terminalBridge.onResized.mockClear()
  terminalBridge.openWorkspaceTree.mockClear()
  terminalBridge.listWorkspaceTree.mockClear()
  terminalBridge.closeWorkspaceTree.mockClear()
  terminalBridge.resolveWorkspaceTreePaths.mockClear()
  terminalBridge.resolveWorkspaceTreePaths.mockImplementation(async ({ scopeId }: { scopeId: string }) => ({ scopeId, paths: [] }))
  terminalBridge.onWorkspaceTreeChanged.mockClear()
  terminalBridge.onWorkingDirectoryChanged.mockClear()
  terminalBridge.onDomainChanged.mockClear()
  vi.mocked(XtermTerminal).mockClear()
  xtermState.instances = []
  xtermState.fitInstances = []
  xtermState.webLinksInstances = []
  webglState.instances = []
  vi.mocked(WebglAddon).mockClear()
  resizeObservers.length = 0
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("TerminalModule", () => {
  it("uses the shared resizable sidebar layout", async () => {
    await renderModule()

    const layout = document.querySelector('[data-testid="terminal-sidebar-content-layout"]')
    expect(layout).toBeTruthy()
    expect(layout?.getAttribute("data-sidebar-resizable")).toBe("true")
    expect(layout?.getAttribute("data-content-scrollable")).toBe("false")
  })

  it("toggles and persists sidebar visibility from the system app header", async () => {
    await renderModule()

    const layout = document.querySelector('[data-testid="terminal-sidebar-content-layout"]')
    expect(layout?.getAttribute("data-sidebar-collapsed")).toBe("false")
    expect(document.querySelector('[data-testid="terminal-sidebar"]')).toBeTruthy()

    await clickButtonByAriaLabel("收起侧边栏")

    expect(layout?.getAttribute("data-sidebar-collapsed")).toBe("true")
    expect(document.querySelector('[data-testid="terminal-sidebar"]')).toBeNull()
    expect(document.querySelector('button[aria-label="展开侧边栏"]')).toBeTruthy()
    expect(window.localStorage.getItem("synapse:app:ui:sidebar_collapsed:v1:terminal")).toBe("true")

    await clickButtonByAriaLabel("展开侧边栏")

    expect(layout?.getAttribute("data-sidebar-collapsed")).toBe("false")
    expect(document.querySelector('[data-testid="terminal-sidebar"]')).toBeTruthy()
    expect(document.querySelector('button[aria-label="收起侧边栏"]')).toBeTruthy()
    expect(window.localStorage.getItem("synapse:app:ui:sidebar_collapsed:v1:terminal")).toBe("false")
  })

  it("restores the persisted terminal sidebar state", async () => {
    window.localStorage.setItem("synapse:app:ui:sidebar_collapsed:v1:terminal", "true")

    await renderModule()

    expect(document.querySelector('[data-testid="terminal-sidebar-content-layout"]')
      ?.getAttribute("data-sidebar-collapsed")).toBe("true")
    expect(document.querySelector('[data-testid="terminal-sidebar"]')).toBeNull()
    expect(document.querySelector('button[aria-label="展开侧边栏"]')).toBeTruthy()
  })

  it("shows the empty state and creates a terminal session", async () => {
    await renderModule()

    expect(document.body.textContent).toContain("暂无会话")

    await clickButton("新建终端")

    expect(terminalBridge.createSession).toHaveBeenCalledWith({
      cols: 80,
      rows: 24,
    })
    expect(document.body.textContent).toContain("Session 1")
  })

  it("focuses and consumes a requested terminal session", async () => {
    bridgeState.groups = [createGroup({ id: "group-1" })]
    createSession({ id: "session-1", groupId: "group-1", title: "First" })
    createSession({ id: "session-2", groupId: "group-1", title: "Requested" })
    const onConsumed = vi.fn()

    await renderModule({
      openRequest: { requestId: "request-1", sessionId: "session-2" },
      onOpenRequestConsumed: onConsumed,
    })

    expect(terminalBridge.getSession).toHaveBeenCalledWith({ sessionId: "session-2" })
    expect(terminalBridge.attachSession).toHaveBeenLastCalledWith({ sessionId: "session-2" })
    expect(onConsumed).toHaveBeenCalledWith("request-1")
  })

  it("reports and consumes a missing requested terminal session", async () => {
    terminalBridge.getSession.mockRejectedValueOnce(new Error("Session not found"))
    const onConsumed = vi.fn()

    await renderModule({
      openRequest: { requestId: "request-1", sessionId: "missing" },
      onOpenRequestConsumed: onConsumed,
    })

    expect(toastState.error).toHaveBeenCalledWith("终端会话不存在")
    expect(onConsumed).toHaveBeenCalledWith("request-1")
  })

  it("renders terminal actions in the embedded header", async () => {
    await renderEmbeddedModule()

    const sidebarToggle = document.querySelector<HTMLButtonElement>('[data-embedded-system-app-left] button[aria-label="收起侧边栏"]')
    expect(sidebarToggle?.dataset.variant).toBe("ghost")
    expect(sidebarToggle?.className).toContain("aria-expanded:bg-transparent")
    const actions = document.querySelector("[data-embedded-system-app-actions]")
    const actionButtons = Array.from(actions?.querySelectorAll("button") ?? [])
    const createButton = actionButtons.find((button) => button.textContent?.trim() === "新建")
    const settingsButton = actionButtons.find((button) => button.textContent?.trim() === "设置")
    expect(createButton?.dataset.variant).toBe("ghost")
    expect(settingsButton?.dataset.variant).toBe("ghost")
    expect(createButton?.querySelector("svg")).toBeTruthy()
    expect(settingsButton?.querySelector("svg")).toBeTruthy()
    expect(actions?.textContent).not.toContain("新建终端")
    expect(actions?.textContent).not.toContain("终端设置")
  })

  it("lists running workspaces in the header and switches the active workspace", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })
    createSession({ id: "session-2", groupId: "group-1", title: "日志终端" })
    createSession({ id: "session-3", groupId: "group-1", title: "历史终端", status: "lost" })

    await renderEmbeddedModule()

    const navigation = document.querySelector('[aria-label="活动终端会话"]')
    expect(navigation?.classList.contains("h-10")).toBe(true)
    expect(navigation?.classList.contains("no-scrollbar")).toBe(true)
    expect(navigation?.textContent).toContain("开发终端")
    expect(navigation?.textContent).toContain("日志终端")
    expect(navigation?.textContent).not.toContain("历史终端")
    expect(navigation?.querySelectorAll("svg")).toHaveLength(0)
    expect(navigation?.querySelector('[aria-current="page"]')?.textContent).toBe("开发终端")

    await clickButton("日志终端", navigation ?? document.body)

    expect(navigation?.querySelector('[aria-current="page"]')?.textContent).toBe("日志终端")
    expect(terminalBridge.attachSession).toHaveBeenLastCalledWith({ sessionId: "session-2" })
  })

  it("removes a workspace from the header when its session stops running", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })

    await renderEmbeddedModule()
    expect(document.querySelector('[aria-label="活动终端会话"]')?.textContent).toContain("开发终端")

    bridgeState.sessions = bridgeState.sessions.map((session) => ({
      ...session,
      status: "exited" as const,
    }))
    await act(async () => {
      bridgeState.domainChangedListener?.({})
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.querySelector('[aria-label="活动终端会话"]')).toBeNull()
  })

  it("edits global launch settings from the terminal header without remounting the active terminal", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "zsh" })]
    await renderEmbeddedModule()

    await clickButton("设置")
    expect(document.body.textContent).toContain("终端设置")
    expect(document.querySelector('[data-slot="dialog-content"]')?.classList.contains("sm:max-w-3xl")).toBe(true)
    expect(document.querySelectorAll('[data-slot="dialog-content"] [data-slot="dialog-close"]')).toHaveLength(1)
    expect(document.querySelector('[data-slot="dialog-frame-body"] [data-scrollbars="vertical"]')).not.toBeNull()
    await changeInput("工作目录", "/repo/global")
    expect(document.body.textContent).toContain("环境变量")
    await clickButton("保存")

    expect(terminalBridge.updateGlobalLaunchSettings).toHaveBeenCalledWith({
      expectedRevision: 1,
      settings: {
        defaultCwd: "/repo/global",
      },
    })
    expect(xtermState.instances).toHaveLength(1)
  })

  it("saves a terminal appearance size from the appearance category", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    createSession({ id: "session-1", groupId: "group-1", title: "zsh" })
    await renderEmbeddedModule()

    await clickButton("设置")
    expect(document.body.textContent).toContain("外观")
    await selectTab("外观")
    expect(document.body.textContent).toContain("字号")
    expect(document.body.querySelector<HTMLSelectElement>('select[aria-label="字号"]')?.value).toBe("medium")

    await changeSelect("字号", "large")
    await clickButton("保存")

    expect(window.localStorage.getItem("synapse:app:terminal:appearance_size:v1")).toBe("large")
    expect(xtermState.instances).toHaveLength(1)
    expect(xtermState.instances[0]?.options.fontSize).toBe(16)
    expect(xtermState.instances[0]?.options.lineHeight).toBe(1.1)
    expect(xtermState.instances[0]?.refresh).toHaveBeenCalledWith(0, xtermState.instances[0]!.rows - 1)
    expect(webglState.instances[0]?.clearTextureAtlas).not.toHaveBeenCalled()
  })

  it("marks the discard action for unsaved terminal settings as destructive", async () => {
    await renderEmbeddedModule()

    await clickButton("设置")
    await changeInput("工作目录", "/repo/global")
    await clickButton("取消")

    expect(document.body.textContent).toContain("放弃未保存的更改？")
    expect(buttonForText("放弃更改")?.dataset.variant).toBe("destructive")
    await clickButton("继续编辑")
  })

  it("keeps lost sessions read-only without terminal-pane actions", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "zsh",
      cwd: "/Users/liyang",
      status: "lost",
      cols: 120,
      rows: 40,
    })]

    await renderEmbeddedModule()

    const actions = document.querySelector("[data-embedded-system-app-actions]")
    const main = document.body.querySelector("main")
    expect(actions?.textContent).toContain("新建")
    expect(document.body.textContent).toContain("已失联")
    expect(main?.textContent).not.toContain("同目录新开")
    expect(main?.textContent).not.toContain("终止进程")
    expect(XtermTerminal).toHaveBeenCalledWith(expect.objectContaining({
      disableStdin: true,
    }))
  })

  it("renders the active session area as only the terminal surface", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
      cwd: "/Users/liyang",
    })]

    await renderModule()

    const main = document.body.querySelector("main")
    expect(document.body.textContent).toContain("开发终端")
    expect(main?.textContent).not.toContain("/Users/liyang")
    expect(main?.textContent).not.toContain("运行中")
    expect(main?.textContent).not.toContain("终止进程")
    expect(main?.textContent).not.toContain("同目录新开")
    expect(document.querySelector("[aria-label^='终端输出与输入']")).toBeTruthy()
  })

  it("renders a compact toolbar below the active terminal surface", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    const toolbar = document.body.querySelector("[data-terminal-toolbar]")
    const terminalRegion = document.querySelector("[aria-label^='终端输出与输入']")
    expect(toolbar).toBeTruthy()
    expect(toolbar?.classList.contains("overflow-x-auto")).toBe(true)
    expect(toolbar?.classList.contains("no-scrollbar")).toBe(true)
    expect(toolbar?.classList.contains("whitespace-nowrap")).toBe(true)
    expect(toolbar?.classList.contains("min-h-10")).toBe(true)
    expect(toolbar?.classList.contains("bg-card")).toBe(true)
    expect(toolbar?.classList.contains("border-t")).toBe(true)
    expect(toolbar?.classList.contains("border-b")).toBe(false)
    if (!toolbar || !terminalRegion) throw new Error("Missing terminal toolbar or region")
    expect(terminalRegion.compareDocumentPosition(toolbar)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(document.body.textContent).toContain("Ctrl+C")
    expect(document.body.textContent).toContain("Clear")
    expect(document.body.textContent).not.toContain("Claude")
    expect(document.body.textContent).not.toContain("Codex")
    expect(document.body.textContent).not.toContain("code .")
    expect(document.body.textContent).toContain("/exit")
    expect(document.body.textContent).toContain("/clear")

    const toolbarButtons = Array.from(toolbar.querySelectorAll("button"))
    expect(toolbarButtons).toHaveLength(4)
    for (const button of toolbarButtons) {
      expect(button.className).toContain("text-foreground/75")
      expect(button.className).toContain("transition-[scale,background-color,color]")
      expect(button.className).toContain("active:scale-[0.96]")
      expect(button.className).toContain("hover:text-foreground")
    }
    expect(toolbar.querySelector("[aria-hidden='true']")?.className).toContain("bg-border")
  })

  it("renders the terminal toolbar when renderer platform is unavailable", async () => {
    window.synapse = {} as typeof window.synapse
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    expect(document.body.querySelector("[data-terminal-toolbar]")).toBeTruthy()
    expect(document.body.textContent).toContain("Ctrl+C")
    expect(document.body.textContent).toContain("Clear")
  })

  it("does not render the toolbar in the empty terminal state", async () => {
    await renderModule()

    expect(document.body.querySelector("[data-terminal-toolbar]")).toBeNull()
    expect(document.body.textContent).toContain("新建终端")
  })

  it("writes interrupt and slash actions into the running terminal", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await clickButton("Ctrl+C")
    await clickButton("/exit")
    await clickButton("/clear")

    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "\x03",
    })
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "/exit",
    })
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "/clear",
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
    })

    const writes = terminalBridge.writeSession.mock.calls.map(([input]) => input.data)
    expect(writes.filter((data) => data === "\r")).toHaveLength(2)
    expect(writes).not.toContain("/exit\r")
    expect(writes).not.toContain("/clear\r")
  })

  it("submits /clear with Enter after the command text has settled", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await clickButton("/clear")

    expect(terminalBridge.writeSession.mock.calls.map(([input]) => input)).toEqual([{
      sessionId: "session-1",
      data: "/clear",
    }])

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
    })

    expect(terminalBridge.writeSession.mock.calls.map(([input]) => input)).toEqual([
      { sessionId: "session-1", data: "/clear" },
      { sessionId: "session-1", data: "\r" },
    ])
  })

  it("keeps running-only toolbar actions disabled for a lost session while allowing local clear", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
      status: "lost",
    })]

    await renderModule()

    expect(buttonForText("Ctrl+C")?.disabled).toBe(true)
    expect(buttonForText("/exit")?.disabled).toBe(true)
    expect(buttonForText("/clear")?.disabled).toBe(true)
    expect(buttonForText("Clear")?.disabled).toBe(false)

    await clickButton("Clear")

    expect(xtermState.instances[0]?.clear).toHaveBeenCalled()
    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
  })

  it("shows a user-visible error when a toolbar write fails", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.writeSession.mockRejectedValueOnce(new Error("write failed"))

    await renderModule()
    await clickButton("Ctrl+C")

    expect(toastState.error).toHaveBeenCalledWith("写入终端失败")
  })

  it("keeps the terminal workspace full height", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
    })]

    await renderModule()

    const main = document.body.querySelector("main")
    const terminalRegion = document.querySelector("[aria-label^='终端输出与输入']")
    const xtermMount = terminalRegion?.querySelector("[data-terminal-xterm-mount]")
    const xtermFrame = xtermMount?.parentElement
    expect(main?.classList.contains("h-full")).toBe(true)
    expect(main?.classList.contains("min-h-0")).toBe(true)
    expect(terminalRegion?.parentElement?.classList.contains("h-full")).toBe(true)
    expect(terminalRegion?.classList.contains("flex-1")).toBe(true)
    expect(terminalRegion?.classList.contains("min-h-0")).toBe(true)
    expect(xtermMount).toBeTruthy()
    expect(xtermFrame?.hasAttribute("data-terminal-xterm-frame")).toBe(true)
    expect(xtermFrame?.classList.contains("p-1")).toBe(true)
    expect(xtermMount?.classList.contains("h-full")).toBe(true)
    expect(xtermMount?.classList.contains("p-1")).toBe(false)
    expect(xtermState.instances[0]?.open).toHaveBeenCalledWith(xtermMount)
  })

  it("opens a dark file tree as an overlay and follows the live working directory", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
    })]

    await renderModule()
    const xtermFrame = document.querySelector("[data-terminal-xterm-frame]")

    await clickButtonByAriaLabel("打开文件树：开发终端")

    const overlay = document.querySelector("[data-terminal-file-tree-overlay]")
    expect(overlay).toBeTruthy()
    expect(overlay?.parentElement).toBe(xtermFrame?.parentElement)
    expect(overlay?.querySelector('[aria-label="文件树"]')?.classList.contains("dark")).toBe(true)
    expect(terminalBridge.openWorkspaceTree).toHaveBeenCalledWith({ sessionId: "session-1" })

    await act(async () => {
      bridgeState.workingDirectoryChangedListener?.({ sessionId: "session-1" })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(terminalBridge.openWorkspaceTree).toHaveBeenCalledTimes(2)
    expect(document.querySelector("[data-terminal-xterm-frame]")).toBe(xtermFrame)

    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    })
    expect(document.querySelector("[data-terminal-file-tree-overlay]")).toBeTruthy()

    await act(async () => {
      xtermFrame?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    })
    expect(document.querySelector("[data-terminal-file-tree-overlay]")).toBeNull()
  })

  it("does not render session-level Agent control", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    expect(document.body.textContent).not.toContain("Agent 控制")
  })

  it("renames a terminal workspace by double-clicking its name", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await doubleClickSession("开发终端")
    await changeInput("终端名称", "  构建日志  ")
    await clickButton("保存")

    expect(terminalBridge.renameWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      title: "构建日志",
      expectedLayoutRevision: 1,
    })
    expect(document.body.textContent).toContain("构建日志")
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const renamedRow = Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"][data-track="terminal-session-select"]'))
      .find((element) => element.textContent?.includes("构建日志"))
    expect(document.activeElement).toBe(renamedRow)
  })

  it("renders a direct delete button instead of a session menu", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端", status: "ended" })]

    await renderModule()

    expect(document.body.querySelector('[aria-label="终端会话操作：开发终端"]')).toBeNull()
    expect(document.body.querySelector('[aria-label="关闭终端：开发终端"]')).toBeTruthy()
  })

  it("creates an empty terminal group and keeps it visible", async () => {
    await renderModule()

    await clickButton("新建分组")
    await changeInput("分组名称", "  构建  ")
    await clickButton("保存")

    expect(terminalBridge.createGroup).toHaveBeenCalledWith({ name: "构建" })
    expect(document.body.textContent).toContain("构建")
  })

  it("creates a terminal session from a group action", async () => {
    bridgeState.groups = [createGroup({ id: "group-build", name: "构建" })]

    await renderModule()
    await clickButtonByTitle("新建终端")

    expect(terminalBridge.createSession).toHaveBeenCalledWith({
      groupId: "group-build",
      cols: 80,
      rows: 24,
    })
  })

  it("collapses a terminal group without changing the active session", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    expect(document.querySelector("[data-slot='collapsible'][data-state='open']")).toBeTruthy()

    await clickButton("默认分组")

    expect(document.querySelector("[data-slot='collapsible'][data-state='closed']")).toBeTruthy()
    expect(document.querySelector("[aria-label^='终端输出与输入']")).toBeTruthy()
    expect(terminalBridge.attachSession).toHaveBeenLastCalledWith({ sessionId: "session-1" })
  })

  it("renames a terminal group from the group menu", async () => {
    bridgeState.groups = [createGroup({ id: "group-build", name: "构建" })]

    await renderModule()
    await clickGroupMenu("构建")
    await clickMenuItem("重命名")
    await changeInput("分组名称", "  发布  ")
    await clickButton("保存")

    expect(terminalBridge.renameGroup).toHaveBeenCalledWith({
      groupId: "group-build",
      name: "  发布  ",
    })
    expect(document.body.textContent).toContain("发布")
  })

  it("updates terminal group settings from the group menu", async () => {
    bridgeState.groups = [createGroup({
      id: "group-build",
      name: "构建",
      settings: {
        defaultCwd: "/repo/old",
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        }],
      },
    })]
    bridgeState.sessions = []

    await renderModule()
    await clickGroupMenu("构建")
    await clickMenuItem("设置")
    await changeInput("分组名称", "开发")
    await changeInput("工作目录", "/repo/app")
    await clickButton("保存")

    expect(terminalBridge.updateGroupSettings).toHaveBeenCalledWith({
      groupId: "group-build",
      name: "开发",
      expectedLaunchRevision: 1,
      settings: {
        defaultCwd: "/repo/app",
      },
    })
    expect(document.body.textContent).toContain("开发")
  })

  it("shows group command launch and management actions", async () => {
    bridgeState.groups = [createGroup({
      id: "group-1",
      name: "前端项目",
      settings: {
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        }],
      },
    })]

    await renderModule()
    await clickCommandMenu("前端项目")

    expect(document.body.textContent).toContain("dev")
    expect(document.body.textContent).toContain("管理命令")
  })

  it("launches a named command as a new terminal session", async () => {
    bridgeState.groups = [createGroup({
      id: "group-1",
      name: "前端项目",
      settings: {
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        }],
      },
    })]

    await renderModule()
    await clickCommandMenu("前端项目")
    await clickMenuItem("dev")

    expect(terminalBridge.launchGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-dev",
      cols: 80,
      rows: 24,
    })
    expect(document.body.textContent).toContain("dev")
  })

  it("keeps group settings focused on name and default directory", async () => {
    bridgeState.groups = [createGroup({
      id: "group-1",
      name: "前端项目",
      settings: {
        defaultCwd: "/repo/web",
        commands: [{
          id: "cmd-dev",
          name: "dev",
          command: "pnpm dev",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        }],
      },
    })]

    await renderModule()
    await clickGroupMenu("前端项目")
    await clickMenuItem("设置")

    expect(document.body.textContent).toContain("分组设置")
    expect(document.body.textContent).toContain("工作目录")
    expect(document.body.textContent).not.toContain("启动命令")
  })

  it("adds edits and deletes commands from command management", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "前端项目" })]

    await renderModule()
    await clickGroupMenu("前端项目")
    await clickMenuItem("命令")

    expect(document.body.textContent).toContain("命令")
    expect(document.body.textContent).toContain("暂无命令")
    expect(document.body.querySelector('input[aria-label="命令名称"]')).toBeNull()

    await clickButton("新增命令")

    expect(document.body.textContent).toContain("新增命令")
    await changeInput("命令名称", "dev")
    await changeTextarea("命令内容", "pnpm dev")
    await clickButton("保存")

    expect(terminalBridge.createGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      expectedCommandCollectionRevision: 1,
      name: "dev",
      command: "pnpm dev",
    })
    expect(document.body.querySelector('[data-slot="dialog-content"] [data-scrollbars="vertical"]')).not.toBeNull()

    await clickButtonByAriaLabel("编辑命令：dev")

    expect(document.body.textContent).toContain("编辑命令")
    await changeInput("命令名称", "test")
    await changeTextarea("命令内容", "pnpm test")
    await clickButton("保存")

    expect(terminalBridge.updateGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
      name: "test",
      command: "pnpm test",
      launch: {},
    })

    await clickButtonByAriaLabel("删除命令：test")

    expect(terminalBridge.deleteGroupCommand).toHaveBeenCalledWith({
      groupId: "group-1",
      commandId: "cmd-1",
    })
  })

  it("chooses a default directory when updating terminal group settings", async () => {
    bridgeState.groups = [createGroup({
      id: "group-build",
      name: "构建",
    })]
    bridgeState.sessions = []
    terminalBridge.chooseCwd.mockResolvedValueOnce("/repo/chosen")

    await renderModule()
    await clickGroupMenu("构建")
    await clickMenuItem("设置")
    await clickButton("选择")
    await clickButton("保存")

    expect(terminalBridge.chooseCwd).toHaveBeenCalled()
    expect(terminalBridge.updateGroupSettings).toHaveBeenCalledWith({
      groupId: "group-build",
      name: "构建",
      expectedLaunchRevision: 1,
      settings: {
        defaultCwd: "/repo/chosen",
      },
    })
  })

  it("shows an error when creating a terminal from a group fails", async () => {
    bridgeState.groups = [createGroup({ id: "group-build", name: "构建" })]
    bridgeState.sessions = []
    terminalBridge.createSession.mockRejectedValueOnce(new Error("Terminal cwd must be an existing absolute path"))

    await renderModule()
    await clickButtonByTitle("新建终端")

    expect(toastState.error).toHaveBeenCalledWith("新建终端失败")
  })

  it("deletes a terminal group with sessions and selects the next remaining session", async () => {
    bridgeState.groups = [
      createGroup({ id: "group-build", name: "构建", sortOrder: 0 }),
      createGroup({ id: "group-logs", name: "日志", sortOrder: 1 }),
    ]
    bridgeState.sessions = [
      createSession({ id: "session-1", groupId: "group-build", title: "构建终端", status: "ended", updatedAt: "2026-06-24T00:02:00.000Z" }),
      createSession({ id: "session-2", groupId: "group-logs", title: "日志终端", updatedAt: "2026-06-24T00:01:00.000Z" }),
    ]

    await renderModule()
    await clickGroupMenu("构建")
    await clickMenuItem("删除")
    expect(buttonForText("删除分组")?.dataset.variant).toBe("destructive")

    await clickButton("取消")
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(document.body.querySelector('[aria-label="终端分组操作：构建"]'))

    await clickGroupMenu("构建")
    await clickMenuItem("删除")
    await clickButton("删除分组")

    expect(terminalBridge.deleteGroup).toHaveBeenCalledWith({ groupId: "group-build" })
    expect(document.body.textContent).not.toContain("构建终端")
    expect(terminalBridge.attachSession).toHaveBeenLastCalledWith({ sessionId: "session-2" })
  })

  it("closes a terminal workspace and selects the next workspace", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [
      createSession({ id: "session-1", groupId: "group-1", title: "一号终端", status: "ended", updatedAt: "2026-06-24T00:02:00.000Z" }),
      createSession({ id: "session-2", groupId: "group-1", title: "二号终端", updatedAt: "2026-06-24T00:01:00.000Z" }),
    ]

    await renderModule()
    await clickSessionDelete("一号终端")

    expect(terminalBridge.closeWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      expectedLayoutRevision: 1,
    })
    expect(document.body.textContent).not.toContain("一号终端")
    expect(terminalBridge.attachSession).toHaveBeenLastCalledWith({ sessionId: "session-2" })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(document.body.querySelector('[data-track="terminal-session-select"][aria-current="page"]'))
  })

  it("deletes the last terminal session and returns to the empty state", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "临时终端", status: "ended" })]

    await renderModule()
    await clickSessionDelete("临时终端")

    expect(terminalBridge.closeWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      expectedLayoutRevision: 1,
    })
    expect(document.body.textContent).toContain("新建终端")
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(document.body.querySelector("[data-system-app-top-bar-actions] button"))
  })

  it("shows a user-visible error when creating a terminal fails", async () => {
    terminalBridge.createSession.mockRejectedValueOnce(new Error("spawn failed"))

    await renderModule()
    await clickButton("新建终端")

    expect(toastState.error).toHaveBeenCalledWith("新建终端失败")
  })

  it("shows a user-visible error when the terminal projection cannot be attached", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.attachSession.mockRejectedValueOnce(new Error("attach failed"))

    await renderModule()

    expect(toastState.error).toHaveBeenCalledWith("终端画面无法恢复")
    expect(document.body.textContent).toContain("终端画面无法恢复")
  })

  it("shows a user-visible error when terminal input cannot be written", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.writeSession.mockRejectedValueOnce(new Error("write failed"))

    await renderModule()

    await act(async () => {
      xtermState.instances[0]?.emitInput("pwd\r")
      await Promise.resolve()
    })

    expect(toastState.error).toHaveBeenCalledWith("写入终端失败")
  })

  it("writes one line feed for a Shift+Enter key sequence", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    const results: Array<boolean | undefined> = []
    const events = ["keydown", "keypress", "keyup"].map((type) => new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      shiftKey: true,
    }))
    await act(async () => {
      for (const event of events) {
        results.push(xtermState.instances[0]?.emitKeyEvent(event))
      }
      await Promise.resolve()
    })

    expect(results).toEqual([false, false, false])
    expect(events.every((event) => event.defaultPrevented)).toBe(true)
    expect(terminalBridge.writeSession).toHaveBeenCalledTimes(1)
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "\n",
    })
  })

  it("copies the current xterm selection with Cmd+C", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    await renderModule()
    xtermState.instances[0]?.hasSelection.mockReturnValue(true)
    xtermState.instances[0]?.getSelection.mockReturnValue("selected output")
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "c",
      metaKey: true,
    })

    await act(async () => {
      expect(xtermState.instances[0]?.emitKeyEvent(event)).toBe(false)
      await Promise.resolve()
    })

    expect(event.defaultPrevented).toBe(true)
    expect(writeText).toHaveBeenCalledWith("selected output")
    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
  })

  it("pastes clipboard text through xterm with Cmd+V", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const readText = vi.fn(async () => "first\nsecond")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    })

    await renderModule()
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "v",
      metaKey: true,
    })

    await act(async () => {
      expect(xtermState.instances[0]?.emitKeyEvent(event)).toBe(false)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(event.defaultPrevented).toBe(true)
    expect(terminalBridge.materializeClipboardImage).toHaveBeenCalledTimes(1)
    expect(readText).toHaveBeenCalledTimes(1)
    expect(xtermState.instances[0]?.paste).toHaveBeenCalledWith("first\nsecond")
  })

  it("pastes an image-only clipboard path through xterm with Cmd+V", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.materializeClipboardImage.mockResolvedValueOnce(
      "/Users/liyang/Library/Application Support/Synapse/terminal/clipboard-images/clipboard-image-1.png",
    )
    const readText = vi.fn(async () => "")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    })

    await renderModule()
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "v",
      metaKey: true,
    })

    await act(async () => {
      expect(xtermState.instances[0]?.emitKeyEvent(event)).toBe(false)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(event.defaultPrevented).toBe(true)
    expect(readText).not.toHaveBeenCalled()
    expect(xtermState.instances[0]?.paste).toHaveBeenCalledWith(
      "'/Users/liyang/Library/Application Support/Synapse/terminal/clipboard-images/clipboard-image-1.png'",
    )
  })

  it("splits the active pane to the right with Cmd+D while keeping one sidebar workspace", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "d", metaKey: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(terminalBridge.splitPane).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      paneId: "pane-session-1",
      direction: "right",
      expectedLayoutRevision: 1,
      cols: 80,
      rows: 24,
    })
    expect(document.querySelectorAll('[data-track="terminal-session-select"]')).toHaveLength(1)
    expect(xtermState.instances.filter((instance) => instance.dispose.mock.calls.length === 0)).toHaveLength(2)
  })

  it("renders a title bar and close button for every terminal pane", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "d", metaKey: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const paneHeaders = document.querySelectorAll("[data-terminal-pane-header]")
    expect(paneHeaders).toHaveLength(2)
    expect(paneHeaders[0]?.textContent).toContain("开发终端")
    expect(paneHeaders[1]?.textContent).toContain("Session 2")

    const closeButton = document.body.querySelector<HTMLButtonElement>('[aria-label="关闭分屏：Session 2"]')
    await act(async () => {
      closeButton?.click()
      await Promise.resolve()
    })

    expect(terminalBridge.closePane).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      paneId: "pane-session-2",
      expectedLayoutRevision: 2,
    })
  })

  it("dims only inactive panes when the workspace is split", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    const originalPane = document.querySelector<HTMLElement>('[aria-label="终端输出与输入：开发终端"]')
    expect(originalPane?.classList.contains("opacity-50")).toBe(false)

    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "d", metaKey: true }))
      await flushPromises()
    })

    const firstPane = document.querySelector<HTMLElement>('[aria-label="终端输出与输入：开发终端"]')
    const secondPane = document.querySelector<HTMLElement>('[aria-label="终端输出与输入：Session 2"]')
    expect(firstPane?.classList.contains("opacity-50")).toBe(true)
    expect(secondPane?.classList.contains("opacity-50")).toBe(false)

    await act(async () => {
      firstPane?.click()
    })

    expect(firstPane?.classList.contains("opacity-50")).toBe(false)
    expect(secondPane?.classList.contains("opacity-50")).toBe(true)
  })

  it("keeps visible panes clear when the active pane session is temporarily unavailable", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    const secondSession = createSession({ id: "session-2", groupId: "group-1", title: "终端二" })
    const thirdSession = createSession({ id: "session-3", groupId: "group-1", title: "终端三" })
    bridgeState.workspaces = [{
      ...createWorkspace(secondSession),
      layout: {
        type: "split",
        splitId: "split-1",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "leaf", paneId: "pane-missing", sessionId: "session-missing" },
        second: {
          type: "split",
          splitId: "split-2",
          direction: "vertical",
          ratio: 0.5,
          first: { type: "leaf", paneId: "pane-session-2", sessionId: secondSession.id },
          second: { type: "leaf", paneId: "pane-session-3", sessionId: thirdSession.id },
        },
      },
    }]

    await renderModule()

    const visiblePanes = document.querySelectorAll<HTMLElement>('[aria-label^="终端输出与输入："]')
    expect(visiblePanes).toHaveLength(2)
    expect([...visiblePanes].every((pane) => !pane.classList.contains("opacity-50"))).toBe(true)
  })

  it("moves a pane to a target edge by dragging its title bar", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "d", metaKey: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const sourceHeader = Array.from(document.querySelectorAll<HTMLElement>("[data-terminal-pane-header]"))
      .find((header) => header.textContent?.includes("Session 2"))
    const targetPane = document.querySelector<HTMLElement>('[aria-label="终端输出与输入：开发终端"]')
    if (!sourceHeader || !targetPane) throw new Error("Terminal panes not found")
    targetPane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300)
    const dataTransfer = createTerminalPaneDataTransfer()

    await dispatchTerminalPaneDragEvent(sourceHeader, "dragstart", dataTransfer, 0, 0)
    const dragOver = await dispatchTerminalPaneDragEvent(targetPane, "dragover", dataTransfer, 200, 290)

    expect(dragOver.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe("move")
    expect(targetPane.querySelector('[data-terminal-pane-drop-edge="bottom"]')).not.toBeNull()

    await dispatchTerminalPaneDragEvent(targetPane, "drop", dataTransfer, 200, 290)

    expect(terminalBridge.movePane).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      sourcePaneId: "pane-session-2",
      targetPaneId: "pane-session-1",
      edge: "bottom",
      expectedLayoutRevision: 2,
    })
    expect(targetPane.querySelector("[data-terminal-pane-drop-edge]")).toBeNull()
  })

  it("closes the active pane with Cmd+W", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }))
      await Promise.resolve()
    })

    expect(terminalBridge.closePane).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      paneId: "pane-session-1",
      expectedLayoutRevision: 1,
    })
  })

  it("queues rapid pane closes and uses the latest workspace revision", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    const firstSession = createSession({ id: "session-1", groupId: "group-1", title: "终端一" })
    const secondSession = createSession({ id: "session-2", groupId: "group-1", title: "终端二" })
    bridgeState.workspaces = [{
      ...createWorkspace(firstSession),
      layout: {
        type: "split",
        splitId: "split-1",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "leaf", paneId: "pane-session-1", sessionId: firstSession.id },
        second: { type: "leaf", paneId: "pane-session-2", sessionId: secondSession.id },
      },
    }]
    const firstClose = createDeferred<void>()
    terminalBridge.closePane.mockImplementationOnce(async ({ workspaceId }) => {
      await firstClose.promise
      bridgeState.workspaces = bridgeState.workspaces.map((workspace) => workspace.id === workspaceId
        ? { ...workspace, closingPaneIds: ["pane-session-1"], layoutRevision: 2 }
        : workspace)
      return { workspaceId, state: "closing" as const, remainingSessionIds: [firstSession.id, secondSession.id] }
    })

    await renderModule()
    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(terminalBridge.closePane).toHaveBeenCalledTimes(1)
    const firstCloseButton = document.body.querySelector<HTMLButtonElement>('[aria-label="正在关闭分屏：终端一"]')
    expect(firstCloseButton?.disabled).toBe(true)

    const secondPane = document.body.querySelector<HTMLElement>('[aria-label="终端输出与输入：终端二"]')
    await act(async () => {
      secondPane?.click()
      xtermState.instances[1]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }))
      xtermState.instances[1]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }))
      await Promise.resolve()
    })

    expect(terminalBridge.closePane).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstClose.resolve()
      await flushPromises()
    })

    expect(terminalBridge.closePane).toHaveBeenCalledTimes(2)
    expect(terminalBridge.closePane).toHaveBeenLastCalledWith({
      workspaceId: "workspace-session-1",
      paneId: "pane-session-2",
      expectedLayoutRevision: 2,
    })
  })

  it("refreshes the workspace revision after a pane close conflict", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.closePane.mockImplementationOnce(async ({ workspaceId }) => {
      bridgeState.workspaces = bridgeState.workspaces.map((workspace) => workspace.id === workspaceId
        ? { ...workspace, layoutRevision: 2 }
        : workspace)
      throw new Error("revision_conflict")
    })

    await renderModule()
    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }))
      await flushPromises()
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }))
      await flushPromises()
    })

    expect(terminalBridge.closePane).toHaveBeenCalledTimes(2)
    expect(terminalBridge.closePane).toHaveBeenLastCalledWith({
      workspaceId: "workspace-session-1",
      paneId: "pane-session-1",
      expectedLayoutRevision: 2,
    })
  })

  it("queues a sidebar workspace close behind an in-flight pane close", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const paneClose = createDeferred<void>()
    terminalBridge.closePane.mockImplementationOnce(async ({ workspaceId }) => {
      await paneClose.promise
      bridgeState.workspaces = bridgeState.workspaces.map((workspace) => workspace.id === workspaceId
        ? { ...workspace, closingPaneIds: ["pane-session-1"], layoutRevision: 2 }
        : workspace)
      return { workspaceId, state: "closing" as const, remainingSessionIds: ["session-1"] }
    })

    await renderModule()
    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }))
      await Promise.resolve()
    })
    await clickSessionDelete("开发终端")

    expect(terminalBridge.closeWorkspace).not.toHaveBeenCalled()

    await act(async () => {
      paneClose.resolve()
      await flushPromises()
    })

    expect(terminalBridge.closeWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace-session-1",
      expectedLayoutRevision: 2,
    })
  })

  it("does not let an older domain refresh overwrite a newer workspace", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    const session = createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })
    await renderModule()
    const olderRefresh = createDeferred<SynapseTerminalWorkspace[]>()
    const newerRefresh = createDeferred<SynapseTerminalWorkspace[]>()
    terminalBridge.listWorkspaces
      .mockImplementationOnce(() => olderRefresh.promise)
      .mockImplementationOnce(() => newerRefresh.promise)

    act(() => {
      bridgeState.domainChangedListener?.({})
      bridgeState.domainChangedListener?.({})
    })
    await act(async () => {
      newerRefresh.resolve([{ ...createWorkspace(session), title: "最新名称", layoutRevision: 3 }])
      await flushPromises()
      olderRefresh.resolve([{ ...createWorkspace(session), title: "旧名称", layoutRevision: 2 }])
      await flushPromises()
    })

    expect(document.body.textContent).toContain("最新名称")
    expect(document.body.textContent).not.toContain("旧名称")
  })

  it("leaves plain Enter, modified Shift+Enter, and IME input to xterm", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    const events = [
      new KeyboardEvent("keydown", { key: "Enter" }),
      new KeyboardEvent("keydown", { altKey: true, key: "Enter", shiftKey: true }),
      new KeyboardEvent("keydown", { ctrlKey: true, key: "Enter", shiftKey: true }),
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, shiftKey: true }),
      new KeyboardEvent("keydown", { isComposing: true, key: "Enter", shiftKey: true }),
    ]

    expect(events.map((event) => xtermState.instances[0]?.emitKeyEvent(event)))
      .toEqual([true, true, true, true, true])
    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
  })

  it("keeps ongoing speech input inside the terminal viewport", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    const screen = document.querySelector<HTMLElement>(".xterm-screen")!
    const textarea = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!
    const composition = document.querySelector<HTMLElement>(".composition-view")!
    composition.style.left = "180px"
    Object.defineProperty(screen, "clientWidth", { value: 240 })
    Object.defineProperty(composition, "scrollWidth", { value: 320 })

    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "持续增长的语音输入" }))

    expect(composition.style.maxWidth).toBe("60px")
    expect(composition.scrollLeft).toBe(320)
  })

  it("does not write Shift+Enter into a read-only terminal", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
      status: "lost",
    })]

    await renderModule()

    const result = xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
    }))

    expect(result).toBe(false)
    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
  })

  it("shows a user-visible error when Shift+Enter cannot be written", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.writeSession.mockRejectedValueOnce(new Error("write failed"))

    await renderModule()

    await act(async () => {
      xtermState.instances[0]?.emitKeyEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
      }))
      await Promise.resolve()
    })

    expect(toastState.error).toHaveBeenCalledWith("写入终端失败")
  })

  it("inserts a dragged file path into the running terminal", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const file = createDroppedFile("report.txt", "/Users/liyang/Documents/report.txt")

    await renderModule()
    const dragOverEvent = await dispatchTerminalDragEvent("dragover", [file])
    await dispatchTerminalDragEvent("drop", [file])

    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dragOverEvent.dataTransfer.dropEffect).toBe("copy")
    expect(shellBridge.filePathForDroppedFile).toHaveBeenCalledWith(file)
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "/Users/liyang/Documents/report.txt ",
    })
  })

  it("inserts a dragged folder path into the running terminal", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const folder = createDroppedFile("Projects", "/Users/liyang/Projects")

    await renderModule()
    await dispatchTerminalDragEvent("drop", [folder])

    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "/Users/liyang/Projects ",
    })
  })

  it("inserts multiple dragged paths in order with shell escaping", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const first = createDroppedFile("Quarterly Report (final).txt", "/Users/liyang/My Files/Quarterly Report (final).txt")
    const second = createDroppedFile("costs&notes\"$\\.md", "/tmp/costs&notes\"$\\.md")

    await renderModule()
    await dispatchTerminalDragEvent("drop", [first, second])

    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "/Users/liyang/My\\ Files/Quarterly\\ Report\\ \\(final\\).txt /tmp/costs\\&notes\\\"\\$\\\\.md ",
    })
  })

  it("inserts selected file-tree paths and shows drop feedback", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.resolveWorkspaceTreePaths.mockResolvedValue({
      scopeId: "scope-1",
      paths: ["/Users/liyang/My Files/first.ts", "/tmp/second.md"],
    })
    const dragPayload = { scopeId: "scope-1", relativePaths: ["first.ts", "second.md"] }
    const payload = JSON.stringify(dragPayload)
    writeWorkspaceFileTreeDrag({
      effectAllowed: "none",
      setData: vi.fn(),
    } as unknown as DataTransfer, dragPayload)

    await renderModule()
    const dragOver = await dispatchTerminalWorkspaceTreeDragEvent("dragover", payload, [])
    expect(dragOver.defaultPrevented).toBe(true)
    expect(document.body.textContent).toContain("松开插入路径")

    await dispatchTerminalWorkspaceTreeDragEvent("drop", "", [])

    expect(terminalBridge.resolveWorkspaceTreePaths).toHaveBeenCalledWith({
      scopeId: "scope-1",
      relativePaths: ["first.ts", "second.md"],
    })
    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "/Users/liyang/My\\ Files/first.ts /tmp/second.md ",
    })
    expect(document.body.textContent).not.toContain("松开插入路径")
  })

  it("rejects dropped paths containing line breaks", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const file = createDroppedFile("bad.txt", "/tmp/bad\nname.txt")

    await renderModule()
    await dispatchTerminalDragEvent("drop", [file])

    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
    expect(toastState.error).toHaveBeenCalledWith("拖拽路径不可用")
  })

  it("does not insert unresolved dropped file names", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const file = createDroppedFile("missing.txt", null)

    await renderModule()
    await dispatchTerminalDragEvent("drop", [file])

    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
    expect(toastState.error).toHaveBeenCalledWith("拖拽路径不可用")
  })

  it("does not write dropped paths into a non-running terminal", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
      status: "exited",
    })]
    const file = createDroppedFile("report.txt", "/tmp/report.txt")

    await renderModule()
    await dispatchTerminalDragEvent("drop", [file])

    expect(terminalBridge.writeSession).not.toHaveBeenCalled()
    expect(toastState.error).toHaveBeenCalledWith("终端未运行")
  })

  it("chunks very long dragged path input below the terminal write limit", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const first = createDroppedFile("first.txt", `/tmp/${"a".repeat(35_000)}.txt`)
    const second = createDroppedFile("second.txt", `/tmp/${"b".repeat(35_000)}.txt`)

    await renderModule()
    await dispatchTerminalDragEvent("drop", [first, second])

    const writes = terminalBridge.writeSession.mock.calls.map(([input]) => input)
    expect(writes.length).toBeGreaterThan(1)
    expect(writes.every((input) => input.sessionId === "session-1")).toBe(true)
    expect(writes.every((input) => input.data.length <= 64 * 1024)).toBe(true)
    expect(writes.map((input) => input.data).join("")).toBe(`${first.path} ${second.path} `)
  })

  it("creates xterm with iTerm-like rendering defaults", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    const options = vi.mocked(XtermTerminal).mock.calls[0]?.[0]
    expect(options?.fontFamily).toContain("MesloLGS NF")
    expect(options?.fontFamily).toContain("Meslo LG S for Powerline")
    expect(XtermTerminal).toHaveBeenCalledWith(expect.objectContaining({
      customGlyphs: true,
      cursorStyle: "block",
      fontSize: expect.any(Number),
      letterSpacing: 0,
      lineHeight: 1.1,
      smoothScrollDuration: 80,
      theme: expect.objectContaining({
        background: expect.any(String),
        foreground: expect.any(String),
        cursor: expect.any(String),
        selectionBackground: expect.any(String),
        blue: expect.any(String),
        brightBlue: expect.any(String),
      }),
    }))
  })

  it("loads the WebGL renderer so custom Powerline glyphs are drawn outside the DOM font path", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    expect(WebglAddon).toHaveBeenCalledTimes(1)
    expect(xtermState.instances[0]?.loadAddon).toHaveBeenCalledWith(webglState.instances[0])
    expect(xtermState.instances[0]?.open.mock.invocationCallOrder[0])
      .toBeLessThan(xtermState.instances[0]?.loadAddon.mock.invocationCallOrder.at(-1) ?? 0)
    expect(webglState.instances[0]?.onContextLoss).toHaveBeenCalled()
  })

  it("attaches the authoritative snapshot before requesting container geometry", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    bridgeState.chunks = [createChunk({ sessionId: "session-1", seq: 1, data: "ready\r\n" })]

    await renderModule()

    const attachCallOrder = terminalBridge.attachSession.mock.invocationCallOrder[0]
    const resizeCallOrder = terminalBridge.resizeSession.mock.invocationCallOrder[0]
    const writeCallOrder = xtermState.instances[0]?.write.mock.invocationCallOrder[0]
    expect(attachCallOrder).toBeLessThan(writeCallOrder ?? 0)
    expect(writeCallOrder).toBeLessThan(resizeCallOrder ?? 0)
    expect(xtermState.fitInstances[0]?.fit).not.toHaveBeenCalled()
    expect(terminalBridge.resizeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      cols: 100,
      rows: 30,
    })
  })

  it("redraws the terminal after local clear without clearing the shared WebGL atlas", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    xtermState.fitInstances[0]?.fit.mockClear()
    xtermState.instances[0]?.refresh.mockClear()
    webglState.instances[0]?.clearTextureAtlas.mockClear()
    terminalBridge.resizeSession.mockClear()

    await clickButton("Clear")

    expect(xtermState.instances[0]?.clear).toHaveBeenCalled()
    expect(xtermState.fitInstances[0]?.fit).not.toHaveBeenCalled()
    expect(xtermState.instances[0]?.refresh).toHaveBeenCalledWith(0, xtermState.instances[0]!.rows - 1)
    expect(webglState.instances[0]?.clearTextureAtlas).not.toHaveBeenCalled()
    expect(terminalBridge.resizeSession).not.toHaveBeenCalled()
  })

  it("opens terminal web links through the system shell", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    const handler = xtermState.webLinksInstances[0]?.handler
    expect(handler).toEqual(expect.any(Function))

    await act(async () => {
      handler?.(new MouseEvent("click"), "http://localhost:5173/")
      await Promise.resolve()
    })

    expect(shellBridge.openExternal).toHaveBeenCalledWith("http://localhost:5173/")
  })

  it("shows a user-visible error when a terminal web link cannot be opened", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    shellBridge.openExternal.mockRejectedValueOnce(new Error("open failed"))

    await renderModule()

    await act(async () => {
      xtermState.webLinksInstances[0]?.handler?.(new MouseEvent("click"), "http://localhost:5173/")
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toastState.error).toHaveBeenCalledWith("打开链接失败")
  })

  it("attaches to a session, streams data, writes input, and cleans up without stopping it", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    bridgeState.chunks = [createChunk({ sessionId: "session-1", seq: 1, data: "ready\r\n" })]
    bridgeState.nextSeq = 1

    await renderModule()

    expect(terminalBridge.attachSession).toHaveBeenCalledWith({ sessionId: "session-1" })
    expect(xtermState.instances[0]?.write.mock.calls.map(([data]) => data)).toContain("ready\r\n")
    expect(terminalBridge.runStartupCommand).not.toHaveBeenCalled()

    await act(async () => {
      xtermState.instances[0]?.emitInput("pwd\r")
      await Promise.resolve()
    })

    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "pwd\r",
    })

    await act(async () => {
      bridgeState.dataListener?.({
        sessionId: "session-1",
        chunk: createChunk({ sessionId: "session-1", seq: 1, data: "old" }),
      })
      bridgeState.dataListener?.({
        sessionId: "other-session",
        chunk: createChunk({ sessionId: "other-session", seq: 2, data: "other" }),
      })
      bridgeState.dataListener?.({
        sessionId: "session-1",
        chunk: createChunk({ sessionId: "session-1", seq: 2, data: "next\r\n" }),
      })
      resizeObservers[0]?.trigger()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(xtermState.instances[0]?.write.mock.calls.map(([data]) => data)).toContain("next\r\n")
    expect(xtermState.instances[0]?.write.mock.calls.map(([data]) => data)).not.toContain("old")
    expect(xtermState.instances[0]?.write.mock.calls.map(([data]) => data)).not.toContain("other")
    expect(terminalBridge.resizeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      cols: 100,
      rows: 30,
    })

    act(() => {
      roots[0]?.unmount()
    })

    expect(bridgeState.dataUnsubscribe).toHaveBeenCalled()
    expect(bridgeState.sessionChangedUnsubscribe).toHaveBeenCalled()
    expect(bridgeState.sessionDeletedUnsubscribe).toHaveBeenCalled()
    expect(bridgeState.resizedUnsubscribe).toHaveBeenCalled()
    expect(xtermState.instances[0]?.inputDispose).toHaveBeenCalled()
    expect(xtermState.instances[0]?.dispose).toHaveBeenCalled()
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalled()
    expect(terminalBridge.stopSession).not.toHaveBeenCalled()
  })

  it("does not resize the pty repeatedly when observer reports unchanged dimensions", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    act(() => {
      resizeObservers[0]?.trigger()
      resizeObservers[0]?.trigger()
    })

    expect(terminalBridge.resizeSession).toHaveBeenCalledTimes(1)
    expect(terminalBridge.resizeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      cols: 100,
      rows: 30,
    })
  })

  it("keeps one xterm instance when session lifecycle changes", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    const session = createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })
    bridgeState.sessions = [session]

    await renderModule()

    await act(async () => {
      bridgeState.sessionChangedListener?.({
        ...session,
        status: "ended",
        stateRevision: session.stateRevision + 1,
      })
      await Promise.resolve()
    })

    expect(xtermState.instances).toHaveLength(1)
    expect(xtermState.instances[0]?.dispose).not.toHaveBeenCalled()
    expect(xtermState.instances[0]?.options.disableStdin).toBe(true)
  })

  it("applies output before and after a resize at the authoritative output watermark", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    const session = createSession({
      id: "session-1",
      groupId: "group-1",
      title: "开发终端",
      lastOutputSeq: 1,
    })
    bridgeState.sessions = [session]
    bridgeState.chunks = [createChunk({ sessionId: session.id, seq: 1, data: "snapshot" })]

    await renderModule()
    const xterm = xtermState.instances[0]!
    xterm.write.mockClear()
    xterm.refresh.mockClear()
    xterm.resize.mockClear()
    webglState.instances[0]?.clearTextureAtlas.mockClear()

    await act(async () => {
      bridgeState.sessionChangedListener?.({
        ...session,
        cols: 100,
        rows: 30,
        lastOutputSeq: 3,
        sizeRevision: 2,
        stateRevision: session.stateRevision + 1,
      })
      bridgeState.dataListener?.({
        sessionId: session.id,
        chunk: createChunk({ sessionId: session.id, seq: 2, data: "old-geometry" }),
      })
      bridgeState.dataListener?.({
        sessionId: session.id,
        chunk: createChunk({ sessionId: session.id, seq: 3, data: "new-geometry" }),
      })
      bridgeState.resizedListener?.({
        sessionId: session.id,
        cols: 100,
        rows: 30,
        sizeRevision: 2,
        throughOutputSeq: 2,
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const oldWriteOrder = xterm.write.mock.calls
      .find((call) => call[0] === "old-geometry")?.[1]
    const oldWriteInvocation = xterm.write.mock.invocationCallOrder[
      xterm.write.mock.calls.findIndex((call) => call[0] === "old-geometry")
    ]
    const newWriteInvocation = xterm.write.mock.invocationCallOrder[
      xterm.write.mock.calls.findIndex((call) => call[0] === "new-geometry")
    ]
    const resizeInvocation = xterm.resize.mock.invocationCallOrder[0]
    expect(oldWriteOrder).toEqual(expect.any(Function))
    expect(oldWriteInvocation).toBeLessThan(resizeInvocation ?? 0)
    expect(resizeInvocation).toBeLessThan(newWriteInvocation ?? 0)
    expect(xterm.refresh).toHaveBeenCalledWith(0, 29)
    expect(webglState.instances[0]?.clearTextureAtlas).not.toHaveBeenCalled()
    expect(xtermState.instances).toHaveLength(1)
  })

  it("does not request startup commands from terminal output", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    bridgeState.chunks = [
      createChunk({ sessionId: "session-1", seq: 1, data: "\u001b[?2004h" }),
    ]

    await renderModule()

    expect(terminalBridge.runStartupCommand).not.toHaveBeenCalled()

    act(() => {
      bridgeState.dataListener?.({
        sessionId: "session-1",
        chunk: createChunk({ sessionId: "session-1", seq: 2, data: "(base) $ " }),
      })
    })

    expect(terminalBridge.runStartupCommand).not.toHaveBeenCalled()
  })

  it("does not lose or duplicate data emitted before the authoritative snapshot attaches", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const liveChunk = createChunk({ sessionId: "session-1", seq: 2, data: "during-read\r\n" })
    bridgeState.deferredAttach = createDeferredAttach()

    await renderModule()

    act(() => {
      bridgeState.dataListener?.({
        sessionId: "session-1",
        chunk: liveChunk,
      })
    })

    await act(async () => {
      bridgeState.deferredAttach?.resolve({
        session: getSession("session-1"),
        degraded: false,
        serialized: "ready\r\n",
        cols: 80,
        rows: 24,
        throughOutputSeq: 1,
        sizeRevision: 1,
        emulatorId: "xterm-headless",
        emulatorVersion: "6.0.0",
        scrollbackTruncated: false,
        reasons: [],
      })
      await Promise.resolve()
    })

    const writes = xtermState.instances[0]?.write.mock.calls.map(([data]) => data)
    expect(writes).toContain("ready\r\n")
    expect(writes).toContain("during-read\r\n")
    expect(writes?.filter((data) => data === "during-read\r\n")).toHaveLength(1)
  })

  it("does not report an attach error when an MCP deletion races the active attach", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    bridgeState.deferredAttach = createDeferredAttach()

    await renderModule()

    await act(async () => {
      bridgeState.sessionDeletedListener?.({ sessionId: "session-1" })
      bridgeState.deferredAttach?.reject(new Error("session not found"))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("暂无会话")
    expect(toastState.error).not.toHaveBeenCalledWith("终端画面无法恢复")
  })

  it("restores a switched session from one authoritative snapshot without replaying raw history", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [
      createSession({
        id: "session-1",
        groupId: "group-1",
        title: "构建终端",
        updatedAt: "2026-06-24T00:02:00.000Z",
      }),
      createSession({
        id: "session-2",
        groupId: "group-1",
        title: "日志终端",
        updatedAt: "2026-06-24T00:01:00.000Z",
      }),
    ]

    await renderModule()
    await clickSession("日志终端")

    bridgeState.sessions = bridgeState.sessions.map((session) => session.id === "session-1"
      ? { ...session, lastOutputSeq: 3 }
      : session)
    bridgeState.chunks = [
      createChunk({ sessionId: "session-1", seq: 1, data: "before-switch\r\n" }),
      createChunk({ sessionId: "session-1", seq: 2, data: "while-hidden-1\r\n" }),
      createChunk({ sessionId: "session-1", seq: 3, data: "while-hidden-2\r\n" }),
    ]
    terminalBridge.attachSession.mockImplementation(async ({ sessionId }) => {
      const session = getSession(sessionId)
      const chunks = bridgeState.chunks.filter((chunk) => chunk.sessionId === sessionId)
      return {
        session,
        degraded: false as const,
        serialized: "restored-screen",
        cols: session.cols,
        rows: session.rows,
        throughOutputSeq: chunks.at(-1)?.seq ?? 0,
        sizeRevision: session.sizeRevision,
        emulatorId: "xterm-headless" as const,
        emulatorVersion: "6.0.0" as const,
        scrollbackTruncated: false,
        reasons: [] as [],
      }
    })
    terminalBridge.attachSession.mockClear()

    await clickSession("构建终端")

    const restoredWrites = xtermState.instances.at(-1)?.write.mock.calls.map(([data]) => data)
    expect(restoredWrites).toEqual(["restored-screen"])
    expect(terminalBridge.attachSession).toHaveBeenCalledTimes(1)
    expect(terminalBridge.attachSession).toHaveBeenCalledWith({ sessionId: "session-1" })
    expect(terminalBridge.readSession).not.toHaveBeenCalled()
  })
})

async function renderModule(
  props: NonNullable<Parameters<typeof TerminalModule>[0]> = {},
): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<TerminalModule {...props} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderEmbeddedModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(
      <EmbeddedSystemAppShell appName="终端" onBack={vi.fn()} onOpenWindow={vi.fn()}>
        <TerminalModule />
      </EmbeddedSystemAppShell>,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function clickButton(text: string, root: ParentNode = document.body): Promise<void> {
  const button = buttonForText(text, root)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
}

function buttonForText(text: string, root: ParentNode = document.body): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll("button"))
    .find((item) => item.textContent === text)
}

async function clickButtonByTitle(title: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.getAttribute("title") === title)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
}

async function clickSessionDelete(title: string): Promise<void> {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="关闭终端：${title}"]`)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
}

async function doubleClickSession(title: string): Promise<void> {
  const row = Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"][data-track="terminal-session-select"]'))
    .find((element) => element.textContent?.includes(title))
  await act(async () => {
    row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    await Promise.resolve()
  })
}

async function clickSession(title: string): Promise<void> {
  const row = Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"][data-track="terminal-session-select"]'))
    .find((element) => element.textContent?.includes(title))
  await act(async () => {
    row?.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function clickGroupMenu(name: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.getAttribute("aria-label") === `终端分组操作：${name}`)
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }))
    button?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))
    button?.click()
    await Promise.resolve()
  })
}

async function clickCommandMenu(name: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.getAttribute("aria-label") === `以命令启动：${name}`)
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }))
    button?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))
    button?.click()
    await Promise.resolve()
  })
}

async function clickButtonByAriaLabel(label: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.getAttribute("aria-label") === label)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
}

async function clickMenuItem(text: string): Promise<void> {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'))
    .find((element) => element.textContent === text)
  await act(async () => {
    item?.click()
    await Promise.resolve()
  })
}

async function changeInput(label: string, value: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  await act(async () => {
    if (input) {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      valueSetter?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }
    await Promise.resolve()
  })
}

async function changeTextarea(label: string, value: string): Promise<void> {
  const textarea = document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
  await act(async () => {
    if (textarea) {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      valueSetter?.call(textarea, value)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      textarea.dispatchEvent(new Event("change", { bubbles: true }))
    }
    await Promise.resolve()
  })
}

async function changeSelect(label: string, value: string): Promise<void> {
  const select = document.body.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  await act(async () => {
    if (select) {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
      valueSetter?.call(select, value)
      select.dispatchEvent(new Event("change", { bubbles: true }))
    }
    await Promise.resolve()
  })
}

async function selectTab(label: string): Promise<void> {
  const tab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find((button) => button.textContent === label)
  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    tab?.click()
    await Promise.resolve()
  })
}

type DroppedTerminalFile = File & { readonly path: string | null }

function createDroppedFile(name: string, path: string | null): DroppedTerminalFile {
  const file = new File([""], name) as DroppedTerminalFile
  droppedPathState.paths.set(file, path)
  Object.defineProperty(file, "path", {
    value: path,
    configurable: true,
  })
  return file
}

type TerminalDragTestEvent = Event & {
  readonly dataTransfer: {
    readonly files: DroppedTerminalFile[]
    readonly items: Array<{ readonly kind: "file"; readonly type: string; getAsFile: () => DroppedTerminalFile }>
    readonly types: string[]
    dropEffect: string
    effectAllowed: string
  }
}

async function dispatchTerminalDragEvent(
  type: "dragover" | "drop",
  files: DroppedTerminalFile[],
): Promise<TerminalDragTestEvent> {
  const terminalRegion = document.querySelector<HTMLElement>("[aria-label^='终端输出与输入']")
  if (!terminalRegion) throw new Error("Terminal region not found")

  const dataTransfer = {
    files,
    items: files.map((file) => ({
      kind: "file" as const,
      type: file.type,
      getAsFile: () => file,
    })),
    types: ["Files"],
    dropEffect: "none",
    effectAllowed: "all",
  }
  const event = new Event(type, { bubbles: true, cancelable: true }) as TerminalDragTestEvent
  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer,
    configurable: true,
  })

  await act(async () => {
    terminalRegion.dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()
  })
  return event
}

async function dispatchTerminalWorkspaceTreeDragEvent(
  type: "dragover" | "drop",
  payload: string,
  types = [WORKSPACE_FILE_TREE_DRAG_TYPE],
): Promise<TerminalDragTestEvent> {
  const terminalRegion = document.querySelector<HTMLElement>("[aria-label^='终端输出与输入']")
  if (!terminalRegion) throw new Error("Terminal region not found")
  const dataTransfer = {
    files: [],
    items: [],
    types,
    dropEffect: "none",
    effectAllowed: "all",
    getData: (requestedType: string) => requestedType === WORKSPACE_FILE_TREE_DRAG_TYPE ? payload : "",
  }
  const event = new Event(type, { bubbles: true, cancelable: true }) as TerminalDragTestEvent
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer, configurable: true })

  await act(async () => {
    terminalRegion.dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()
  })
  return event
}

type TerminalPaneDataTransfer = {
  files: File[]
  items: never[]
  types: string[]
  dropEffect: string
  effectAllowed: string
  getData: (type: string) => string
  setData: (type: string, value: string) => void
}

function createTerminalPaneDataTransfer(): TerminalPaneDataTransfer {
  const data = new Map<string, string>()
  const transfer: TerminalPaneDataTransfer = {
    files: [],
    items: [],
    types: [],
    dropEffect: "none",
    effectAllowed: "all",
    getData: (type) => data.get(type) ?? "",
    setData: (type, value) => {
      data.set(type, value)
      if (!transfer.types.includes(type)) transfer.types.push(type)
    },
  }
  return transfer
}

async function dispatchTerminalPaneDragEvent(
  target: HTMLElement,
  type: "dragstart" | "dragover" | "drop",
  dataTransfer: TerminalPaneDataTransfer,
  clientX: number,
  clientY: number,
): Promise<Event> {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer, configurable: true })
  await act(async () => {
    target.dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()
  })
  return event
}

function createGroup(overrides: Partial<SynapseTerminalGroup> = {}): SynapseTerminalGroup {
  return {
    id: "group-1",
    name: "默认分组",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    sortOrder: 0,
    groupRevision: 1,
    launchRevision: 1,
    membershipRevision: 1,
    commandCollectionRevision: 1,
    ...overrides,
  }
}

function createSession(overrides: Partial<SynapseTerminalSession> = {}): SynapseTerminalSession {
  const session = {
    id: "session-1",
    groupId: "group-1",
    title: "Session 1",
    cwd: "/tmp",
    shell: "zsh",
    status: "running",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    cols: 80,
    rows: 24,
    lastOutputSeq: 0,
    stateRevision: 1,
    inputRevision: 0,
    sizeRevision: 1,
    ...overrides,
  } satisfies SynapseTerminalSession
  bridgeState.sessions = bridgeState.sessions.some((item) => item.id === session.id)
    ? bridgeState.sessions.map((item) => item.id === session.id ? session : item)
    : [...bridgeState.sessions, session]
  if (!bridgeState.workspaces.some((workspace) => workspace.layout.type === "leaf" && workspace.layout.sessionId === session.id)) {
    bridgeState.workspaces = [...bridgeState.workspaces, createWorkspace(session)]
  }
  return session
}

function createWorkspace(session: SynapseTerminalSession): SynapseTerminalWorkspace {
  return {
    id: `workspace-${session.id}`,
    groupId: session.groupId,
    title: session.title,
    layout: { type: "leaf", paneId: `pane-${session.id}`, sessionId: session.id },
    layoutRevision: 1,
    closingPaneIds: [],
    closing: false,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function getWorkspace(workspaceId: string): SynapseTerminalWorkspace {
  const workspace = bridgeState.workspaces.find((item) => item.id === workspaceId)
  if (!workspace) throw new Error("Workspace not found")
  return workspace
}

function workspaceHasSession(workspace: SynapseTerminalWorkspace, sessionId: string): boolean {
  const visit = (layout: SynapseTerminalWorkspace["layout"]): boolean => layout.type === "leaf"
    ? layout.sessionId === sessionId
    : visit(layout.first) || visit(layout.second)
  return visit(workspace.layout)
}

function createChunk(overrides: Partial<SynapseTerminalOutputChunk> = {}): SynapseTerminalOutputChunk {
  return {
    sessionId: "session-1",
    seq: 1,
    data: "ready\r\n",
    createdAt: "2026-06-24T00:00:00.000Z",
    source: "pty",
    ...overrides,
  }
}

function getSession(sessionId: string): SynapseTerminalSession {
  const session = bridgeState.sessions.find((item) => item.id === sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  return session
}

function createDeferredAttach(): NonNullable<typeof bridgeState.deferredAttach> {
  let resolve: (value: unknown) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<unknown>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value?: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}
