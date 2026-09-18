import { EventEmitter } from "node:events"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { isMobileSummaryPayload, MOBILE_FRAME_LIMITS } from "@synapse/shared"
import type {
  MobileIntent,
  MobileQuickPhrase,
  MobileTerminalFrame,
  MobileToolbarButton,
  MobileTransferProgressPayload,
} from "@synapse/shared"

import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import { terminalContractError } from "../../../app-capabilities/terminal/shared/errors"
import type { TerminalStyledLine } from "../../../app-capabilities/terminal/main/emulator"
import type { TerminalLayoutNode } from "../../../app-capabilities/terminal/shared/workspace"
import type { PermissionGuard } from "../../runtime/security/permission-guard"
import {
  clampSummaryText,
  MobileGatewayService,
  type MobileGatewayAgentGroup,
  type MobileGatewayAgentProvider,
} from "../mobile-gateway-service"
import { MobileFileRelay } from "../mobile-gateway/file-relay"
import type { ClaudeCodeConversationLaunch } from "../mobile-gateway/intent-executor"
import type {
  MobileGatewayTransport,
  MobileQuickPhrasesDraft,
  MobileSummaryDraft,
  MobileToolbarDraft,
} from "../mobile-gateway/transport"

/* ------------------------------------------------------------------ *
 * Test doubles
 * ------------------------------------------------------------------ */

/**
 * A deterministic scheduler. The gateway's flush windows are the behaviour under
 * test, so wall-clock timers would make the suite both slow and flaky.
 */
class ManualTimers {
  nowMs = 1_000_000
  private readonly handlers = new Map<number, { callback: () => void; dueMs: number }>()
  private nextId = 1

  readonly set = (callback: () => void, delayMs: number): NodeJS.Timeout => {
    const id = this.nextId++
    this.handlers.set(id, { callback, dueMs: this.nowMs + delayMs })
    return id as unknown as NodeJS.Timeout
  }

  readonly clear = (handle: NodeJS.Timeout): void => {
    this.handlers.delete(handle as unknown as number)
  }

  async advance(ms: number): Promise<void> {
    this.nowMs += ms
    for (const [id, handler] of [...this.handlers]) {
      if (handler.dueMs > this.nowMs) continue
      this.handlers.delete(id)
      handler.callback()
    }
    // Let the async flush chain settle.
    for (let index = 0; index < 6; index += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

type FakeSession = {
  id: string
  groupId: string
  title: string
  status: "running" | "ended"
  cwd: string
  cols: number
  rows: number
  startedAt: string
  lastOutputSeq: number
  attention: { state: string; kind: string }
  /** Present while a phone is deciding the grid; mirrors the session schema. */
  sizeOwner?: {
    kind: "mobile"
    deviceLabel: string
    mobileClientInstanceId: string
    cols: number
    rows: number
  }
}

type FakeWorkspace = {
  id: string
  groupId: string
  title: string
  layout: TerminalLayoutNode
}

class FakeTerminal {
  readonly events = new EventEmitter()
  readonly sessions = new Map<string, FakeSession>()
  readonly workspaces = new Map<string, FakeWorkspace>()
  readonly lines = new Map<string, TerminalStyledLine[]>()
  readonly calls: string[] = []
  leaseOwner: string | null = null
  deny = false

  /** Mutable so a test can hand the phone a group order of its own to carry. */
  groups: Array<{ id: string; name: string }> = [{ id: "g1", name: "前端开发" }]

  listGroups() {
    return this.groups
  }

  /**
   * What the terminal capability projects for a phone, as the real one does from its
   * registry and the user's stored actions. Mutable so a test can change the buttons
   * and see whether the gateway notices.
   */
  mobileToolbarButtons: readonly MobileToolbarButton[] = [
    { id: "enter", label: "回车", group: "key", action: { type: "key", key: "Enter" } },
    { id: "slash-exit", label: "/exit", group: "command", action: { type: "text", text: "/exit", pressEnter: true } },
  ]

  listMobileToolbarButtons(): readonly MobileToolbarButton[] {
    this.calls.push("listMobileToolbarButtons")
    return this.mobileToolbarButtons
  }

  listSessions(): FakeSession[] {
    return [...this.sessions.values()]
  }

  listWorkspaces(): FakeWorkspace[] {
    return [...this.workspaces.values()]
  }

  /**
   * The real service raises a `TerminalContractError` for an id it does not know,
   * with the code in `payload` rather than on the error itself. The double raises the
   * same class so a test observes the same error the gateway does — a plain object
   * with a `code` field would take a different path through `classifyError`.
   */
  getSession(input: { sessionId: string }): FakeSession {
    const session = this.sessions.get(input.sessionId)
    if (!session) throw terminalContractError("not_found", "not_found")
    return session
  }

  async readLineWindow(input: { sessionId: string; maxLines: number }) {
    // A window is read off a live session in the real service, so an id it no longer
    // has is a throw there too — not an empty window here.
    if (!this.sessions.has(input.sessionId)) throw terminalContractError("not_found", "not_found")
    const all = this.lines.get(input.sessionId) ?? []
    const lines = all.slice(Math.max(0, all.length - input.maxLines))
    return {
      lines,
      startIndex: all.length - lines.length,
      totalLines: all.length,
      cols: 80,
      rows: 24,
      cursor: { row: lines.length, col: 0, visible: true },
      alt: false,
      throughOutputSeq: this.sessions.get(input.sessionId)?.lastOutputSeq ?? 0,
      sizeRevision: 1,
    }
  }

  async readLineRange(input: { sessionId: string; from: number; maxLines: number }) {
    const all = this.lines.get(input.sessionId) ?? []
    const start = Math.max(0, Math.min(input.from, all.length))
    const end = Math.min(all.length, start + input.maxLines)
    return { lines: all.slice(start, end), startIndex: start }
  }

  getSessionState(_sessionId: string, controller?: { clientId: string }) {
    const mine = this.leaseOwner !== null && this.leaseOwner === controller?.clientId
    return {
      lease: this.leaseOwner === null
        ? { occupied: false, leaseRevision: 1 }
        : { occupied: true, own: mine, leaseRevision: 1 },
    }
  }

  async acquireControl(_input: unknown, controller: { clientId: string }) {
    this.calls.push("acquireControl")
    if (this.leaseOwner !== null && this.leaseOwner !== controller.clientId) {
      throw Object.assign(new Error("busy"), { code: "control_busy" })
    }
    this.leaseOwner = controller.clientId
    return {
      leaseId: "lease-1",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      leaseRevision: 1,
      stateRevision: 1,
      inputRevision: 7,
    }
  }

  async renewControl() {
    return {
      leaseId: "lease-1",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      leaseRevision: 2,
      stateRevision: 1,
      inputRevision: 7,
    }
  }

  releaseControl() {
    this.calls.push("releaseControl")
    this.leaseOwner = null
    return { released: true, noOp: false, stateRevision: 1 }
  }

  async resizeSessionFromDevice(input: {
    sessionId: string
    cols: number
    rows: number
    deviceLabel: string
    mobileClientInstanceId: string
  }) {
    this.calls.push("resizeSessionFromDevice")
    const session = this.sessions.get(input.sessionId)
    if (session) {
      session.cols = input.cols
      session.rows = input.rows
      session.sizeOwner = {
        kind: "mobile",
        deviceLabel: input.deviceLabel,
        mobileClientInstanceId: input.mobileClientInstanceId,
        cols: input.cols,
        rows: input.rows,
      }
    }
    return session
  }

  releaseSizeOwnership(sessionId: string) {
    this.calls.push("releaseSizeOwnership")
    const session = this.sessions.get(sessionId)
    if (session) session.sizeOwner = undefined
    return session
  }

  /**
   * The shape the desktop's own layout last asked for, per session. Only the
   * desktop's fit writes it, so a phone's resize deliberately does not — the real
   * service makes the same distinction between its two non-mobile resize sources.
   */
  readonly desktopGrids = new Map<string, { cols: number; rows: number }>()

  /** Stands in for the renderer's fit, which is the only writer in production. */
  fitToDesktopGrid(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.cols = cols
      session.rows = rows
      session.sizeOwner = undefined
    }
    this.desktopGrids.set(sessionId, { cols, rows })
  }

  async restoreGridForDesktop(sessionId: string): Promise<boolean> {
    this.calls.push("restoreGridForDesktop")
    const session = this.sessions.get(sessionId)
    if (!session?.sizeOwner) return true
    const grid = this.desktopGrids.get(sessionId)
    if (!grid) {
      this.releaseSizeOwnership(sessionId)
      return false
    }
    session.cols = grid.cols
    session.rows = grid.rows
    session.sizeOwner = undefined
    return true
  }

  releaseSizeOwnershipForClient(mobileClientInstanceId: string) {
    this.calls.push("releaseSizeOwnershipForClient")
    for (const session of this.sessions.values()) {
      if (session.sizeOwner?.mobileClientInstanceId === mobileClientInstanceId) {
        session.sizeOwner = undefined
      }
    }
  }

  async sendCommand() {
    this.calls.push("sendCommand")
    return { outcome: "accepted" }
  }

  /** What was typed, not just that typing happened: the text is the whole point. */
  readonly semanticWrites: {
    readonly sessionId: string
    readonly actions: readonly { readonly type: string; readonly text?: string; readonly key?: string }[]
  }[] = []

  async sendSemanticInput(input: {
    readonly sessionId: string
    readonly actions: readonly { readonly type: string; readonly text?: string; readonly key?: string }[]
  }) {
    this.calls.push("sendSemanticInput")
    this.semanticWrites.push({ sessionId: input.sessionId, actions: input.actions })
    return { outcome: "accepted" }
  }

  async stopControlledSession() {
    this.calls.push("stopControlledSession")
    return { outcome: "accepted" }
  }

  async deleteSession() {
    this.calls.push("deleteSession")
  }

  async createSession() {
    this.calls.push("createSession")
    return { id: "sess-new" }
  }

  async launchGroupCommand() {
    this.calls.push("launchGroupCommand")
    return { id: "sess-command" }
  }

  async renameSession() {
    this.calls.push("renameSession")
    return { id: "sess-1" }
  }
}

function createHarness(options: { sessionLines?: number } = {}) {
  const terminal = new FakeTerminal()
  terminal.sessions.set("sess-1", {
    id: "sess-1",
    groupId: "g1",
    title: "dev-server",
    status: "running",
    cwd: "/Users/liy/code",
    cols: 80,
    rows: 24,
    startedAt: new Date().toISOString(),
    lastOutputSeq: 1,
    attention: { state: "not_waiting", kind: "unknown" },
  })
  terminal.lines.set(
    "sess-1",
    Array.from({ length: options.sessionLines ?? 3 }, (_, index) => ({ text: `line-${index}` })),
  )

  const timers = new ManualTimers()
  const frames: { mobileClientInstanceId: string; frame: MobileTerminalFrame }[] = []
  const summaries: unknown[] = []
  const results: unknown[] = []
  const progress: MobileTransferProgressPayload[] = []
  const toolbars: MobileToolbarDraft[] = []
  const quickPhrases: MobileQuickPhrasesDraft[] = []
  const transport: MobileGatewayTransport = {
    sendSummary: (draft) => summaries.push(draft),
    sendFrame: (mobileClientInstanceId, frame) => frames.push({ mobileClientInstanceId, frame }),
    sendIntentResult: (mobileClientInstanceId, result) => {
      results.push({ mobileClientInstanceId, result })
    },
    sendTransferProgress: (payload) => progress.push(payload),
    sendToolbar: (draft) => toolbars.push(draft),
    sendQuickPhrases: (draft) => quickPhrases.push(draft),
  }
  const audits: unknown[] = []
  const warns: { message: string; meta?: Record<string, unknown> }[] = []
  const permissionGuard = {
    check: vi.fn(async () => (terminal.deny
      ? { allowed: false, reason: "denied" }
      : { allowed: true })),
  } as unknown as PermissionGuard

  /*
   * The relay is injected rather than left out because it is a required
   * collaborator: a `fileUpload` intent that reaches the executor without one
   * throws where the phone can only report a generic failure. Stubbed here so the
   * harness stays a complete gateway, with the real file-handling behaviour
   * covered by `file-relay.test.ts`.
   */
  const landings: { readonly driveItemId: string; readonly fileName: string }[] = []
  const discarded: string[] = []
  const fileRelay = new MobileFileRelay({
    downloadDriveFile: async () => {
      throw new Error("The harness does not download.")
    },
    permanentlyDeleteDriveItem: async () => ({ ok: true }),
    directory: path.join(tmpdir(), "synapse-mobile-gateway-test"),
    logger: { info: () => {}, warn: () => {} },
  })
  vi.spyOn(fileRelay, "land").mockImplementation(async (input) => {
    // The two fields the caller decides; the progress callback is per-call and is
    // observed through `progress` instead.
    landings.push({ driveItemId: input.driveItemId, fileName: input.fileName })
    return { path: `/tmp/${input.fileName}`, fileName: input.fileName }
  })
  vi.spyOn(fileRelay, "discardCloudCopy").mockImplementation(async (itemId) => {
    discarded.push(itemId)
    return true
  })

  /*
   * The launcher is injected, so the gateway's own tests do not need a project, a
   * Provider or a Claude runtime — those are covered where the launcher lives, in
   * `modules/agent/__tests__/claude-code-terminal.test.ts`. What is under test here
   * is what the gateway does with an answer: authorize, remember the choice, adopt
   * the session and report its id back.
   */
  const launches: ClaudeCodeConversationLaunch[] = []
  const createClaudeCodeConversation = vi.fn(async (input: ClaudeCodeConversationLaunch) => {
    launches.push(input)
    terminal.sessions.set("sess-cc", {
      id: "sess-cc",
      groupId: "g1",
      title: "Claude Code · Synapse",
      status: "running",
      cwd: "/Users/liy/code",
      cols: input.cols ?? 80,
      rows: input.rows ?? 24,
      startedAt: new Date().toISOString(),
      lastOutputSeq: 0,
      attention: { state: "unknown", kind: "unknown" },
    })
    terminal.lines.set("sess-cc", [])
    return { id: "sess-cc" }
  })

  /*
   * The directories the phone's panel is drawn from. Mutable so a test can rename a
   * project or archive a Provider and watch the next summary carry the change — which
   * is how the content fingerprint is exercised.
   */
  const agentGroups: MobileGatewayAgentGroup[] = [
    { projectId: "builtin:default-agent-workspace", name: "本地对话", isDefault: true },
    { projectId: "project-1", name: "Synapse", isDefault: false },
  ]
  const agentProviders: MobileGatewayAgentProvider[] = [
    {
      id: "local-claude-code",
      name: "Claude Code 本地",
      isDefault: false,
      defaultTier: "default",
      models: { default: "Claude Code 默认" },
    },
    {
      id: "preferred",
      name: "Anthropic 官方",
      isDefault: true,
      defaultTier: "opus",
      models: { default: "claude-sonnet-4-5", opus: "claude-opus-4-5" },
    },
  ]

  const listAgentConversationGroups = vi.fn(async () => agentGroups)
  const listAgentConversationProviders = vi.fn(async () => agentProviders)
  /** Mutable so a test can edit the user's table and see whether the gateway notices. */
  const quickPhraseItems: MobileQuickPhrase[] = [
    { id: "q1", content: "整理成提交说明" },
  ]
  const listQuickPhrases = vi.fn(async () => [...quickPhraseItems])

  const gateway = new MobileGatewayService({
    terminal: terminal as unknown as TerminalService,
    fileRelay,
    createClaudeCodeConversation,
    listAgentConversationGroups,
    listAgentConversationProviders,
    listQuickPhrases,
    permissionGuard,
    auditSink: { record: (event: unknown) => audits.push(event), list: () => [], clearForTests: () => {} },
    logger: { info: () => {}, warn: (message: string, meta?: Record<string, unknown>) => warns.push({ message, meta }) },
    now: () => new Date(timers.nowMs),
    setTimeout: timers.set,
    clearTimeout: timers.clear,
    lineWindowLines: 100,
  })
  gateway.start()
  gateway.setTransport(transport)

  return {
    gateway, terminal, timers, transport, frames, summaries, results, audits, toolbars,
    quickPhrases, quickPhraseItems, listQuickPhrases,
    permissionGuard, fileRelay, landings, discarded, progress, warns,
    launches, createClaudeCodeConversation, agentGroups, agentProviders,
    listAgentConversationGroups, listAgentConversationProviders,
  }
}

/** Seeds one tab under a fixed id. The gateway walks this layout, never the tree's storage. */
function seedWorkspace(harness: ReturnType<typeof createHarness>, layout: TerminalLayoutNode): void {
  harness.terminal.workspaces.set("ws-1", {
    id: "ws-1",
    groupId: "g1",
    title: "前端开发",
    layout,
  })
}

/** Adds a conversation, as splitting a pane does when a tab gains one. */
function addSession(harness: ReturnType<typeof createHarness>, id: string, title: string): void {
  const existing = harness.terminal.sessions.get("sess-1")!
  harness.terminal.sessions.set(id, { ...existing, id, title })
}

function intent<T extends MobileIntent>(value: T): T {
  return value
}

async function attach(
  harness: ReturnType<typeof createHarness>,
  overrides: Partial<MobileIntent> = {},
): Promise<void> {
  await harness.gateway.handleIntent("phone-1", {
    v: 1,
    intentId: "i-attach",
    kind: "attach",
    sessionId: "sess-1",
    ...overrides,
  } as MobileIntent)
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("MobileGatewayService", () => {
  it("sends a full snapshot when a phone attaches", async () => {
    const harness = createHarness()
    await attach(harness)

    expect(harness.frames).toHaveLength(1)
    expect(harness.frames[0].frame.kind).toBe("reset")
    expect(harness.frames[0].frame.lines.map((line) => line[0]))
      .toEqual(["line-0", "line-1", "line-2"])
    expect(harness.terminal.calls).toContain("acquireControl")
  })

  it("sends only the appended tail as output arrives", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.frames.length = 0

    harness.terminal.lines.set("sess-1", [
      { text: "line-0" },
      { text: "line-1" },
      { text: "line-2" },
      { text: "line-3" },
    ])
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(60)

    expect(harness.frames).toHaveLength(1)
    expect(harness.frames[0].frame.kind).toBe("suffix")
    expect(harness.frames[0].frame.lines.map((line) => line[0])).toEqual(["line-3"])
  })

  it("stays completely silent while the terminal is idle", async () => {
    const harness = createHarness()
    await attach(harness)
    // Let the first session list go out, then confirm an idle desktop adds nothing.
    await harness.timers.advance(2_000)
    harness.frames.length = 0
    const summariesBefore = harness.summaries.length

    await harness.timers.advance(5_000)

    expect(harness.frames).toHaveLength(0)
    expect(harness.summaries.length).toBe(summariesBefore)
  })

  it("writes to an existing terminal without any unlock step, and audits the write", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "pnpm dev",
    }))

    // Attaching is the whole gate: a phone that opened a terminal can type into it.
    expect(harness.terminal.calls).toContain("sendCommand")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.session.control",
      outcome: "allowed",
    }))
  })

  it("replays the stored result for a resent intent instead of acting twice", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0
    const command = intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "ls",
    })

    await harness.gateway.handleIntent("phone-1", command)
    await harness.gateway.handleIntent("phone-1", command)

    // A phone on a flaky link may resend blindly; the second one must be a replay.
    expect(harness.terminal.calls.filter((call) => call === "sendCommand")).toHaveLength(1)
    expect(harness.results.filter((entry) => {
      const result = (entry as { result: { intentId: string } }).result
      return result.intentId === "i-cmd"
    })).toHaveLength(2)
  })

  it("lands a relayed file, drops the cloud copy, and types its path", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-file",
      kind: "fileUpload",
      sessionId: "sess-1",
      driveItemId: "item-1",
      fileName: "报错截图.png",
    }))

    expect(harness.landings).toEqual([{ driveItemId: "item-1", fileName: "报错截图.png" }])
    // The copy goes as soon as the bytes are local — before the path is typed, so a
    // terminal that cannot take the text still leaves no copy behind.
    expect(harness.discarded).toEqual(["item-1"])
    expect(harness.terminal.calls).toContain("sendSemanticInput")
    const write = harness.terminal.semanticWrites.at(-1)
    expect(write?.actions).toEqual([{ type: "text", text: "/tmp/报错截图.png" }])
    // Typed, not submitted: the user still gets to look at it before pressing Enter.
    expect(write?.actions.some((action) => action.type === "key")).toBe(false)
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
  })

  it("tells the phone how far along the fetch is, without flooding it", async () => {
    const harness = createHarness()
    await attach(harness)
    // The download underneath reports roughly ten times a second. The phone draws a
    // bar, so the middle of that burst is nine messages a second that change
    // nothing — but the first tick and the last one both have to survive, because
    // they are the two the user actually reads.
    vi.spyOn(harness.fileRelay, "land").mockImplementation(async (input) => {
      input.onProgress?.(0, 0)
      harness.timers.nowMs += 40
      input.onProgress?.(256, 1024)
      input.onProgress?.(512, 1024)
      harness.timers.nowMs += 400
      input.onProgress?.(1024, 1024)
      return { path: `/tmp/${input.fileName}`, fileName: input.fileName }
    })

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-file",
      kind: "fileUpload",
      sessionId: "sess-1",
      driveItemId: "item-1",
      fileName: "a.png",
    }))

    expect(harness.progress).toEqual([
      { mobileClientInstanceId: "phone-1", intentId: "i-file", completedBytes: 0, totalBytes: 0 },
      { mobileClientInstanceId: "phone-1", intentId: "i-file", completedBytes: 1024, totalBytes: 1024 },
    ])
  })

  it("says a transfer is finished once, even if the body outruns its declared length", async () => {
    const harness = createHarness()
    await attach(harness)
    // A server that understates `Content-Length` makes every remaining chunk look
    // settled. The bar is finished after the first one; the rest are the same news.
    vi.spyOn(harness.fileRelay, "land").mockImplementation(async (input) => {
      input.onProgress?.(0, 0)
      harness.timers.nowMs += 400
      input.onProgress?.(1024, 1024)
      input.onProgress?.(2048, 1024)
      input.onProgress?.(4096, 1024)
      return { path: `/tmp/${input.fileName}`, fileName: input.fileName }
    })

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-file",
      kind: "fileUpload",
      sessionId: "sess-1",
      driveItemId: "item-1",
      fileName: "a.png",
    }))

    expect(harness.progress.map((entry) => entry.completedBytes)).toEqual([0, 1024])
  })

  it("still lands the file when the terminal can no longer take the path", async () => {
    const harness = createHarness()
    await attach(harness)
    // The desktop's own user typed, which takes the write lease back by design.
    harness.terminal.leaseOwner = "desktop-user"

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-file",
      kind: "fileUpload",
      sessionId: "sess-1",
      driveItemId: "item-1",
      fileName: "a.png",
    }))

    // The file is on the disk and the cloud copy is gone, so this is not a failure —
    // but the phone has to hear that the path was not typed rather than being told
    // it was.
    expect(harness.landings).toHaveLength(1)
    expect(harness.discarded).toEqual(["item-1"])
    const result = (harness.results.at(-1) as { result: { outcome: string; message?: string } }).result
    expect(result.outcome).toBe("accepted")
    expect(result.message).toContain("路径没有插入")
  })

  it("keeps the cloud copy when the file never landed", async () => {
    const harness = createHarness()
    await attach(harness)
    vi.spyOn(harness.fileRelay, "land").mockRejectedValueOnce(new Error("drive unavailable"))

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-file",
      kind: "fileUpload",
      sessionId: "sess-1",
      driveItemId: "item-1",
      fileName: "a.png",
    }))

    // The cloud copy is the only copy left, so deleting it here would lose the file.
    expect(harness.discarded).toEqual([])
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "rejected" } })
  })

  it("rejects a write when another client takes the lease", async () => {
    const harness = createHarness()
    await attach(harness)
    // The desktop typing preempts the phone's lease.
    harness.terminal.leaseOwner = "synapse-ui"
    harness.terminal.events.emit("stateChanged", {
      sessionId: "sess-1",
      stateRevision: 2,
      changeTypes: ["lease.user_takeover"],
    })
    await harness.timers.advance(0)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "ls",
    }))

    expect(harness.terminal.calls).not.toContain("sendCommand")
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "rejected", code: "lease_preempted" },
    })
  })

  it("lets the phone reclaim control after a preemption by unlocking again", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.leaseOwner = "synapse-ui"
    harness.terminal.events.emit("stateChanged", {
      sessionId: "sess-1",
      stateRevision: 2,
      changeTypes: ["lease.user_takeover"],
    })
    await harness.timers.advance(0)

    // The other writer lets go; the unlock intent is how the phone takes the lease
    // back. It grants nothing beyond that — the gate it also used to open is gone.
    harness.terminal.leaseOwner = null
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-unlock",
      kind: "unlock",
      sessionId: "sess-1",
    }))
    harness.terminal.calls.length = 0
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "ls",
    }))

    expect(harness.terminal.calls).toContain("sendCommand")
  })

  it("stops a running terminal instead of deleting it, and audits the delete", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-delete",
      kind: "delete",
      sessionId: "sess-1",
    }))

    // The service answers a delete of a live session with `lifecycle_conflict`,
    // and the stop is what removes it — the PTY exiting destroys the session. So
    // deleteSession must not be reached at all here.
    expect(harness.terminal.calls).toContain("stopControlledSession")
    expect(harness.terminal.calls).not.toContain("deleteSession")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.session.delete",
      outcome: "allowed",
    }))
  })

  it("deletes a terminal that has already ended", async () => {
    const harness = createHarness()
    await attach(harness)
    // Ended sessions linger so they can be cleaned up on request; there is nothing
    // left to stop.
    const session = harness.terminal.sessions.get("sess-1")
    if (session) session.status = "ended"
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-delete",
      kind: "delete",
      sessionId: "sess-1",
    }))

    expect(harness.terminal.calls).toContain("deleteSession")
    expect(harness.terminal.calls).not.toContain("stopControlledSession")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
  })

  it("names the operation when a failure has no reason of its own, differently per operation", async () => {
    /*
     * One sentence used to answer for every unclassified failure — "操作没有完成。" —
     * which names neither what was being done nor why it stopped, so the only reading
     * available to whoever saw it was that the app breaks at random. What is left when
     * nothing more specific can be said is the operation, which this layer does know.
     */
    const harness = createHarness()
    await attach(harness)
    vi.spyOn(harness.terminal, "renameSession").mockRejectedValue(new Error("boom"))
    vi.spyOn(harness.terminal, "readLineWindow").mockRejectedValue(new Error("boom"))

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-rename",
      kind: "rename",
      sessionId: "sess-1",
      title: "api",
    }))
    const renamed = harness.results.at(-1) as { result: { outcome: string; message: string } }

    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    const synced = harness.results.at(-1) as { result: { outcome: string; message: string } }

    expect(renamed.result).toMatchObject({ outcome: "rejected" })
    expect(synced.result).toMatchObject({ outcome: "rejected" })
    expect(renamed.result.message).toBe("重命名这个终端没有完成。")
    expect(synced.result.message).toBe("刷新终端列表没有完成。")
    expect(renamed.result.message).not.toBe(synced.result.message)
  })

  it("says a terminal is gone when the phone names one the computer no longer has", async () => {
    /*
     * The reader's list can be a moment behind a delete on the computer, and a phone
     * that was away can name a terminal closed in the meantime. Both mean the same
     * thing to the person holding it, and both used to arrive as an unexplained
     * failure: the lookup threw before the sentence written for this case was reached.
     */
    const harness = createHarness()
    harness.terminal.sessions.delete("sess-1")

    await attach(harness)

    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "rejected", code: "lifecycle_conflict", message: "该终端已结束。" },
    })
  })

  it("carries a terminal's own error code into the result, with words for it", async () => {
    /*
     * The code decides what the phone does with a refusal — `lease_preempted` is the
     * one it may replay. A terminal contract error keeps its code in `payload`, out of
     * reach of a plain property check, so every one of them arrived as `internal_error`
     * and was answered with the sentence that explained nothing.
     */
    const harness = createHarness()
    await attach(harness)
    vi.spyOn(harness.terminal, "renameSession")
      .mockRejectedValue(terminalContractError("not_found", "not_found"))

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-rename",
      kind: "rename",
      sessionId: "sess-1",
      title: "api",
    }))

    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "rejected", code: "not_found", message: "这个终端在电脑上已经不在了。" },
    })
  })

  it("treats deleting a terminal the computer already dropped as done", async () => {
    // The state this intent asks for is the one the terminal is already in, so a
    // second tap on something already deleted is not a failure to report.
    const harness = createHarness()
    harness.terminal.sessions.delete("sess-1")

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-delete",
      kind: "delete",
      sessionId: "sess-1",
    }))

    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.terminal.calls).not.toContain("deleteSession")
    expect(harness.terminal.calls).not.toContain("stopControlledSession")
  })

  it("drops a terminal the computer no longer has instead of failing the whole sync", async () => {
    /*
     * The phone re-attaches everything it had open, so a terminal the user closed on
     * the computer while the phone was away arrives here as a stale attachment. That
     * has to cost the one terminal rather than the sync: the sync is how the phone
     * finds out the terminal is gone, so answering it with a failure would leave the
     * phone with nothing — and with an error about a request it sent for itself.
     */
    const harness = createHarness()
    await attach(harness)
    harness.terminal.sessions.delete("sess-1")
    const framesBefore = harness.frames.filter((entry) => entry.frame.sessionId === "sess-1").length

    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))

    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.frames.filter((entry) => entry.frame.sessionId === "sess-1")).toHaveLength(framesBefore)

    // And it stays dropped: the next sync does not try it a second time.
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync-2", kind: "sync" }))

    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.frames.filter((entry) => entry.frame.sessionId === "sess-1")).toHaveLength(framesBefore)
  })

  it("renames a terminal and audits it", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-rename",
      kind: "rename",
      sessionId: "sess-1",
      title: "api",
    }))

    expect(harness.terminal.calls).toContain("renameSession")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.metadata.manage",
      outcome: "allowed",
    }))
  })

  it("attaches anyway when another writer already holds the lease", async () => {
    const harness = createHarness()
    harness.terminal.leaseOwner = "someone-else"

    await attach(harness)

    // Watching works without the lease; only writing waits for it. The message
    // tells the phone who is holding it, not that the terminal is unusable.
    expect(harness.frames).toHaveLength(1)
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "accepted", message: expect.stringContaining("另一个客户端") },
    })
  })

  it("rejects an intent the local policy denies without touching the terminal", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.deny = true
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-stop",
      kind: "stop",
      sessionId: "sess-1",
    }))

    expect(harness.terminal.calls).not.toContain("stopControlledSession")
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "rejected", code: "permission_denied" },
    })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.session.stop",
      outcome: "denied",
      actor: { kind: "agent", id: "mobile-gateway" },
    }))
  })

  it("audits allowed operations as the mobile gateway agent, never as the user", async () => {
    const harness = createHarness()
    await attach(harness)

    expect(harness.audits.length).toBeGreaterThan(0)
    for (const entry of harness.audits as { actor: { kind: string; id: string } }[]) {
      expect(entry.actor).toEqual({ kind: "agent", id: "mobile-gateway" })
    }
  })

  it("drops a session and releases its lease when the terminal ends", async () => {
    const harness = createHarness()
    await attach(harness)
    expect(harness.gateway.getState().attachments).toBe(1)

    harness.terminal.events.emit("sessionDeleted", { sessionId: "sess-1" })
    await harness.timers.advance(0)

    expect(harness.gateway.getState().attachments).toBe(0)
  })

  it("frees a session's lease when the phone goes away", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.releaseClient("phone-1")

    expect(harness.gateway.getState().attachments).toBe(0)
    expect(harness.terminal.calls).toContain("releaseControl")
  })

  it("records which phone set a terminal's grid", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-resize",
      kind: "resize",
      sessionId: "sess-1",
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
    }))

    expect(harness.terminal.calls).toContain("resizeSessionFromDevice")
    expect(harness.terminal.sessions.get("sess-1")).toMatchObject({
      cols: 54,
      rows: 37,
      sizeOwner: { deviceLabel: "iPhone", cols: 54, rows: 37 },
    })
  })

  /** A phone that is gone must stop deciding the grid, or the badge lies. */
  it("drops size ownership when the owning phone goes away", async () => {
    const harness = createHarness()
    await attach(harness)
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-resize",
      kind: "resize",
      sessionId: "sess-1",
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
    }))
    expect(harness.terminal.sessions.get("sess-1")?.sizeOwner).toBeDefined()

    await harness.gateway.releaseClient("phone-1")

    expect(harness.terminal.sessions.get("sess-1")?.sizeOwner).toBeUndefined()
  })

  /**
   * Leaving the phone-driven mode hands the grid back to the desktop, and the
   * desktop puts the PTY at its own shape in the same step.
   *
   * The desktop's fit is not a reliable second half: it only runs while a pane is
   * on screen, so a window that is closed or in the background would leave the
   * terminal at the phone's grid while the phone drew the desktop's.
   */
  it("restores the desktop's grid for a phone that stops driving it", async () => {
    const harness = createHarness()
    await attach(harness)
    // The desktop showed this terminal at its own shape before the phone took over.
    harness.terminal.fitToDesktopGrid("sess-1", 120, 40)
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-resize",
      kind: "resize",
      sessionId: "sess-1",
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
    }))
    expect(harness.terminal.sessions.get("sess-1")).toMatchObject({ cols: 54, rows: 37 })
    expect(harness.terminal.sessions.get("sess-1")?.sizeOwner).toBeDefined()
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-release",
      kind: "releaseGrid",
      sessionId: "sess-1",
    }))

    expect(harness.terminal.calls).toContain("restoreGridForDesktop")
    expect(harness.terminal.sessions.get("sess-1")).toMatchObject({ cols: 120, rows: 40 })
    expect(harness.terminal.sessions.get("sess-1")?.sizeOwner).toBeUndefined()
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
  })

  /**
   * A terminal the desktop has never drawn has no shape to restore, and inventing
   * one would be a second wrong size to move away from. The phone is told so
   * rather than left believing the switch worked.
   */
  it("refuses a restore when the desktop has never drawn the terminal", async () => {
    const harness = createHarness()
    await attach(harness)
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-resize",
      kind: "resize",
      sessionId: "sess-1",
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
    }))

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-release",
      kind: "releaseGrid",
      sessionId: "sess-1",
    }))

    // Rejected and not silently accepted: a silent no-op would leave the reader on
    // a mode the phone is not in. The wording is part of the protocol — it is what
    // the phone's banner says, and it names the state its rollback puts the reader
    // in, so the two sides move together.
    expect(harness.results.at(-1)).toMatchObject({
      result: {
        outcome: "rejected",
        code: "desktop_grid_unknown",
        message: "电脑端还没有显示过这个终端，已恢复为优先移动端。",
      },
    })
    // The claim still goes back — it is the size that could not be restored.
    expect(harness.terminal.sessions.get("sess-1")?.sizeOwner).toBeUndefined()
    expect(harness.terminal.sessions.get("sess-1")).toMatchObject({ cols: 54, rows: 37 })
  })

  /**
   * The idle sweep releases ownership on its own shorter clock — a phone that
   * vanished mid-use should stop deciding the grid long before the gateway
   * forgets it entirely.
   */
  it("drops size ownership from a phone that stopped responding", async () => {
    const harness = createHarness()
    await attach(harness)
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-resize",
      kind: "resize",
      sessionId: "sess-1",
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
    }))

    // Still within the ownership timeout: the claim stands even though every
    // other trace of activity is old.
    await harness.timers.advance(60_000)
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-tick", kind: "ping" }))
    expect(harness.terminal.sessions.get("sess-1")?.sizeOwner).toBeDefined()

    await harness.timers.advance(2 * 60_000)

    expect(harness.terminal.sessions.get("sess-1")?.sizeOwner).toBeUndefined()
  })

  /** Creating at the phone's shape claims it, so the badge is right from frame one. */
  it("claims the grid for a phone that created the session at its own size", async () => {
    const harness = createHarness()
    harness.terminal.sessions.set("sess-new", {
      id: "sess-new",
      groupId: "g1",
      title: "shell",
      status: "running",
      cwd: "/tmp",
      cols: 54,
      rows: 37,
      startedAt: new Date().toISOString(),
      lastOutputSeq: 0,
      attention: { state: "unknown", kind: "unknown" },
    })
    harness.terminal.lines.set("sess-new", [])

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-create-sized",
      kind: "create",
      groupId: "g1",
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
    }))

    expect(harness.terminal.sessions.get("sess-new")?.sizeOwner).toMatchObject({
      deviceLabel: "iPhone",
    })
  })

  /** A phone that sends no dimensions leaves the grid to the desktop. */
  it("does not claim the grid for a phone that created without one", async () => {
    const harness = createHarness()
    harness.terminal.sessions.set("sess-plain", {
      id: "sess-plain",
      groupId: "g1",
      title: "shell",
      status: "running",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      startedAt: new Date().toISOString(),
      lastOutputSeq: 0,
      attention: { state: "unknown", kind: "unknown" },
    })
    harness.terminal.lines.set("sess-plain", [])

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-create-plain",
      kind: "create",
      groupId: "g1",
    }))

    expect(harness.terminal.sessions.get("sess-plain")?.sizeOwner).toBeUndefined()
  })

  it("takes over a created session so the phone lands on a live terminal", async () => {
    const harness = createHarness()
    harness.terminal.sessions.set("sess-new", {
      id: "sess-new",
      groupId: "g1",
      title: "shell",
      status: "running",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      startedAt: new Date().toISOString(),
      lastOutputSeq: 0,
      attention: { state: "unknown", kind: "unknown" },
    })
    harness.terminal.lines.set("sess-new", [])

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-create",
      kind: "create",
      groupId: "g1",
    }))

    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "accepted", createdSessionId: "sess-new" },
    })
    expect(harness.gateway.getState().attachments).toBe(1)
  })

  /**
   * The phone's `＋` → 开始对话, end to end on the desktop side: it names a project and
   * nothing else, the computer resolves the rest, and the answer is the new terminal.
   */
  it("starts a Claude Code conversation from a phone that named only a project", async () => {
    const harness = createHarness()

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cc",
      kind: "createAgentConversation",
      projectId: "project-1",
    }))

    // The choice is left to the desktop, which is the whole point: the phone has no
    // Provider list and no key, and its default must be the desktop's default.
    expect(harness.launches).toEqual([{
      projectId: "project-1",
      createdByClientId: "mobile:phone-1",
    }])
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "accepted", createdSessionId: "sess-cc" },
    })
    // The phone lands on a live terminal rather than an empty row, exactly as it does
    // for a plain terminal it created.
    expect(harness.gateway.getState().attachments).toBe(1)
  })

  it("passes a phone's Provider and tier through, and its grid into creation", async () => {
    const harness = createHarness()

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cc-explicit",
      kind: "createAgentConversation",
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "opus",
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
    }))

    // The grid travels with the creation rather than as a follow-up resize: Claude Code
    // paints its banner at once, and those lines keep the width the PTY was born with.
    expect(harness.launches).toEqual([{
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "opus",
      cols: 54,
      rows: 37,
      createdByClientId: "mobile:phone-1",
    }])
  })

  it("creates nothing when the phone is not allowed to start a session", async () => {
    const harness = createHarness()
    harness.terminal.deny = true

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cc-denied",
      kind: "createAgentConversation",
      projectId: "project-1",
    }))

    expect(harness.createClaudeCodeConversation).not.toHaveBeenCalled()
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "rejected" } })
    expect(harness.terminal.sessions.has("sess-cc")).toBe(false)
  })

  /**
   * A short link is the ordinary way this arrives twice — the phone resends when the
   * first answer is slow — and a second launch would be a second terminal in the
   * user's project, which is a side effect nobody asked for.
   */
  it("starts only one conversation when the same intent arrives twice", async () => {
    const harness = createHarness()
    const duplicate = intent({
      v: 1,
      intentId: "i-cc-twice",
      kind: "createAgentConversation",
      projectId: "project-1",
    })

    await harness.gateway.handleIntent("phone-1", duplicate)
    await harness.gateway.handleIntent("phone-1", duplicate)

    expect(harness.createClaudeCodeConversation).toHaveBeenCalledTimes(1)
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "accepted", createdSessionId: "sess-cc" },
    })
  })

  /**
   * The launcher's failures are the user's to fix — no runtime installed, no Provider
   * that can name a model — and its wording is already the desktop's. Passing it
   * through is the difference between "在电脑上更新或重新安装 Synapse" and a phone
   * that only ever says 操作没有完成。
   */
  it("shows the launcher's own wording when the conversation cannot be started", async () => {
    const harness = createHarness()
    const failure = Object.assign(new Error("内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。"), {
      code: "runtime_missing",
      userFacing: true,
    })
    harness.createClaudeCodeConversation.mockRejectedValueOnce(failure)

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cc-failed",
      kind: "createAgentConversation",
      projectId: "project-1",
    }))

    expect(harness.results.at(-1)).toMatchObject({
      result: {
        outcome: "rejected",
        code: "runtime_missing",
        message: "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。",
      },
    })
    // Nothing half-made is left behind, and the phone is not attached to a terminal
    // that does not exist.
    expect(harness.terminal.sessions.has("sess-cc")).toBe(false)
    expect(harness.gateway.getState().attachments).toBe(0)
  })

  it("reports no_op for a keepalive and keeps the attachment alive", async () => {
    const harness = createHarness()
    await attach(harness)

    await harness.timers.advance(4 * 60_000)
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-ping", kind: "ping" }))
    await harness.timers.advance(4 * 60_000)

    expect(harness.gateway.getState().attachments).toBe(1)
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "no_op" } })
  })

  it("releases attachments from a phone that stopped responding", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.timers.advance(6 * 60_000)

    expect(harness.gateway.getState().attachments).toBe(0)
    expect(harness.terminal.calls).toContain("releaseControl")
  })

  it("sends the session list once and then deduplicates it", async () => {
    const harness = createHarness()
    await harness.timers.advance(1_000)
    const afterFirst = harness.summaries.length

    await harness.timers.advance(3_000)

    expect(afterFirst).toBeGreaterThan(0)
    expect(harness.summaries.length).toBe(afterFirst)
  })

  it("answers a sync with the list even though nothing about it changed", async () => {
    /*
     * The deduplication above is what keeps an idle desktop silent — and it is also
     * what left every phone showing an empty terminal list after the cloud was
     * redeployed. The desktop had sent its list to a process that no longer exists,
     * and "unchanged since I last sent it" is an answer to a listener that is no
     * longer there. A `sync` comes from a client that has just connected, so it has
     * received nothing and the list has to go out again.
     *
     * The cost of getting this wrong is invisible from the desktop: its terminals
     * are all there and working, and only the phone is blank.
     */
    const harness = createHarness()
    await harness.timers.advance(1_000)
    const afterFirst = harness.summaries.length
    expect(afterFirst).toBeGreaterThan(0)

    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(afterFirst)
  })

  it("sends the button list on sync, then deduplicates it against session activity", async () => {
    /*
     * Two halves of one rule. A phone that has just connected holds nothing, so the
     * list has to go out even though the desktop has not touched a command since the
     * last time it was sent — that is the `sync` half. And an idle desktop that is
     * merely printing to a terminal must not turn its buttons into a steady stream,
     * which is what the fingerprint is for.
     */
    const harness = createHarness()
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))

    expect(harness.toolbars).toHaveLength(1)
    expect(harness.toolbars[0]?.buttons.map((button) => button.id)).toEqual(["enter", "slash-exit"])
    const afterSync = harness.toolbars.length

    // Several summary ticks and a line of output: none of it is a reason to re-send.
    await harness.timers.advance(3_000)
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(3_000)

    expect(harness.toolbars).toHaveLength(afterSync)

    // And the other half: a *second* phone connecting gets the list too, even though
    // by now it has been fingerprinted and nothing about it has changed. Without this
    // the deduplication above would leave every phone but the first with no buttons.
    await harness.gateway.handleIntent("phone-2", intent({ v: 1, intentId: "i-sync-2", kind: "sync" }))
    expect(harness.toolbars.length).toBeGreaterThan(afterSync)
  })

  it("sends the buttons again when the phone opens a terminal", async () => {
    // Opening a terminal is when a stale list is most visible, and it is a deliberate
    // act rather than idle churn — so it refreshes even though nothing changed.
    const harness = createHarness()
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    const afterSync = harness.toolbars.length

    await attach(harness)

    expect(harness.toolbars.length).toBeGreaterThan(afterSync)
    expect(harness.toolbars.at(-1)?.buttons.map((button) => button.id))
      .toEqual(["enter", "slash-exit"])
  })

  it("picks up an edited button list on the next summary tick", async () => {
    /*
     * The buttons are not watched for changes — the terminal event emitter is at
     * Node's listener limit and is not allowed to grow — so they are re-read on the
     * ticks that already happen. This is what says that reading them again is enough:
     * the fingerprint is over the content, not over a revision counter.
     */
    const harness = createHarness()
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    const before = harness.toolbars.at(-1)

    harness.terminal.mobileToolbarButtons = [
      ...harness.terminal.mobileToolbarButtons,
      { id: "c1", label: "部署", group: "custom", action: { type: "text", text: "pnpm deploy", pressEnter: true } },
    ]
    await harness.timers.advance(1_000)

    const after = harness.toolbars.at(-1)
    expect(after?.buttons.map((button) => button.id)).toEqual(["enter", "slash-exit", "c1"])
    // The revision moves with the content, so a captured payload is self-describing.
    expect(after!.revision).toBeGreaterThan(before!.revision)
  })

  it("stops at the last button that fits rather than truncating one", async () => {
    // Half a command is a command the phone would run differently from the computer,
    // and the destructive ones are exactly the ones a user writes a button for. A
    // button that is simply absent is the safe failure.
    const harness = createHarness()
    const filler = "x".repeat(MOBILE_FRAME_LIMITS.maxToolbarTextLength)
    harness.terminal.mobileToolbarButtons = [
      { id: "keep", label: "部署", group: "custom", action: { type: "text", text: "pnpm deploy", pressEnter: true } },
      // 20 × 4 KiB is past the 64 KiB budget, so the tail has to go.
      ...Array.from({ length: 20 }, (_value, index) => ({
        id: `bulk-${index}`,
        label: "批量",
        group: "custom" as const,
        action: { type: "text" as const, text: filler, pressEnter: true },
      })),
    ]

    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))

    const buttons = harness.toolbars.at(-1)?.buttons ?? []
    expect(buttons[0]?.id).toBe("keep")
    expect(buttons.length).toBeGreaterThan(1)
    expect(buttons.length).toBeLessThan(21)
    // Every button that did go is whole — none of them was cut to fit.
    for (const button of buttons) {
      if (button.action.type === "text" && button.id !== "keep") {
        expect(button.action.text).toHaveLength(MOBILE_FRAME_LIMITS.maxToolbarTextLength)
      }
    }
    expect(Buffer.byteLength(JSON.stringify(buttons), "utf8"))
      .toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxToolbarBytes)
  })

  it("keeps the toolbar's own fingerprint separate from the summary's", async () => {
    // The two change on different occasions — the session list churns constantly, the
    // button list only when the user edits it. Sharing one fingerprint would make
    // every terminal that printed a line look like a reason to re-send the buttons.
    const harness = createHarness()
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    const toolbarsAfterSync = harness.toolbars.length
    const summariesAfterSync = harness.summaries.length

    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(summariesAfterSync)
    expect(harness.toolbars).toHaveLength(toolbarsAfterSync)
  })

  /*
   * The 快捷输入 sentences are the third payload family out of this gateway, and they
   * fail differently from the other two: a toolbar that goes missing leaves a phone
   * with its own built-in buttons, but sentences have no fallback — and, worse, a
   * phone that never hears this message at all cannot tell "this computer has none"
   * from "this computer is too old to have any". Both of those hinge on this side.
   */
  describe("quick phrases", () => {
    /** Lets the flush — which reads through an async source — run to completion. */
    async function settle(): Promise<void> {
      for (let index = 0; index < 5; index += 1) await Promise.resolve()
    }

    it("sends the sentences on sync, then deduplicates them against idle activity", async () => {
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()

      expect(harness.quickPhrases).toHaveLength(1)
      expect(harness.quickPhrases[0]?.phrases.map((phrase) => phrase.content))
        .toEqual(["整理成提交说明"])
      const afterSync = harness.quickPhrases.length

      // Summary ticks and terminal output: neither is a reason to re-send the table.
      await harness.timers.advance(3_000)
      harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
      await harness.timers.advance(3_000)
      await settle()

      expect(harness.quickPhrases).toHaveLength(afterSync)
    })

    it("sends the sentences to a second phone that has just connected", async () => {
      // The deduplication above is an answer to a listener that was there. A phone
      // that has just connected received nothing — including when the desktop's
      // earlier send went to a cloud process that has since been replaced.
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const afterFirstPhone = harness.quickPhrases.length

      await harness.gateway.handleIntent("phone-2", intent({ v: 1, intentId: "i-sync-2", kind: "sync" }))
      await settle()

      expect(harness.quickPhrases.length).toBeGreaterThan(afterFirstPhone)
    })

    it("sends the sentences again when the phone opens a terminal", async () => {
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const afterSync = harness.quickPhrases.length

      await attach(harness)
      await settle()

      expect(harness.quickPhrases.length).toBeGreaterThan(afterSync)
      expect(harness.quickPhrases.at(-1)?.phrases.map((phrase) => phrase.id)).toEqual(["q1"])
    })

    it("pushes an edited table without waiting for anything else to happen", async () => {
      // What the quick-input App's own `changed` event is wired to. Unlike the buttons,
      // which are re-read on ticks that already happen, this has a real signal — so a
      // user who edits a sentence while a phone is already connected, idle and looking
      // at the menu, does not have to wait for a reconnect to see it.
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const before = harness.quickPhrases.at(-1)

      harness.quickPhraseItems.push({ id: "q2", content: "这次改动整理成提交说明" })
      await harness.gateway.flushQuickPhrases()
      await settle()

      const after = harness.quickPhrases.at(-1)
      expect(after?.phrases.map((phrase) => phrase.id)).toEqual(["q1", "q2"])
      // The revision moves with the content, so a captured payload is self-describing.
      expect(after!.revision).toBeGreaterThan(before!.revision)
    })

    it("stays silent when the table is saved without changing what a phone would see", async () => {
      /*
       * The quick-input app emits `changed` on *every* save, including one that rewrote
       * the same sentence — so the event means "look again", not "something differs".
       * Without the fingerprint, opening the app's edit dialog and pressing 保存 without
       * touching anything would re-send the user's whole table to every phone.
       *
       * Idle still costs nothing either way, because the event only fires on a save. This
       * is about the noise a user's own harmless action would otherwise make.
       */
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const afterSync = harness.quickPhrases.length

      await harness.gateway.flushQuickPhrases()
      await settle()

      expect(harness.quickPhrases).toHaveLength(afterSync)
    })

    it("sends an empty list rather than staying silent when the user has none", async () => {
      /*
       * The whole reason the phone can draw its second segment. `[]` says "this
       * computer has none" and the phone answers with an empty state; *no message at
       * all* says "this computer is too old to know about phrases" and the phone
       * draws no second segment. Suppressing the empty send erases that distinction,
       * and it fails in the direction a user reads as their configuration being lost.
       */
      const harness = createHarness()
      harness.quickPhraseItems.length = 0

      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()

      expect(harness.quickPhrases).toHaveLength(1)
      expect(harness.quickPhrases[0]?.phrases).toEqual([])
    })

    it("drops a sentence past the wire limit whole rather than truncating it", async () => {
      // A sentence shortened to fit would be typed into the composer and sent as if it
      // were the one the user wrote on the computer. Absent is the safe failure, and
      // it is not silent: the desktop says which entry it left out and why.
      const harness = createHarness()
      harness.quickPhraseItems.push({
        id: "q2",
        content: "长".repeat(MOBILE_FRAME_LIMITS.maxQuickPhraseLength + 1),
      })

      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()

      const sent = harness.quickPhrases.at(-1)?.phrases ?? []
      expect(sent.map((phrase) => phrase.id)).toEqual(["q1"])
      for (const phrase of sent) {
        expect(phrase.content.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxQuickPhraseLength)
      }
      expect(harness.warns.some((entry) => entry.message.includes("exceeding the wire limit"))).toBe(true)
    })

    it("stops at the last sentence that fits rather than cutting one", async () => {
      const harness = createHarness()
      const filler = "长".repeat(MOBILE_FRAME_LIMITS.maxQuickPhraseLength)
      harness.quickPhraseItems.push(
        // Far past the 64 KiB budget once serialized, so the tail has to go.
        ...Array.from({ length: 40 }, (_value, index) => ({ id: `bulk-${index}`, content: filler })),
      )

      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()

      const sent = harness.quickPhrases.at(-1)?.phrases ?? []
      expect(sent[0]?.id).toBe("q1")
      expect(sent.length).toBeGreaterThan(1)
      expect(sent.length).toBeLessThan(41)
      // Every sentence that did go is whole — none was cut to fit.
      for (const phrase of sent) {
        if (phrase.id === "q1") continue
        expect(phrase.content).toHaveLength(MOBILE_FRAME_LIMITS.maxQuickPhraseLength)
      }
      expect(Buffer.byteLength(JSON.stringify(sent), "utf8"))
        .toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxQuickPhrasesBytes)
    })

    it("keeps the sentences' fingerprint separate from the toolbar's and the summary's", async () => {
      // Three lists that change on three different occasions. One shared fingerprint
      // would make any edit of any of them re-send all three.
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const phrasesAfterSync = harness.quickPhrases.length
      const toolbarsAfterSync = harness.toolbars.length
      const summariesAfterSync = harness.summaries.length

      await harness.timers.advance(1_000)
      await settle()

      expect(harness.summaries.length).toBeGreaterThan(summariesAfterSync)
      expect(harness.toolbars).toHaveLength(toolbarsAfterSync)
      expect(harness.quickPhrases).toHaveLength(phrasesAfterSync)
    })
  })

  it("checks policy under the narrow agent identity, never the user", async () => {
    const harness = createHarness()
    await attach(harness)

    expect(harness.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      actor: { kind: "agent", id: "mobile-gateway" },
      resource: "terminal.session:sess-1",
      action: "terminal.state.read",
    }))
  })
  it("sends the recovery snapshot after a dropped update with no further output", async () => {
    /*
     * A dropped update is recovered by the *next* flush, and the timer that drives
     * the next flush is armed by terminal output. When the drop lands on the last
     * burst a session produces, there is no next output to arm it: the update is
     * gone, no repair is ever attempted, and the phone keeps the previous screen
     * for good — the session looks like it stopped mid-sentence.
     */
    const harness = createHarness()
    await attach(harness)
    harness.frames.length = 0

    // Far past the 64 KiB uplink budget once serialized, so the update is dropped.
    harness.terminal.lines.set(
      "sess-1",
      Array.from({ length: 100 }, (_value, index) => ({
        text: `line-${index} ${"x".repeat(2_100)}`,
      })),
    )
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })

    // First flush: the update is over budget and goes nowhere.
    await harness.timers.advance(60)
    expect(harness.frames).toHaveLength(0)

    // Second flush: the repair, owed to no output in particular.
    await harness.timers.advance(60)
    expect(harness.frames.length).toBeGreaterThan(0)
    const recovered = harness.frames.flatMap((entry) => entry.frame)
    expect(recovered[0].kind).toBe("reset")
    expect(recovered.at(-1)?.from).toBeGreaterThanOrEqual(0)
    const tail = recovered.filter((frame) => frame.lines.length > 0).at(-1)
    expect(tail?.lines.at(-1)?.[0]).toContain("line-99")
  })

  it("anchors gateway indices to the emulator's own so history can be named", async () => {
    // 300 lines behind a 100-line window: the window starts at emulator index 200,
    // and the client's oldest line must be index 200 rather than 0, or nothing
    // older than the window could ever be requested.
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)

    const snapshot = harness.frames[0].frame
    expect(snapshot.from).toBe(200)
    expect(snapshot.total).toBe(300)
  })

  it("serves the page just below what the phone already has", async () => {
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 200,
      limit: 50,
    }))

    expect(harness.frames).toHaveLength(1)
    const frame = harness.frames[0].frame
    expect(frame.kind).toBe("history")
    expect(frame.from).toBe(150)
    expect(frame.lines).toHaveLength(50)
    expect(frame.lines[0][0]).toBe("line-150")
    expect(frame.lines.at(-1)?.[0]).toBe("line-199")
  })

  it("walks backwards across pages until the buffer runs out", async () => {
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    let before = 200
    for (let page = 0; page < 5; page += 1) {
      await harness.gateway.handleIntent("phone-1", intent({
        v: 1,
        intentId: `i-history-${page}`,
        kind: "history",
        sessionId: "sess-1",
        before,
        limit: 50,
      }))
      const frame = harness.frames.at(-1)!.frame
      if (frame.lines.length === 0) break
      before = frame.from
    }

    // 200 lines below the window, 50 at a time: four pages, then an empty one
    // that tells the phone to stop asking.
    expect(before).toBe(0)
    const last = harness.frames.at(-1)!.frame
    expect(last.lines).toHaveLength(0)
    expect(last.from).toBe(0)
  })

  it("answers an empty page, not an error, once the emulator has evicted the rest", async () => {
    const harness = createHarness({ sessionLines: 30 })
    await attach(harness)
    harness.frames.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 0,
      limit: 50,
    }))

    const frame = harness.frames[0].frame
    expect(frame.kind).toBe("history")
    expect(frame.lines).toHaveLength(0)
  })

  it("pages through a terminal's history without touching the write lease", async () => {
    // Looking further back is reading, so it must not need the lease a write does.
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 200,
      limit: 10,
    }))

    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.frames[0].frame.lines).toHaveLength(10)
  })
  it("keeps the cursor on the same line when only the tail of the window changes", async () => {
    // The window's head is unchanged, so the update's `from` is the first *changed*
    // line — later than the window's start. Deriving the cursor's gateway row from
    // that instead of from the window's start pushed it down by however much of the
    // window had not changed, which is what put the cursor on the wrong row on a
    // phone. The window did not move here, so the cursor must not either.
    const harness = createHarness({ sessionLines: 40 })
    await attach(harness)

    const lines = Array.from({ length: 40 }, (_, index) => ({ text: `line-${index}` }))
    harness.terminal.lines.set("sess-1", lines)
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(60)
    const settled = harness.frames.at(-1)!.frame.cursor.row

    harness.frames.length = 0
    const changed = lines.map((line, index) => index === 39 ? { text: "line-39 rewritten" } : line)
    harness.terminal.lines.set("sess-1", changed)
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 3 } })
    await harness.timers.advance(60)

    expect(harness.frames.at(-1)?.frame.cursor.row).toBe(settled)
  })

  it("never emits a negative line index while the buffer is still filling", async () => {
    // The window slides over a growing buffer without anything being evicted, so
    // the emulator's window start and the tracker's do not move together. Mapping
    // through the window position instead of the eviction count produced a
    // negative index here — and a negative index is a malformed frame, which the
    // server answers by closing the desktop's whole connection.
    const harness = createHarness({ sessionLines: 40 })
    await attach(harness)
    harness.frames.length = 0

    harness.terminal.lines.set(
      "sess-1",
      Array.from({ length: 260 }, (_, index) => ({ text: `grown-${index}` })),
    )
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(60)

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 0,
      limit: 50,
    }))

    for (const entry of harness.frames) {
      expect(entry.frame.from).toBeGreaterThanOrEqual(0)
    }
    // Nothing older than the anchor exists in gateway space, so this is the end.
    expect(harness.frames.at(-1)?.frame.lines).toHaveLength(0)
  })

  it("never serves a page that reaches below index zero", async () => {
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    // A greedier request than the history holds must be clamped, not allowed to
    // run off the bottom of the index space.
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 200,
      limit: 500,
    }))

    const frame = harness.frames[0].frame
    expect(frame.from).toBe(0)
    expect(frame.lines).toHaveLength(200)
  })

  it("clamps a session field that outgrows the wire bound rather than failing validation", async () => {
    const harness = createHarness()
    const existing = harness.terminal.sessions.get("sess-1")!
    harness.terminal.sessions.set("sess-1", {
      ...existing,
      title: "t".repeat(MOBILE_FRAME_LIMITS.maxTitleLength + 500),
      cwd: "/".concat("d".repeat(MOBILE_FRAME_LIMITS.maxSummaryCwdLength + 500)),
    })
    harness.terminal.lines.set("sess-1", [
      { text: "l".repeat(MOBILE_FRAME_LIMITS.maxSummaryLastLineLength + 500) },
    ])

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    const session = draft.sessions[0]
    expect(session.title).toHaveLength(MOBILE_FRAME_LIMITS.maxTitleLength)
    expect(session.cwd).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryCwdLength)
    expect(session.lastLine).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryLastLineLength)
    // The point of clamping is not the truncation itself but that what the desktop
    // emits is accepted by the relay; a rejection here closes the socket.
    expect(isMobileSummaryPayload({
      desktopClientInstanceId: "desktop-1",
      desktopName: "MacBook Pro",
      ...draft,
    })).toBe(true)
  })

  it("carries the computer's group order to the phone unchanged", async () => {
    const harness = createHarness()
    // Deliberately neither alphabetical nor creation-ordered: the phone's 新建 panel is
    // standing in for the computer's own sidebar, so the only sequence it may offer is
    // the one that sidebar shows — anything else is a list the user cannot explain.
    harness.terminal.groups = [
      { id: "g1", name: "Synapse" },
      { id: "g2", name: "brick lab" },
      { id: "g3", name: "前端开发" },
    ]
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-1" })
    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.groups.map((group) => group.name)).toEqual(["Synapse", "brick lab", "前端开发"])
  })

  it("keeps the largest admissible session list inside the summary's byte budget", async () => {
    const harness = createHarness()
    const limits = MOBILE_FRAME_LIMITS
    harness.terminal.sessions.clear()
    harness.terminal.lines.clear()
    for (let index = 0; index < limits.maxSummarySessions; index += 1) {
      // Long enough to hit every field bound, and unique so the per-session caches
      // and line lookups cannot collapse the rows into one.
      const suffix = String(index).padStart(4, "0")
      const id = `${"i".repeat(limits.maxSummaryIdLength - 4)}${suffix}`
      harness.terminal.sessions.set(id, {
        id,
        groupId: "g".repeat(limits.maxSummaryIdLength),
        title: "t".repeat(limits.maxTitleLength),
        status: "running",
        cwd: "/".concat("d".repeat(limits.maxSummaryCwdLength - 1)),
        cols: 500,
        rows: 200,
        startedAt: new Date().toISOString(),
        lastOutputSeq: index,
        attention: { state: "not_waiting", kind: "unknown" },
      })
      harness.terminal.lines.set(id, [
        { text: "l".repeat(limits.maxSummaryLastLineLength) },
      ])
    }
    // The directories count towards the same budget — it bounds what the socket has to
    // carry, not which block spent it — so the widest summary is the one with these at
    // their own maxima too.
    harness.agentGroups.push(...Array.from(
      { length: limits.maxSummaryAgentGroups - harness.agentGroups.length },
      (_, index) => ({
        projectId: `p${"x".repeat(limits.maxSummaryIdLength - 2)}${String(index).padStart(1, "0")}`.slice(0, limits.maxSummaryIdLength),
        name: "n".repeat(limits.maxSummaryAgentNameLength),
        isDefault: false,
      }),
    ))
    harness.agentProviders.push(...Array.from(
      { length: limits.maxSummaryAgentProviders - harness.agentProviders.length },
      (_, index) => ({
        id: `v${"x".repeat(limits.maxSummaryIdLength - 4)}${String(index).padStart(3, "0")}`,
        name: "n".repeat(limits.maxSummaryAgentNameLength),
        isDefault: false,
        defaultTier: "opus" as const,
        models: {
          default: "m".repeat(limits.maxSummaryModelNameLength),
          opus: "m".repeat(limits.maxSummaryModelNameLength),
          sonnet: "m".repeat(limits.maxSummaryModelNameLength),
          haiku: "m".repeat(limits.maxSummaryModelNameLength),
        },
      }),
    ))

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions).toHaveLength(limits.maxSummarySessions)
    expect(draft.agentGroups).toHaveLength(limits.maxSummaryAgentGroups)
    expect(draft.agentProviders).toHaveLength(limits.maxSummaryAgentProviders)
    expect(Buffer.byteLength(JSON.stringify(draft), "utf8")).toBeLessThanOrEqual(limits.maxSummaryBytes)
    expect(isMobileSummaryPayload({
      desktopClientInstanceId: "desktop-1",
      desktopName: "MacBook Pro",
      ...draft,
    })).toBe(true)
  })

  /**
   * The panel's two directories ride on the summary rather than being fetched, so a
   * phone that has just connected can draw it with nothing to wait for — which is the
   * whole point of `＋` → 开始对话 with no loading state in between.
   */
  it("carries the projects and Providers a phone may start a conversation in", async () => {
    const harness = createHarness()
    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.agentGroups).toEqual([
      { projectId: "builtin:default-agent-workspace", name: "本地对话", isDefault: true },
      { projectId: "project-1", name: "Synapse", isDefault: false },
    ])
    expect(draft.agentProviders).toEqual([
      {
        id: "local-claude-code",
        name: "Claude Code 本地",
        isDefault: false,
        defaultTier: "default",
        models: { default: "Claude Code 默认" },
      },
      {
        id: "preferred",
        name: "Anthropic 官方",
        isDefault: true,
        defaultTier: "opus",
        models: { default: "claude-sonnet-4-5", opus: "claude-opus-4-5" },
      },
    ])
    // What the phone is handed has to clear the relay's guard, and the Provider rows
    // are the ones worth checking: a field added to the desktop's provider record must
    // not be able to arrive here, or the guard would reject the whole summary.
    expect(isMobileSummaryPayload({
      desktopClientInstanceId: "desktop-1",
      desktopName: "MacBook Pro",
      ...draft,
    })).toBe(true)
  })

  it("sends the list again when a project is renamed, and says nothing when it is not", async () => {
    const harness = createHarness()
    await harness.timers.advance(1_000)
    const afterFirst = harness.summaries.length
    expect(afterFirst).toBeGreaterThan(0)

    // Something happened on the desktop, so a summary is scheduled — but nothing in
    // it changed, so the serialized bytes are identical to the last ones and it is
    // deduplicated away. This is the same fingerprint the session list already relies
    // on, and the directories are inside it.
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-1" })
    await harness.timers.advance(1_000)
    expect(harness.summaries.length).toBe(afterFirst)

    // A rename is a change to the directory, so the next one does go out — a phone
    // that kept showing the old name would be showing a project that no longer exists.
    harness.agentGroups[1] = { ...harness.agentGroups[1]!, name: "Synapse 重命名" }
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-1" })
    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(afterFirst)
    expect((harness.summaries.at(-1) as MobileSummaryDraft).agentGroups?.[1]?.name).toBe("Synapse 重命名")
  })

  it("clamps a directory entry that outgrows the wire bound rather than failing validation", async () => {
    const harness = createHarness()
    harness.agentGroups.push({
      projectId: "p".repeat(MOBILE_FRAME_LIMITS.maxSummaryIdLength + 400),
      name: "n".repeat(MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength + 400),
      isDefault: false,
    })
    harness.agentProviders.push({
      id: "v".repeat(MOBILE_FRAME_LIMITS.maxSummaryIdLength + 400),
      name: "n".repeat(MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength + 400),
      isDefault: false,
      defaultTier: "opus",
      models: { opus: "m".repeat(MOBILE_FRAME_LIMITS.maxSummaryModelNameLength + 400) },
    })

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    const group = draft.agentGroups?.at(-1)
    const provider = draft.agentProviders?.at(-1)
    expect(group?.projectId).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryIdLength)
    expect(group?.name).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength)
    expect(provider?.name).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength)
    expect(provider?.models.opus).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryModelNameLength)
    // A project name is whatever the user typed, so this is the ordinary case rather
    // than an edge one — and an unclamped field is answered by a closed socket.
    expect(isMobileSummaryPayload({
      desktopClientInstanceId: "desktop-1",
      desktopName: "MacBook Pro",
      ...draft,
    })).toBe(true)
  })

  /**
   * A directory that cannot be read is left out of the payload rather than sent empty.
   * An empty list would say "you have no projects", which is a worse answer than saying
   * nothing — and either way the terminals in the same message are unaffected, because
   * the panel is an addition to the list rather than part of it.
   */
  it("omits a directory it could not read without dropping the conversations", async () => {
    const harness = createHarness()
    harness.listAgentConversationProviders.mockRejectedValueOnce(new Error("data repository unavailable"))

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.agentProviders).toBeUndefined()
    expect(draft.agentGroups).toEqual([
      { projectId: "builtin:default-agent-workspace", name: "本地对话", isDefault: true },
      { projectId: "project-1", name: "Synapse", isDefault: false },
    ])
    expect(draft.sessions.map((session) => session.id)).toEqual(["sess-1"])
  })

  it("never splits a surrogate pair when clamping", () => {
    expect(clampSummaryText("👍".repeat(10), 5)).toBe("👍".repeat(2))
    expect(clampSummaryText("ab👍", 3)).toBe("ab")
    expect(clampSummaryText("abc", 10)).toBe("abc")
  })

  it("names the phone deciding a session's grid, and says nothing when none is", async () => {
    const harness = createHarness()
    const session = harness.terminal.sessions.get("sess-1")!
    session.sizeOwner = {
      kind: "mobile",
      deviceLabel: "iPhone",
      mobileClientInstanceId: "phone-1",
      cols: 54,
      rows: 37,
    }

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions[0]?.gridOwnerId).toBe("phone-1")

    // The ordinary case, and the reason the field is optional: a terminal the
    // desktop's own layout decides carries no key at all rather than a null.
    session.sizeOwner = undefined
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-1" })
    await harness.timers.advance(1_000)

    const after = harness.summaries.at(-1) as MobileSummaryDraft
    expect(after.sessions[0]?.gridOwnerId).toBeUndefined()
    expect(JSON.stringify(after.sessions[0])).not.toContain("gridOwnerId")
  })

  it("omits the tab layer while no tab is split", async () => {
    const harness = createHarness()
    // A conversation's own tab, which is what every session gets by default.
    seedWorkspace(harness, { type: "leaf", paneId: "pane-1", sessionId: "sess-1" })

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions).toHaveLength(1)
    // One pane per tab is what the flat list already says, so restating it would be
    // overhead on every summary and would change the payload for phones that do not
    // need it.
    expect(draft.workspaces).toBeUndefined()
    // The serialized form is the one that matters: the fingerprint is taken over it,
    // so an unsplit desktop hashes — and therefore costs — exactly what it did before
    // the tab layer existed.
    expect(JSON.stringify(draft)).not.toContain("workspaces")
  })

  it("reports which conversations share a tab once one is split", async () => {
    const harness = createHarness()
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
    })

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.workspaces).toEqual([{
      id: "ws-1",
      groupId: "g1",
      title: "前端开发",
      panes: [
        { paneId: "pane-1", sessionId: "sess-1" },
        { paneId: "pane-2", sessionId: "sess-2" },
      ],
    }])
  })

  it("treats a split as a change worth pushing", async () => {
    const harness = createHarness()
    seedWorkspace(harness, { type: "leaf", paneId: "pane-1", sessionId: "sess-1" })
    await harness.timers.advance(1_000)
    const beforeSplit = harness.summaries.length
    expect((harness.summaries.at(-1) as MobileSummaryDraft).workspaces).toBeUndefined()

    // Splitting creates a session, which is what the terminal service announces; the
    // summary is only ever produced in response to an event, so without this the new
    // tab layer would sit unsent.
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
    })
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-2" })

    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(beforeSplit)
    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.workspaces).toHaveLength(1)
    expect(draft.workspaces?.[0].panes.map((pane) => pane.sessionId)).toEqual(["sess-1", "sess-2"])
  })

  it("treats closing a pane as a change worth pushing too", async () => {
    const harness = createHarness()
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
    })
    await harness.timers.advance(1_000)
    const withSplit = harness.summaries.length
    expect((harness.summaries.at(-1) as MobileSummaryDraft).workspaces).toHaveLength(1)

    // Closing the pane takes its session with it and collapses the tab back to one
    // leaf, which is the point where the layer stops carrying information.
    harness.terminal.sessions.delete("sess-2")
    seedWorkspace(harness, { type: "leaf", paneId: "pane-1", sessionId: "sess-1" })
    harness.terminal.events.emit("sessionDeleted", { sessionId: "sess-2" })

    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(withSplit)
    expect((harness.summaries.at(-1) as MobileSummaryDraft).workspaces).toBeUndefined()
  })

  it("never names a conversation the summary does not carry", async () => {
    const harness = createHarness()
    // A persisted layout whose second session did not survive the reload: the tab is
    // real, the conversation behind one of its panes is not.
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-gone" },
    })

    await harness.timers.advance(1_000)

    // Filtering leaves one pane, which is the unsplit case again — a tab the phone
    // could not draw any useful distinction from the flat list.
    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions).toHaveLength(1)
    expect(draft.workspaces).toBeUndefined()
  })

  it("keeps the surviving panes of a tab when another one's session is gone", async () => {
    const harness = createHarness()
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: {
        type: "split",
        splitId: "split-2",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
        second: { type: "leaf", paneId: "pane-3", sessionId: "sess-gone" },
      },
    })

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.workspaces?.[0].panes).toEqual([
      { paneId: "pane-1", sessionId: "sess-1" },
      { paneId: "pane-2", sessionId: "sess-2" },
    ])
  })
})
