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
} from "../../../../src/types/terminal"

const bridgeState = vi.hoisted(() => ({
  groups: [] as SynapseTerminalGroup[],
  sessions: [] as SynapseTerminalSession[],
  chunks: [] as SynapseTerminalOutputChunk[],
  nextSeq: 0,
  dataListener: null as ((event: SynapseTerminalDataEvent) => void) | null,
  sessionChangedListener: null as ((session: SynapseTerminalSession) => void) | null,
  dataUnsubscribe: vi.fn(),
  sessionChangedUnsubscribe: vi.fn(),
  deferredRead: null as null | {
    promise: Promise<unknown>
    resolve: (value: unknown) => void
  },
}))

const terminalBridge = vi.hoisted(() => ({
  listGroups: vi.fn(async () => bridgeState.groups),
  createGroup: vi.fn(async () => createGroup()),
  listSessions: vi.fn(async () => bridgeState.sessions),
  createSession: vi.fn(async () => createSession()),
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
  writeSession: vi.fn(async () => undefined),
  resizeSession: vi.fn(async () => undefined),
  setAgentControl: vi.fn(async ({ sessionId, enabled }: { sessionId: string; enabled: boolean }) => ({
    ...getSession(sessionId),
    agentControl: enabled ? "enabled" : "disabled",
  })),
  stopSession: vi.fn(async () => undefined),
  onData: vi.fn((listener: (event: SynapseTerminalDataEvent) => void) => {
    bridgeState.dataListener = listener
    return bridgeState.dataUnsubscribe
  }),
  onSessionChanged: vi.fn((listener: (session: SynapseTerminalSession) => void) => {
    bridgeState.sessionChangedListener = listener
    return bridgeState.sessionChangedUnsubscribe
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
      write: vi.fn(),
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

vi.mock("@xterm/xterm/css/xterm.css", () => ({}))

import { TerminalModule } from "../index"

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
  bridgeState.deferredRead = null
  bridgeState.dataUnsubscribe.mockClear()
  bridgeState.sessionChangedUnsubscribe.mockClear()
  terminalBridge.listGroups.mockClear()
  terminalBridge.createGroup.mockClear()
  terminalBridge.listSessions.mockClear()
  terminalBridge.createSession.mockClear()
  terminalBridge.getSession.mockClear()
  terminalBridge.readSession.mockClear()
  terminalBridge.writeSession.mockClear()
  terminalBridge.resizeSession.mockClear()
  terminalBridge.setAgentControl.mockClear()
  terminalBridge.stopSession.mockClear()
  terminalBridge.onData.mockClear()
  terminalBridge.onSessionChanged.mockClear()
  xtermState.instances = []
  xtermState.fitInstances = []
  xtermState.webLinksInstances = []
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

    expect(document.body.textContent).toContain("新建会话")

    await clickButton("新建终端")

    expect(terminalBridge.createSession).toHaveBeenCalledWith({
      cols: 80,
      rows: 24,
    })
    expect(document.body.textContent).toContain("Session 1")
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
    expect(xtermState.instances[0]?.write).toHaveBeenCalledWith("ready\r\n")

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

    expect(xtermState.instances[0]?.write).toHaveBeenCalledWith("next\r\n")
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
    expect(xtermState.instances[0]?.inputDispose).toHaveBeenCalled()
    expect(xtermState.instances[0]?.dispose).toHaveBeenCalled()
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalled()
    expect(terminalBridge.stopSession).not.toHaveBeenCalled()
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

async function clickButton(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text)
  await act(async () => {
    button?.click()
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
    agentControl: "disabled",
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
