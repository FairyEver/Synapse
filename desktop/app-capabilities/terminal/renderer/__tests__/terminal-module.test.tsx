/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  SynapseTerminalDataEvent,
  SynapseTerminalGroup,
  SynapseTerminalOutputChunk,
  SynapseTerminalSession,
  SynapseTerminalUpdateGroupSettingsInput,
} from "../../../../src/types/terminal"

const bridgeState = vi.hoisted(() => ({
  groups: [] as SynapseTerminalGroup[],
  sessions: [] as SynapseTerminalSession[],
  chunks: [] as SynapseTerminalOutputChunk[],
  nextSeq: 0,
  dataListener: null as ((event: SynapseTerminalDataEvent) => void) | null,
  sessionChangedListener: null as ((session: SynapseTerminalSession) => void) | null,
  sessionDeletedListener: null as ((event: { sessionId: string }) => void) | null,
  dataUnsubscribe: vi.fn(),
  sessionChangedUnsubscribe: vi.fn(),
  sessionDeletedUnsubscribe: vi.fn(),
  deferredRead: null as null | {
    promise: Promise<unknown>
    resolve: (value: unknown) => void
  },
}))

const terminalBridge = vi.hoisted(() => ({
  chooseDefaultCwd: vi.fn(async () => "/repo/app"),
  listGroups: vi.fn(async () => bridgeState.groups),
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
  deleteGroup: vi.fn(async ({ groupId }: { groupId: string }) => {
    const removedSessionIds = new Set(bridgeState.sessions
      .filter((session) => session.groupId === groupId)
      .map((session) => session.id))
    bridgeState.groups = bridgeState.groups.filter((group) => group.id !== groupId)
    bridgeState.sessions = bridgeState.sessions.filter((session) => session.groupId !== groupId)
    bridgeState.chunks = bridgeState.chunks.filter((chunk) => !removedSessionIds.has(chunk.sessionId))
  }),
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
  readSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
    if (bridgeState.deferredRead) return bridgeState.deferredRead.promise
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
}))

const xtermState = vi.hoisted(() => ({
  instances: [] as Array<{
    open: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    cols: number
    rows: number
    emitInput: (data: string) => void
    inputDispose: ReturnType<typeof vi.fn>
    inputListener: ((data: string) => void) | null
  }>,
  fitInstances: [] as Array<{ fit: ReturnType<typeof vi.fn>; proposeDimensions: ReturnType<typeof vi.fn> }>,
  webLinksInstances: [] as Array<Record<string, never>>,
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
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "terminal") return terminalBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function TerminalMock() {
    const instance = {
      open: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.()
      }),
      loadAddon: vi.fn(),
      onData: vi.fn((listener: (data: string) => void) => {
        instance.inputListener = listener
        return { dispose: instance.inputDispose }
      }),
      dispose: vi.fn(),
      cols: 100,
      rows: 30,
      emitInput: (data: string) => instance.inputListener?.(data),
      inputDispose: vi.fn(),
      inputListener: null as ((data: string) => void) | null,
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
  WebLinksAddon: vi.fn().mockImplementation(function WebLinksAddonMock() {
    const instance = {}
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
  bridgeState.groups = []
  bridgeState.sessions = []
  bridgeState.chunks = []
  bridgeState.nextSeq = 0
  bridgeState.dataListener = null
  bridgeState.sessionChangedListener = null
  bridgeState.sessionDeletedListener = null
  bridgeState.deferredRead = null
  bridgeState.dataUnsubscribe.mockClear()
  bridgeState.sessionChangedUnsubscribe.mockClear()
  bridgeState.sessionDeletedUnsubscribe.mockClear()
  terminalBridge.listGroups.mockClear()
  terminalBridge.chooseDefaultCwd.mockClear()
  terminalBridge.createGroup.mockClear()
  terminalBridge.renameGroup.mockClear()
  terminalBridge.updateGroupSettings.mockClear()
  terminalBridge.deleteGroup.mockClear()
  terminalBridge.listSessions.mockClear()
  terminalBridge.createSession.mockClear()
  terminalBridge.getSession.mockClear()
  terminalBridge.readSession.mockClear()
  terminalBridge.renameSession.mockClear()
  terminalBridge.writeSession.mockClear()
  terminalBridge.resizeSession.mockClear()
  terminalBridge.deleteSession.mockClear()
  terminalBridge.stopSession.mockClear()
  terminalBridge.runStartupCommand.mockClear()
  toastState.error.mockClear()
  terminalBridge.onData.mockClear()
  terminalBridge.onSessionChanged.mockClear()
  terminalBridge.onSessionDeleted.mockClear()
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

  it("does not render a global new terminal action in the embedded header", async () => {
    await renderEmbeddedModule()

    const actions = document.querySelector("[data-embedded-system-app-actions]")
    expect(actions?.textContent).not.toContain("新建终端")
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
    expect(actions?.textContent).not.toContain("新建终端")
    expect(document.body.textContent).toContain("已断开")
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
    expect(document.querySelector("[aria-label='终端输出与输入']")).toBeTruthy()
  })

  it("does not render session-level Agent control", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    expect(document.body.textContent).not.toContain("Agent 控制")
  })

  it("renames a terminal session by double-clicking its name", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()
    await doubleClickSession("开发终端")
    await changeInput("终端名称", "  构建日志  ")
    await clickButton("保存")

    expect(terminalBridge.renameSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      title: "  构建日志  ",
    })
    expect(document.body.textContent).toContain("构建日志")
  })

  it("renders a direct delete button instead of a session menu", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]

    await renderModule()

    expect(document.body.querySelector('[aria-label="终端会话操作：开发终端"]')).toBeNull()
    expect(document.body.querySelector('[aria-label="删除终端会话：开发终端"]')).toBeTruthy()
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
    expect(document.querySelector("[aria-label='终端输出与输入']")).toBeTruthy()
    expect(terminalBridge.readSession).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      afterSeq: 0,
    })
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
        startupCommand: "pnpm test",
      },
    })]
    bridgeState.sessions = []

    await renderModule()
    await clickGroupMenu("构建")
    await clickMenuItem("设置")
    await changeInput("分组名称", "开发")
    await changeInput("默认目录", "/repo/app")
    await changeTextarea("启动命令", "nvm use\npnpm dev")
    await clickButton("保存")

    expect(terminalBridge.updateGroupSettings).toHaveBeenCalledWith({
      groupId: "group-build",
      name: "开发",
      settings: {
        defaultCwd: "/repo/app",
        startupCommand: "nvm use\npnpm dev",
      },
    })
    expect(document.body.textContent).toContain("开发")
  })

  it("chooses a default directory when updating terminal group settings", async () => {
    bridgeState.groups = [createGroup({
      id: "group-build",
      name: "构建",
    })]
    bridgeState.sessions = []
    terminalBridge.chooseDefaultCwd.mockResolvedValueOnce("/repo/chosen")

    await renderModule()
    await clickGroupMenu("构建")
    await clickMenuItem("设置")
    await clickButton("选择")
    await clickButton("保存")

    expect(terminalBridge.chooseDefaultCwd).toHaveBeenCalled()
    expect(terminalBridge.updateGroupSettings).toHaveBeenCalledWith({
      groupId: "group-build",
      name: "构建",
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
      createSession({ id: "session-1", groupId: "group-build", title: "构建终端", updatedAt: "2026-06-24T00:02:00.000Z" }),
      createSession({ id: "session-2", groupId: "group-logs", title: "日志终端", updatedAt: "2026-06-24T00:01:00.000Z" }),
    ]

    await renderModule()
    await clickGroupMenu("构建")
    await clickMenuItem("删除")
    await clickButton("删除分组")

    expect(terminalBridge.deleteGroup).toHaveBeenCalledWith({ groupId: "group-build" })
    expect(document.body.textContent).not.toContain("构建终端")
    expect(terminalBridge.readSession).toHaveBeenLastCalledWith({
      sessionId: "session-2",
      afterSeq: 0,
    })
  })

  it("deletes the active terminal session and selects the next session", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [
      createSession({ id: "session-1", groupId: "group-1", title: "一号终端", updatedAt: "2026-06-24T00:02:00.000Z" }),
      createSession({ id: "session-2", groupId: "group-1", title: "二号终端", updatedAt: "2026-06-24T00:01:00.000Z" }),
    ]

    await renderModule()
    await clickSessionDelete("一号终端")

    expect(terminalBridge.deleteSession).toHaveBeenCalledWith({ sessionId: "session-1" })
    expect(document.body.textContent).not.toContain("会停止该终端并删除保留输出")
    expect(document.body.textContent).not.toContain("一号终端")
    expect(terminalBridge.readSession).toHaveBeenLastCalledWith({
      sessionId: "session-2",
      afterSeq: 0,
    })
  })

  it("deletes the last terminal session and returns to the empty state", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "临时终端" })]

    await renderModule()
    await clickSessionDelete("临时终端")

    expect(terminalBridge.deleteSession).toHaveBeenCalledWith({ sessionId: "session-1" })
    expect(document.body.textContent).toContain("新建终端")
  })

  it("shows a user-visible error when creating a terminal fails", async () => {
    terminalBridge.createSession.mockRejectedValueOnce(new Error("spawn failed"))

    await renderModule()
    await clickButton("新建终端")

    expect(toastState.error).toHaveBeenCalledWith("新建终端失败")
  })

  it("shows a user-visible error when terminal output cannot be loaded", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    terminalBridge.readSession.mockRejectedValueOnce(new Error("read failed"))

    await renderModule()

    expect(toastState.error).toHaveBeenCalledWith("读取终端输出失败")
    expect(document.body.textContent).toContain("读取终端输出失败")
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
      lineHeight: expect.any(Number),
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

  it("attaches to a session, streams data, writes input, and cleans up without stopping it", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    bridgeState.chunks = [createChunk({ sessionId: "session-1", seq: 1, data: "ready\r\n" })]
    bridgeState.nextSeq = 1

    await renderModule()

    expect(terminalBridge.readSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      afterSeq: 0,
    })
    expect(xtermState.instances[0]?.write).toHaveBeenCalledWith("ready\r\n", expect.any(Function))
    expect(terminalBridge.runStartupCommand).toHaveBeenCalledWith({ sessionId: "session-1" })

    await act(async () => {
      xtermState.instances[0]?.emitInput("pwd\r")
      await Promise.resolve()
    })

    expect(terminalBridge.writeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      data: "pwd\r",
    })

    act(() => {
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
    })

    expect(xtermState.instances[0]?.write).toHaveBeenCalledWith("next\r\n", expect.any(Function))
    expect(xtermState.instances[0]?.write).not.toHaveBeenCalledWith("old")
    expect(xtermState.instances[0]?.write).not.toHaveBeenCalledWith("other")
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
    expect(xtermState.instances[0]?.inputDispose).toHaveBeenCalled()
    expect(xtermState.instances[0]?.dispose).toHaveBeenCalled()
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalled()
    expect(terminalBridge.stopSession).not.toHaveBeenCalled()
  })

  it("does not mark startup ready for control-only terminal output", async () => {
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

    expect(terminalBridge.runStartupCommand).toHaveBeenCalledWith({ sessionId: "session-1" })
  })

  it("does not lose or duplicate data emitted before retained output finishes loading", async () => {
    bridgeState.groups = [createGroup({ id: "group-1", name: "默认分组" })]
    bridgeState.sessions = [createSession({ id: "session-1", groupId: "group-1", title: "开发终端" })]
    const retainedChunk = createChunk({ sessionId: "session-1", seq: 1, data: "ready\r\n" })
    const liveChunk = createChunk({ sessionId: "session-1", seq: 2, data: "during-read\r\n" })
    bridgeState.deferredRead = createDeferredRead()

    await renderModule()

    act(() => {
      bridgeState.dataListener?.({
        sessionId: "session-1",
        chunk: liveChunk,
      })
    })

    await act(async () => {
      bridgeState.deferredRead?.resolve({
        session: getSession("session-1"),
        chunks: [retainedChunk],
        nextSeq: 1,
        truncated: false,
        firstSeq: 1,
      })
      await Promise.resolve()
    })

    const writes = xtermState.instances[0]?.write.mock.calls.map(([data]) => data)
    expect(writes).toContain("ready\r\n")
    expect(writes).toContain("during-read\r\n")
    expect(writes?.filter((data) => data === "during-read\r\n")).toHaveLength(1)
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<TerminalModule />)
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
  const button = Array.from(root.querySelectorAll("button"))
    .find((item) => item.textContent === text)
  await act(async () => {
    button?.click()
    await Promise.resolve()
  })
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
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="删除终端会话：${title}"]`)
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

function createGroup(overrides: Partial<SynapseTerminalGroup> = {}): SynapseTerminalGroup {
  return {
    id: "group-1",
    name: "默认分组",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    sortOrder: 0,
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
    ...overrides,
  } satisfies SynapseTerminalSession
  bridgeState.sessions = bridgeState.sessions.some((item) => item.id === session.id)
    ? bridgeState.sessions.map((item) => item.id === session.id ? session : item)
    : [...bridgeState.sessions, session]
  return session
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

function createDeferredRead(): NonNullable<typeof bridgeState.deferredRead> {
  let resolve: (value: unknown) => void = () => undefined
  const promise = new Promise<unknown>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
