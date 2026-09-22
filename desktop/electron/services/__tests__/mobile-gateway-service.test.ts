import { EventEmitter } from "node:events"
import { readFileSync, readdirSync } from "node:fs"
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
  MOBILE_AGENT_DIRECTORY_CACHE_MS,
  MobileGatewayService,
  type MobileGatewayAgentGroup,
  type MobileGatewayAgentProvider,
} from "../mobile-gateway-service"
import type { ClipboardSyncEntry } from "../clipboard-sync-service"
import { MobileFileRelay } from "../mobile-gateway/file-relay"
import type { TerminalGitService } from "../terminal-git/terminal-git-service"
import type { TerminalGitOutcome, TerminalGitSnapshot } from "../terminal-git/terminal-git-types"
import type { ClaudeCodeConversationLaunch } from "../mobile-gateway/intent-executor"
import type {
  MobileClipboardDraft,
  MobileGatewayTransport,
  MobileGitStatusDraft,
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

  /**
   * 多行命令走的那一条：粘贴 + 回车。
   *
   * 记下原文而不只是记下调用，因为这条通道的整个意义就在那段文字上 —— 换行有没有
   * 被归一化、整段是不是一条，只有看文字才知道。
   */
  readonly pasteCommands: string[] = []

  async pasteCommand(input: { readonly text: string }) {
    this.calls.push("pasteCommand")
    this.pasteCommands.push(input.text)
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

  /**
   * 会话当前所在的那个目录，按会话记。
   *
   * 它就是「用户在终端里 cd 走了」这件事在测试里的写法：真实的实现先看外壳上报的
   * OSC 7，没有才去探测缓存，最后退回会话启动目录 —— 这里只要一个可写的答案。
   */
  readonly reportedCwd = new Map<string, string>()

  getCurrentWorkingDirectory(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    if (!session) throw terminalContractError("not_found", "not_found")
    return this.reportedCwd.get(sessionId) ?? session.cwd
  }

  /** 可等待的那一个，给「有人问」的时刻（手机发起一次 Git 动作）。 */
  async probeCurrentWorkingDirectory(sessionId: string): Promise<string> {
    this.calls.push("probeCurrentWorkingDirectory")
    return this.getCurrentWorkingDirectory(sessionId)
  }
}

/**
 * 按目录跑 git 的那一层，记下每次调用与参数。
 *
 * 这里不是「顺手 mock 掉」：手机端的每个动作都要落到这个服务的某个方法上，
 * 而落错方法（比如「合并」落到「同步」）在读代码时是看不出来的。
 */
class FakeTerminalGit {
  readonly calls: { readonly method: string; readonly input: Record<string, unknown> }[] = []
  /** 按目录给的快照覆盖：同一台电脑上不同会话可能停在不同仓库。 */
  readonly byCwd = new Map<string, Partial<TerminalGitSnapshot>>()
  /** 让动作失败，用来测失败面；`null` = 一切照常成功。 */
  failure:
    | {
        readonly message: string
        readonly needsDecision?: "dirty" | "localBranchName"
        readonly conflict?: unknown
        /** 只让这几个方法失败；缺席＝每个方法都失败。 */
        readonly only?: readonly string[]
      }
    | null = null
  branches: readonly { readonly name: string; readonly current: boolean }[] = [
    { name: "main", current: true },
    { name: "release", current: false },
  ]
  remoteBranches: readonly { readonly remote: string; readonly name: string }[] = [
    { remote: "origin", name: "main" },
    { remote: "origin", name: "release" },
  ]

  private record(method: string, input: Record<string, unknown>): void {
    this.calls.push({ method, input })
  }

  snapshotFor(cwd: string): TerminalGitSnapshot {
    return {
      cwd,
      isRepository: true,
      branch: "main",
      detachedSha: null,
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      changeCount: 0,
      hasConflicts: false,
      changes: [],
      ...this.byCwd.get(cwd),
    }
  }

  private outcome(cwd: string, method: string): TerminalGitOutcome<TerminalGitSnapshot> {
    const failure = this.failure
    if (failure && (!failure.only || failure.only.includes(method))) {
      const { message, needsDecision, conflict } = failure
      return {
        ok: false,
        message,
        ...(needsDecision === undefined ? {} : { needsDecision }),
        ...(conflict === undefined ? {} : { conflict }),
      } as TerminalGitOutcome<TerminalGitSnapshot>
    }
    return { ok: true, value: this.snapshotFor(cwd) }
  }

  async getSnapshot(cwd: string) {
    this.record("getSnapshot", { cwd })
    return this.snapshotFor(cwd)
  }

  async isRepository(cwd: string) {
    this.record("isRepository", { cwd })
    return true
  }

  async listBranches(cwd: string) {
    this.record("listBranches", { cwd })
    return this.branches
  }

  async listRemoteBranches(cwd: string) {
    this.record("listRemoteBranches", { cwd })
    return this.remoteBranches
  }

  async checkout(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("checkout", input)
    return this.outcome(input.cwd, "checkout")
  }

  async createBranch(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("createBranch", input)
    return this.outcome(input.cwd, "createBranch")
  }

  async commit(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("commit", input)
    return this.outcome(input.cwd, "commit")
  }

  async push(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("push", input)
    return this.outcome(input.cwd, "push")
  }

  async sync(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("sync", input)
    return this.outcome(input.cwd, "sync")
  }

  async merge(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("merge", input)
    return this.outcome(input.cwd, "merge")
  }

  async fetchRemotes(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("fetchRemotes", input)
    return this.outcome(input.cwd, "fetchRemotes")
  }

  async checkoutRemote(input: { readonly cwd: string } & Record<string, unknown>) {
    this.record("checkoutRemote", input)
    return this.outcome(input.cwd, "checkoutRemote")
  }
}

function createHarness(options: { sessionLines?: number; lineWindowLines?: number } = {}) {
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
  const frames: { mobileClientInstanceId: string; frame: MobileTerminalFrame; json: string }[] = []
  const summaries: unknown[] = []
  const results: unknown[] = []
  const progress: MobileTransferProgressPayload[] = []
  const toolbars: MobileToolbarDraft[] = []
  const quickPhrases: MobileQuickPhrasesDraft[] = []
  const clipboards: MobileClipboardDraft[] = []
  const gitStatuses: MobileGitStatusDraft[] = []
  const transport: MobileGatewayTransport = {
    sendSummary: (draft) => summaries.push(draft),
    // The transport is handed the frame already serialized — the very bytes the uplink
    // budget was charged — so the double keeps both: the string for the tests that are
    // about the bytes, and the parsed frame for the many that are about its content.
    sendFrame: (mobileClientInstanceId, frameJson) => frames.push({
      mobileClientInstanceId,
      json: frameJson,
      frame: JSON.parse(frameJson) as MobileTerminalFrame,
    }),
    sendIntentResult: (mobileClientInstanceId, result) => {
      results.push({ mobileClientInstanceId, result })
    },
    sendTransferProgress: (payload) => progress.push(payload),
    sendToolbar: (draft) => toolbars.push(draft),
    sendQuickPhrases: (draft) => quickPhrases.push(draft),
    sendClipboard: (draft) => clipboards.push(draft),
    sendGitStatus: (draft) => gitStatuses.push(draft),
  }
  const audits: unknown[] = []
  const warns: { message: string; meta?: Record<string, unknown> }[] = []
  // Kept as well as the warnings: the frame-flush entries are `info`, and they are where
  // the byte count a flush was charged is written down.
  const infos: { message: string; meta?: Record<string, unknown> }[] = []
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
  /** Mutable so a test can copy something and see whether the gateway notices. */
  const clipboardEntries: ClipboardSyncEntry[] = [
    { id: "c1", text: "pnpm mobile:install", copiedAt: "2026-09-21T10:00:00.000Z" },
  ]
  const listClipboard = vi.fn(async () => [...clipboardEntries])

  const terminalGit = new FakeTerminalGit()
  const gateway = new MobileGatewayService({
    terminal: terminal as unknown as TerminalService,
    terminalGit: terminalGit as unknown as TerminalGitService,
    fileRelay,
    createClaudeCodeConversation,
    listAgentConversationGroups,
    listAgentConversationProviders,
    listQuickPhrases,
    listClipboard,
    permissionGuard,
    auditSink: { record: (event: unknown) => audits.push(event), list: () => [], clearForTests: () => {} },
    logger: {
      info: (message: string, meta?: Record<string, unknown>) => infos.push({ message, meta }),
      warn: (message: string, meta?: Record<string, unknown>) => warns.push({ message, meta }),
    },
    now: () => new Date(timers.nowMs),
    setTimeout: timers.set,
    clearTimeout: timers.clear,
    lineWindowLines: options.lineWindowLines ?? 100,
  })
  gateway.start()
  gateway.setTransport(transport)

  return {
    gateway, terminal, timers, transport, frames, summaries, results, audits, toolbars,
    quickPhrases, quickPhraseItems, listQuickPhrases,
    clipboards, clipboardEntries, listClipboard, gitStatuses, terminalGit,
    permissionGuard, fileRelay, landings, discarded, progress, warns, infos,
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

/**
 * Lines chosen for what `JSON.stringify` has to work at: a quote and a backslash (which
 * change a string's length on the wire), a tab, a newline and a bell (escaped, not
 * emitted), non-BMP characters, and a lone surrogate — which has to be escaped, because
 * emitting it would produce bytes no JSON parser can read back.
 */
function trickyLines(count: number): TerminalStyledLine[] {
  const texts = [
    'quote " backslash \\ slash /',
    "中文行 中文 emoji 👍🏽",
    "tab\there newline\nthere bell\u0007",
    "lone\ud800surrogate",
    "plain ascii",
  ]
  return Array.from({ length: count }, (_, index) => ({ text: texts[index % texts.length]! }))
}

/** A frame, as opposed to the summary and toolbar payloads that are serialized too. */
function isTerminalFrame(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "sessionId" in value
    && "lines" in value
    && "cursor" in value
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

  it("charges the budget what the frame costs once serialized, and serializes it once", async () => {
    /*
     * The uplink budget is stated in bytes on the wire, and the only honest way to know
     * them is to serialize the frame — so the string the measurement produced is the one
     * the transport is handed, and the decision, the log line and the send all read the
     * same number. The lines below are the ones JSON has to work at: quotes, a
     * backslash, control characters, non-BMP characters and a lone surrogate that has to
     * be escaped rather than emitted.
     */
    const harness = createHarness({ sessionLines: 0, lineWindowLines: 600 })
    harness.terminal.lines.set("sess-1", trickyLines(600))
    const stringify = vi.spyOn(JSON, "stringify")

    await attach(harness)
    // Read before restoring: `mockRestore` clears the recorded calls with the spy.
    const frameSerializations = stringify.mock.calls.filter(([value]) => isTerminalFrame(value)).length
    stringify.mockRestore()

    // 600 lines do not fit one frame, so the escape-heavy content really is spread over
    // several of them.
    expect(harness.frames.length).toBeGreaterThan(1)
    const pushed = harness.infos.find((entry) => entry.message === "Mobile window pushed.")
    expect(pushed).toBeDefined()
    // The number the budget was charged, against the number it used to be charged:
    // `Buffer.byteLength(JSON.stringify(frame), "utf8")`, frame by frame.
    const asChargedBefore = harness.frames.reduce(
      (bytes, entry) => bytes + Buffer.byteLength(JSON.stringify(entry.frame), "utf8"),
      0,
    )
    expect(pushed?.meta?.bytes).toBe(asChargedBefore)
    // And the string that goes to the transport is byte-for-byte that measurement.
    for (const entry of harness.frames) {
      expect(entry.json).toBe(JSON.stringify(entry.frame))
    }
    // One serialization per frame. Counting them is the point of the change: the budget
    // and the envelope used to serialize the same frame independently.
    expect(frameSerializations).toBe(harness.frames.length)
  })

  it("charges and sends the same bytes for a frame that hits the line limit", async () => {
    /*
     * The other way a window splits: not by bytes but by the line-per-frame ceiling. The
     * first frame is exactly that long, and it is the one whose size the budget decision
     * is most likely to be wrong about, because the split happened on a count the byte
     * measurement knows nothing about.
     */
    const harness = createHarness({ sessionLines: 0, lineWindowLines: 600 })
    harness.terminal.lines.set(
      "sess-1",
      Array.from({ length: 600 }, (_, index) => ({ text: `x${index % 10}` })),
    )

    await attach(harness)

    // A snapshot goes out newest-chunk-first, so the frame at the ceiling is not the
    // first one on the wire — it is the one the split produced.
    const atLineLimit = harness.frames.find(
      (entry) => entry.frame.lines.length === MOBILE_FRAME_LIMITS.maxLinesPerFrame,
    )
    expect(atLineLimit).toBeDefined()
    const pushed = harness.infos.find((entry) => entry.message === "Mobile window pushed.")
    expect(pushed?.meta?.bytes).toBe(harness.frames.reduce(
      (bytes, entry) => bytes + Buffer.byteLength(JSON.stringify(entry.frame), "utf8"),
      0,
    ))
  })

  it("reads a session's window once for every phone watching it", async () => {
    /*
     * `readLineWindow` rebuilds up to 500 styled lines, which is by far the most
     * expensive thing a flush does — and it used to be done once per attachment, so two
     * phones on one terminal paid for the same window twice in the same 60 ms tick. Each
     * attachment still applies the window to its own tracker: what is shared is the read,
     * not the state.
     */
    const harness = createHarness({ sessionLines: 40 })
    const readLineWindow = vi.spyOn(harness.terminal, "readLineWindow")

    await attach(harness)
    await harness.gateway.handleIntent("phone-2", intent({
      v: 1,
      intentId: "i-attach-2",
      kind: "attach",
      sessionId: "sess-1",
    }))
    harness.frames.length = 0
    readLineWindow.mockClear()

    harness.terminal.lines.set("sess-1", [
      ...(harness.terminal.lines.get("sess-1") ?? []),
      { text: "line-40" },
    ])
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(60)

    expect(readLineWindow).toHaveBeenCalledTimes(1)
    // Both attachments got the update, from that one read.
    expect(harness.frames.map((entry) => entry.mobileClientInstanceId).sort())
      .toEqual(["phone-1", "phone-2"])
    expect(harness.frames[0]?.frame.lines.map((line) => line[0])).toEqual(["line-40"])
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

  it("sends a multi-line sentence as one paste, so no line runs before the user sees it", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-multi",
      kind: "command",
      sessionId: "sess-1",
      // 电脑上「快捷输入」的句子就是这个形状：第一行当标题，其余是正文。
      text: "synapse 静默发版\r\n第 1 步：先提交\r\n第 2 步：跑发版流程",
    }))

    // 原样写进 PTY，行规程会在第一个换行上把第一行执行掉 —— 那一行用户还没看过。
    expect(harness.terminal.calls).not.toContain("sendCommand")
    expect(harness.terminal.calls).toContain("pasteCommand")
    // 换行归一成 LF：句子里带的是编辑器写的 CRLF，而 PTY 收的是 LF。
    expect(harness.terminal.pasteCommands).toEqual([
      "synapse 静默发版\n第 1 步：先提交\n第 2 步：跑发版流程",
    ])
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
  })

  it("tells the phone why a multi-line sentence could not go in", async () => {
    const harness = createHarness()
    await attach(harness)
    vi.spyOn(harness.terminal, "pasteCommand")
      .mockRejectedValue(terminalContractError("paste_mode_unavailable", "capability"))

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-multi-refused",
      kind: "command",
      sessionId: "sess-1",
      text: "整理成提交说明\n中文，说清楚改了什么",
    }))

    // 终端服务给的代码要说成人话，而且说清用户该怎么办 —— 否则手机收到的只是一句
    // 「命令没有送到终端」，那既没说是为什么，也没说还能做什么。
    expect(harness.results.at(-1)).toMatchObject({
      result: {
        outcome: "rejected",
        code: "paste_mode_unavailable",
        message: "这个终端不接受多行内容，请改成一行发送。",
      },
    })
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

  describe("clipboard", () => {
    /** Lets the flush — which reads through an async source — run to completion. */
    async function settle(): Promise<void> {
      for (let index = 0; index < 5; index += 1) await Promise.resolve()
    }

    it("sends the entries on sync, then stays silent while nothing is copied", async () => {
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()

      expect(harness.clipboards).toHaveLength(1)
      expect(harness.clipboards[0]?.entries.map((entry) => entry.text))
        .toEqual(["pnpm mobile:install"])
      const afterSync = harness.clipboards.length

      // Summary ticks and terminal output are not reasons to re-send it.
      await harness.timers.advance(3_000)
      harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
      await harness.timers.advance(3_000)
      await settle()

      expect(harness.clipboards).toHaveLength(afterSync)
    })

    it("sends the entries to a second phone that has just connected", async () => {
      // `sync` is unconditional for the reason the two above it are, and this is the
      // family where it matters most: a phone that was away has a hole in its own
      // list, and this snapshot is the only thing that can fill it.
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const afterFirstPhone = harness.clipboards.length

      await harness.gateway.handleIntent("phone-2", intent({ v: 1, intentId: "i-sync-2", kind: "sync" }))
      await settle()

      expect(harness.clipboards.length).toBeGreaterThan(afterFirstPhone)
    })

    it("pushes a fresh copy as soon as the collector says the clipboard changed", async () => {
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const afterSync = harness.clipboards.length

      harness.clipboardEntries.unshift({
        id: "c2",
        text: "这次改动整理成提交说明",
        copiedAt: "2026-09-21T10:01:00.000Z",
      })
      // What the app-ready subscription does when the collector emits `changed`.
      await harness.gateway.flushClipboard()
      await settle()

      expect(harness.clipboards).toHaveLength(afterSync + 1)
      expect(harness.clipboards.at(-1)?.entries.map((entry) => entry.id)).toEqual(["c2", "c1"])
    })

    it("does not send the clipboard when a phone merely opens a terminal", async () => {
      // The one deliberate difference from the toolbar and the phrases, which both
      // ride on `attach`. The clipboard belongs to the computer rather than to any
      // terminal, so opening one is not a reason to be told about it again.
      const harness = createHarness()
      const before = harness.clipboards.length

      await attach(harness)
      await settle()

      expect(harness.clipboards).toHaveLength(before)
    })

    it("drops the oldest tail rather than shortening any entry", async () => {
      const harness = createHarness()
      harness.clipboardEntries.length = 0
      const total = MOBILE_FRAME_LIMITS.maxClipboardEntries + 5
      for (let index = 0; index < total; index += 1) {
        // Newest first, which is how the collector hands them over.
        harness.clipboardEntries.unshift({
          id: `c${index}`,
          text: `entry-${index}`,
          copiedAt: "2026-09-21T10:00:00.000Z",
        })
      }

      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()

      const sent = harness.clipboards.at(-1)?.entries ?? []
      expect(sent).toHaveLength(MOBILE_FRAME_LIMITS.maxClipboardEntries)
      expect(sent[0]?.id).toBe(`c${total - 1}`)
      // Every entry that made it arrives whole — a phone is about to paste this text.
      for (const entry of sent) expect(entry.text).toBe(`entry-${entry.id.slice(1)}`)
    })

    it("says so when an entry is past the wire limit instead of sending it", async () => {
      // Unreachable through the collector, which drops over-long text by the same
      // constant. The check is here so that the two constants coming apart surfaces
      // as a warning rather than as a payload the phone silently refuses.
      const harness = createHarness()
      harness.clipboardEntries.unshift({
        id: "c-huge",
        text: "s".repeat(MOBILE_FRAME_LIMITS.maxClipboardTextLength + 1),
        copiedAt: "2026-09-21T10:02:00.000Z",
      })

      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()

      const sent = harness.clipboards.at(-1)?.entries ?? []
      expect(sent.map((entry) => entry.id)).toEqual(["c1"])
      expect(harness.warns.map((entry) => entry.message))
        .toContain("Mobile clipboard entry dropped for exceeding the wire limit.")
    })

    it("keeps the clipboard's fingerprint separate from the other three", async () => {
      const harness = createHarness()
      await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
      await settle()
      const clipboardsAfterSync = harness.clipboards.length

      await harness.timers.advance(1_000)
      await settle()

      expect(harness.summaries.length).toBeGreaterThan(0)
      expect(harness.clipboards).toHaveLength(clipboardsAfterSync)
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
    // The snapshot lands newest-first: the frame carrying `reset` is the newest
    // chunk, and the older ones follow above it, so the recovery is read at the
    // line the session actually ended on rather than the top of the window.
    const newest = recovered.find((frame) => frame.lines.length > 0)
    expect(newest?.kind).toBe("reset")
    expect(newest?.lines.at(-1)?.[0]).toContain("line-99")
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

  /*
   * The row's third line is what answers "what is this terminal doing right now"
   * without the reader opening it — which is the whole point of the phone, since the
   * common visit ends on this list. A full-screen program spends its last rows on a
   * box: Claude Code's input prompt is a border, a blank, and another border. Reading
   * only the tail and stopping there drew a blank row on a terminal that had text a
   * few rows further up, and on the phone that is indistinguishable from a terminal
   * that has gone quiet.
   */
  it("carries a line from above a tail that is nothing but a box", async () => {
    const harness = createHarness()
    harness.terminal.lines.set("sess-1", [
      ...Array.from({ length: 9 }, (_, index) => ({ text: `output-${index}` })),
      { text: "npm run dev" },
      ...Array.from({ length: 30 }, () => ({ text: "╰──────────────────────────╯" })),
    ])

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions[0].lastLine).toBe("npm run dev")
  })

  it("reports an empty line only when the whole screen is furniture", async () => {
    const harness = createHarness()
    harness.terminal.lines.set("sess-1", [
      ...Array.from({ length: 20 }, () => ({ text: "────────────────────────────" })),
      { text: "   " },
    ])

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions[0].lastLine).toBe("")
  })

  it("stops walking once the line it would find is history rather than now", async () => {
    // The bound is a design decision rather than a performance accident: a line far
    // enough up the scrollback is not what the terminal is doing now, and the row
    // claims to say exactly that. It is also what keeps a screen of nothing but rules
    // from walking the whole 5,000-line scrollback on every summary tick.
    const harness = createHarness()
    harness.terminal.lines.set("sess-1", [
      { text: "a line from long ago" },
      ...Array.from({ length: 279 }, () => ({ text: "────────────────────────" })),
    ])

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions[0].lastLine).toBe("")
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

    // A rename is a change to the directory, so it does go out — a phone that kept
    // showing the old name would be showing a project that no longer exists. It goes
    // out on the first tick after the directory's cache window closes, which is the
    // bound on how stale a project name can be while a phone is already connected.
    harness.agentGroups[1] = { ...harness.agentGroups[1]!, name: "Synapse 重命名" }
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-1" })
    await harness.timers.advance(1_000)
    // Still inside the window: the directory above has not been looked at again, so the
    // payload is byte-identical and there is nothing to send.
    expect(harness.summaries.length).toBe(afterFirst)

    await harness.timers.advance(MOBILE_AGENT_DIRECTORY_CACHE_MS)
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-1" })
    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(afterFirst)
    expect((harness.summaries.at(-1) as MobileSummaryDraft).agentGroups?.[1]?.name).toBe("Synapse 重命名")
  })

  it("reads the project and Provider directories once per window, not once per tick", async () => {
    /*
     * Both come out of the stored configuration, and reading them costs a sanitize and
     * clone of the whole config plus a project listing — the expensive part of a tick
     * that otherwise just walks a list of sessions. The tick runs at 1 Hz for as long as
     * any terminal is printing, whether or not a phone is connected, so this is the
     * difference between a permanent background cost and one paid every fifteen seconds.
     */
    const harness = createHarness()
    // Five ticks, all comfortably inside one window (the harness's clock starts at zero
    // and the window is fifteen seconds), so one read has to answer all five. Each tick
    // is scheduled by a chunk of terminal output, which is what keeps this pipeline
    // running at 1 Hz on a desktop that is merely printing — the case the caching is for.
    for (let tick = 0; tick < 5; tick += 1) {
      harness.terminal.events.emit("stateChanged", { sessionId: "sess-1", changeTypes: [] })
      await harness.timers.advance(1_000)
    }

    expect(harness.listAgentConversationGroups).toHaveBeenCalledTimes(1)
    expect(harness.listAgentConversationProviders).toHaveBeenCalledTimes(1)
    // And the list is unchanged by the caching: the directories are still in the payload
    // the phone receives.
    expect((harness.summaries.at(-1) as MobileSummaryDraft).agentGroups).toHaveLength(2)
  })

  it("re-reads the directories straight away for a phone that has just connected", async () => {
    /*
     * The window above is a bound on how stale a directory can be on a phone, and this
     * is the case that keeps the bound invisible: a `sync` comes from a phone that has
     * just connected and is about to draw the list, which is exactly when a rename made
     * while the desktop was idle would otherwise show up with the old name.
     */
    const harness = createHarness()
    await harness.timers.advance(1_000)
    const readsBefore = harness.listAgentConversationGroups.mock.calls.length

    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    await harness.timers.advance(1_000)

    expect(harness.listAgentConversationGroups.mock.calls.length).toBeGreaterThan(readsBefore)
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

/* ------------------------------------------------------------------ *
 * Git
 * ------------------------------------------------------------------ */

/**
 * 一次摘要把这一族的两件事都带上了：算一份算得起的 Git 状态，以及把用户刚做的
 * Git 动作重算一遍。两件事都必须**搭在既有的 tick 上** —— 网关的监听器预算已经满了。
 */
describe("MobileGatewayService · Git 状态", () => {
  it("does not run git at all until a phone is watching a terminal", async () => {
    const harness = createHarness()

    await harness.timers.advance(5_000)

    // 没有 attach 就没有「你正开着的那个终端」，也就没有可回答的东西。摘要在有输出时
    // 是 1 Hz，这里的每一条命令都会变成每秒一次的代价。
    expect(harness.terminalGit.calls).toEqual([])
    expect(harness.gitStatuses).toEqual([])
  })

  it("computes once and sends once, then goes quiet while the directory stays put", async () => {
    const harness = createHarness()
    await attach(harness)

    /*
     * 有终端在打字，摘要就是 1 Hz —— 这里把那个心跳造出来：终端每输出一个 chunk 都会
     * emit `stateChanged`，网关转手就 `scheduleSummary()`（`data` 那一条只安排帧的
     * flush，摘要不看它）。四次 tick 之后要的仍然只有一份状态。
     *
     * 反证：把 `flushAttachmentGitStatus` 里那句目录比对删掉，下面的 1 会变成 4
     * ——「一个字节都不发」这条断言的全部意义就在这里。
     */
    for (let tick = 0; tick < 4; tick += 1) {
      harness.terminal.events.emit("stateChanged", { sessionId: "sess-1", changeTypes: ["output"] })
      await harness.timers.advance(1_000)
    }
    expect(harness.gitStatuses).toHaveLength(1)
    expect(harness.gitStatuses[0]).toMatchObject({
      mobileClientInstanceId: "phone-1",
      sessionId: "sess-1",
      revision: 1,
      status: {
        cwd: "/Users/liy/code",
        branch: "main",
        upstream: "origin/main",
        changeCount: 0,
        hasConflicts: false,
      },
    })
    expect(harness.terminalGit.calls.filter((call) => call.method === "getSnapshot")).toHaveLength(1)
  })

  it("follows the terminal into another directory, with a new revision", async () => {
    const harness = createHarness()
    await attach(harness)
    await harness.timers.advance(5_000)

    // 用户在终端里 cd 走了。
    harness.terminal.reportedCwd.set("sess-1", "/Users/liy/code/other")
    harness.terminalGit.byCwd.set("/Users/liy/code/other", { branch: "release", changeCount: 3 })
    harness.terminal.events.emit("stateChanged", { sessionId: "sess-1", changeTypes: ["output"] })
    await harness.timers.advance(5_000)

    expect(harness.gitStatuses).toHaveLength(2)
    expect(harness.gitStatuses[1]).toMatchObject({
      revision: 2,
      status: { cwd: "/Users/liy/code/other", branch: "release", changeCount: 3 },
    })
  })

  it("says 「不是仓库」 as null rather than staying silent", async () => {
    const harness = createHarness()
    harness.terminalGit.byCwd.set("/Users/liy/code", { isRepository: false })
    await attach(harness)

    await harness.timers.advance(5_000)

    // 手机端要靠这个 `null` 把「这里不是仓库」（第二行退回版本号）与「还没收到回答」
    // （保持现状不动）分开 —— 两者在屏幕上长得一样但含义完全不同。
    expect(harness.gitStatuses).toHaveLength(1)
    expect(harness.gitStatuses[0]?.status).toBeNull()
  })

  it("re-sends on attach and on sync even when nothing about the directory changed", async () => {
    const harness = createHarness()
    await attach(harness)
    await harness.timers.advance(5_000)
    expect(harness.gitStatuses).toHaveLength(1)

    // attach 与 sync 都是「刚到的手机什么都没收到」，指纹只对收到过的一方有意义。
    await attach(harness, { intentId: "i-attach-2" })
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    await harness.timers.advance(5_000)

    expect(harness.gitStatuses).toHaveLength(3)
    expect(harness.gitStatuses.map((status) => status.revision)).toEqual([1, 2, 3])
  })

  it("carries the live directory in the session list rather than the one it started in", async () => {
    const harness = createHarness()
    harness.terminal.reportedCwd.set("sess-1", "/Users/liy/code/deep")
    await attach(harness)

    await harness.timers.advance(5_000)

    const summary = harness.summaries.at(-1) as { sessions: readonly { cwd: string }[] }
    expect(summary.sessions[0]?.cwd).toBe("/Users/liy/code/deep")
  })
})

describe("MobileGatewayService · Git 意图", () => {
  /** 一个已经 attach 过的手机，落在 /Users/liy/code 上。 */
  async function attached(): Promise<ReturnType<typeof createHarness>> {
    const harness = createHarness()
    await attach(harness)
    harness.terminalGit.calls.length = 0
    harness.gitStatuses.length = 0
    return harness
  }

  function gitIntent(overrides: Record<string, unknown> = {}): MobileIntent {
    return intent({
      v: 1,
      intentId: `i-git-${String(overrides.action)}`,
      kind: "git",
      sessionId: "sess-1",
      action: "status",
      ...overrides,
    } as MobileIntent)
  }

  function lastResult(harness: ReturnType<typeof createHarness>): Record<string, unknown> {
    return (harness.results.at(-1) as { result: Record<string, unknown> }).result
  }

  it("routes each of the eleven actions to its own method, with the arguments it was given", async () => {
    const harness = await attached()
    const cases: readonly { readonly intent: Record<string, unknown>; readonly method: string; readonly input: Record<string, unknown> }[] = [
      { intent: { action: "branches" }, method: "listBranches", input: { cwd: "/Users/liy/code" } },
      { intent: { action: "checkout", branch: "release" }, method: "checkout", input: { cwd: "/Users/liy/code", branch: "release" } },
      {
        intent: { action: "checkout", branch: "release", discardChanges: true },
        method: "checkout",
        input: { cwd: "/Users/liy/code", branch: "release", discardChanges: true },
      },
      {
        intent: { action: "createBranch", branch: "feature", fromBranch: "main" },
        method: "createBranch",
        input: { cwd: "/Users/liy/code", branch: "feature", fromBranch: "main" },
      },
      { intent: { action: "commit", message: "改一行" }, method: "commit", input: { cwd: "/Users/liy/code", message: "改一行" } },
      { intent: { action: "push" }, method: "push", input: { cwd: "/Users/liy/code" } },
      { intent: { action: "sync" }, method: "sync", input: { cwd: "/Users/liy/code" } },
      {
        intent: { action: "merge", branch: "release", direction: "outOfCurrent" },
        method: "merge",
        input: { cwd: "/Users/liy/code", branch: "release", direction: "outOfCurrent" },
      },
      { intent: { action: "remoteBranches" }, method: "listRemoteBranches", input: { cwd: "/Users/liy/code" } },
      { intent: { action: "fetchRemotes" }, method: "fetchRemotes", input: { cwd: "/Users/liy/code" } },
      {
        intent: { action: "checkoutRemote", remote: "origin", branch: "release" },
        method: "checkoutRemote",
        input: { cwd: "/Users/liy/code", remote: "origin", branch: "release" },
      },
      {
        intent: { action: "checkoutRemote", remote: "origin", branch: "release", localBranch: "mine" },
        method: "checkoutRemote",
        input: { cwd: "/Users/liy/code", remote: "origin", branch: "release", localBranch: "mine" },
      },
      {
        intent: { action: "checkoutRemote", remote: "origin", branch: "release", discardChanges: true },
        method: "checkoutRemote",
        input: { cwd: "/Users/liy/code", remote: "origin", branch: "release", discardChanges: true },
      },
    ]

    for (const [index, testCase] of cases.entries()) {
      harness.terminalGit.calls.length = 0
      await harness.gateway.handleIntent("phone-1", gitIntent({ ...testCase.intent, intentId: `i-git-${String(index)}` }))

      // 动过仓库的动作随后会重算一次状态，那一次读的是 `getSnapshot` —— 它不属于
      // 这个动作的路由，而且是不等待的，落在这里与否取决于调度。剔掉它再比。
      expect(
        harness.terminalGit.calls.filter((call) => call.method !== "getSnapshot"),
        String(testCase.intent.action),
      ).toEqual([
        // 每个动作之前都先问一句「是不是仓库」（`status` 之外），不是仓库就一行都不跑。
        { method: "isRepository", input: { cwd: "/Users/liy/code" } },
        { method: testCase.method, input: testCase.input },
      ])
    }
  })

  it("answers a commit-then-push as two steps, and still calls it a success when only the push failed", async () => {
    const harness = await attached()
    const first = gitIntent({ action: "commit", message: "只改一行", pushAfterCommit: true, intentId: "i-git-cp" })
    await harness.gateway.handleIntent("phone-1", first)
    expect(harness.terminalGit.calls.map((call) => call.method)).toContain("commit")
    expect(harness.terminalGit.calls.map((call) => call.method)).toContain("push")
    expect(lastResult(harness)).toMatchObject({ outcome: "accepted" })

    // 现在让 push 失败：提交已经进了历史，报成失败会让用户再提交一次，而那次只会
    // 得到「没有改动可提交」。
    harness.terminalGit.failure = { message: "远端有你还不知道的提交。", only: ["push"] }
    await harness.gateway.handleIntent("phone-1", gitIntent({
      action: "commit", message: "又改一行", pushAfterCommit: true, intentId: "i-git-cp-2",
    }))
    harness.terminalGit.failure = null

    expect(lastResult(harness)).toMatchObject({
      outcome: "accepted",
      message: "提交已完成，但推送没有成功：远端有你还不知道的提交。",
    })
  })

  it("hands back the branches, and only the branches", async () => {
    const harness = await attached()

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "branches", intentId: "i-git-branches" }))

    expect(lastResult(harness)).toMatchObject({
      outcome: "accepted",
      git: { branches: [{ name: "main", current: true }, { name: "release", current: false }] },
    })
  })

  it("asks the user to decide instead of reporting a failure when the tree is dirty", async () => {
    const harness = await attached()
    harness.terminalGit.failure = { message: "当前目录里有未提交的改动。", needsDecision: "dirty" }

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "checkout", branch: "release", intentId: "i-dirty" }))

    // 手机靠 `git.needsDecision` 把「弹一个选择」与「报一条错误」分开，所以它必须带着
    // 一个能分辨的 code 回来，而不是只有一句话。
    expect(lastResult(harness)).toMatchObject({
      outcome: "rejected",
      code: "dirty_working_tree",
      message: "当前目录里有未提交的改动。",
      git: { needsDecision: "dirty" },
    })
  })

  it("hands the conflict text back whole, for the phone to copy", async () => {
    const harness = await attached()
    harness.terminalGit.failure = {
      message: "检测到冲突，已自动取消合并并回退。",
      conflict: {
        source: "feature",
        target: "main",
        files: ["a.txt"],
        summaryText: "【Synapse · Git 合并冲突】\n请帮我解决这些冲突。\n",
      },
    }

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "merge", branch: "feature", intentId: "i-conflict" }))

    // 这段文本由电脑拼好、手机只负责复制 —— 它一个字都不能被改写或截断。
    expect(lastResult(harness)).toMatchObject({
      outcome: "rejected",
      code: "merge_conflict",
      git: {
        conflict: {
          source: "feature",
          target: "main",
          files: ["a.txt"],
          summaryText: "【Synapse · Git 合并冲突】\n请帮我解决这些冲突。\n",
        },
      },
    })
  })

  it("refuses an action with the argument it needs missing, without running a git command", async () => {
    const harness = await attached()

    for (const missing of [
      { action: "checkout", intentId: "i-no-branch" },
      { action: "createBranch", intentId: "i-no-new-branch" },
      { action: "merge", intentId: "i-no-merge-branch" },
      { action: "commit", intentId: "i-no-message" },
      // 迁出要的是两个名字：少了远端、或者少了分支，都走不下去。
      { action: "checkoutRemote", branch: "release", intentId: "i-no-remote" },
      { action: "checkoutRemote", remote: "origin", intentId: "i-no-remote-branch" },
    ]) {
      harness.terminalGit.calls.length = 0
      await harness.gateway.handleIntent("phone-1", gitIntent(missing))

      expect(lastResult(harness), missing.action).toMatchObject({ outcome: "rejected", code: "invalid_argument" })
      expect(harness.terminalGit.calls, missing.action).toEqual([])
    }
  })

  it("answers 「不是仓库」 for every action but the one that answers from the pushed status", async () => {
    const harness = await attached()
    harness.terminalGit.byCwd.set("/Users/liy/code", { isRepository: false })
    // `isRepository` 由假服务直接答，这里要的是「它答不是」。
    harness.terminalGit.isRepository = async (cwd: string) => {
      harness.terminalGit.calls.push({ method: "isRepository", input: { cwd } })
      return false
    }

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "branches", intentId: "i-not-repo" }))
    expect(lastResult(harness)).toMatchObject({
      outcome: "rejected",
      code: "not_a_repository",
      message: "这个目录不是 Git 仓库。",
    })

    // `status` 自己一条 git 都不跑：它要的是「重算一次并推给我」，「不是仓库」由那份
    // 状态自己说（`null`），第二行据此退回版本号 —— 所以它不该报错。
    harness.gitStatuses.length = 0
    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "status", intentId: "i-status-not-repo" }))
    expect(lastResult(harness)).toMatchObject({ outcome: "accepted" })
    await harness.timers.advance(5_000)
    expect(harness.gitStatuses.at(-1)?.status).toBeNull()
  })

  it("reads the directory with the awaitable probe, not the cached synchronous one", async () => {
    const harness = await attached()
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "push", intentId: "i-probe" }))

    // 有人问的时刻要的是「这一次」的答案，不是上一次缓存下来的那个 —— 手机打开面板
    // 时算错的目录，等于在错的仓库上干活。
    expect(harness.terminal.calls).toContain("probeCurrentWorkingDirectory")
  })

  it("recomputes the pushed status after an action that could have changed the repository", async () => {
    const harness = await attached()
    await harness.timers.advance(5_000)
    expect(harness.gitStatuses).toHaveLength(1)

    harness.terminalGit.byCwd.set("/Users/liy/code", { changeCount: 4 })
    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "commit", message: "改一行", intentId: "i-after" }))
    await harness.timers.advance(5_000)

    // 目录没变，光靠那道闸门是等不到的：动过仓库的动作必须自己要求重算一次。
    expect(harness.gitStatuses).toHaveLength(2)
    expect(harness.gitStatuses[1]).toMatchObject({ status: { changeCount: 4 } })
  })

  it("hands back the remote branches, and only them", async () => {
    const harness = await attached()

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "remoteBranches", intentId: "i-remote" }))

    expect(lastResult(harness)).toMatchObject({
      outcome: "accepted",
      git: { remoteBranches: [{ remote: "origin", name: "main" }, { remote: "origin", name: "release" }] },
    })
  })

  it("cuts the remote branch list at the ceiling and says so", async () => {
    const harness = await attached()
    harness.terminalGit.remoteBranches = Array.from(
      { length: MOBILE_FRAME_LIMITS.maxGitBranches + 1 },
      (_, index) => ({ remote: "origin", name: `b${index}` }),
    )

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "remoteBranches", intentId: "i-remote-cut" }))

    /*
     * 截断必须发生在**这里**：协议层的校验器用 `boundedArray(..., maxGitBranches)`，
     * 超了整条结果被判非法、结果被丢掉，手机上表现为「电脑一直没有回答」——
     * 比少列一条糟得多。截了还要说一句，不说的截断等于骗人。
     */
    const result = lastResult(harness) as { git: { remoteBranches: readonly unknown[] }; message?: string }
    expect(result.git.remoteBranches).toHaveLength(MOBILE_FRAME_LIMITS.maxGitBranches)
    expect(result.message).toBe(`远端分支过多，只列出了前 ${MOBILE_FRAME_LIMITS.maxGitBranches} 条。`)
  })

  it("asks for another local name as a decision, not as an error", async () => {
    const harness = await attached()
    harness.terminalGit.failure = {
      message: "本地已有 release，它跟踪的是 origin/other。",
      needsDecision: "localBranchName",
    }

    await harness.gateway.handleIntent("phone-1", gitIntent({
      action: "checkoutRemote", remote: "origin", branch: "release", intentId: "i-name",
    }))

    // 手机靠 `git.needsDecision` 分「推一页填名字」与「弹三选一」，所以它必须**原样透传**，
    // 不能像以前那样写死 `"dirty"` —— 写死了用户看到的是一句错，而他没有出路。
    expect(lastResult(harness)).toMatchObject({
      outcome: "rejected",
      code: "local_branch_conflict",
      message: "本地已有 release，它跟踪的是 origin/other。",
      git: { needsDecision: "localBranchName" },
    })
  })

  it("authorizes a write as its own action and a read as the terminal read it is", async () => {
    const harness = await attached()

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "branches", intentId: "i-read" }))
    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "checkout", branch: "release", intentId: "i-write" }))

    // 读走的还是只读终端那一档；写另有一个名字 —— 「手机让电脑改动了用户的仓库」
    // 是这一轮新出现的一件事，借别的名字记，事后查审计的人会被误导。
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.state.read",
      outcome: "allowed",
    }))
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.git.manage",
      outcome: "allowed",
    }))
  })

  it("marks listing remote branches as a read and fetching them as a write", async () => {
    const harness = await attached()

    // 读缓存的 `refs/remotes` 不碰网络、不动仓库，所以它走只读那一档；获取与迁出都动仓库。
    // 三个动作分成三个名字，事后查审计的人看到的才是当时真发生的那件事。
    harness.audits.length = 0
    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "remoteBranches", intentId: "i-rm-read" }))
    expect(harness.audits.at(-1)).toMatchObject({ action: "terminal.state.read", outcome: "allowed" })

    harness.audits.length = 0
    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "fetchRemotes", intentId: "i-rm-fetch" }))
    expect(harness.audits.at(-1)).toMatchObject({ action: "terminal.git.manage", outcome: "allowed" })

    harness.audits.length = 0
    await harness.gateway.handleIntent("phone-1", gitIntent({
      action: "checkoutRemote", remote: "origin", branch: "release", intentId: "i-rm-write",
    }))
    expect(harness.audits.at(-1)).toMatchObject({ action: "terminal.git.manage", outcome: "allowed" })
  })

  it("refuses a write the policy denies, and records it as denied", async () => {
    const harness = await attached()
    harness.permissionGuard.check = vi.fn(async () => ({ allowed: false, reason: "denied" })) as never

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "push", intentId: "i-denied" }))

    expect(lastResult(harness)).toMatchObject({ outcome: "rejected", code: "permission_denied" })
    expect(harness.terminalGit.calls.filter((call) => call.method === "push")).toEqual([])
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.git.manage",
      outcome: "denied",
    }))
  })

  it("says the terminal is gone rather than guessing a directory for it", async () => {
    const harness = await attached()
    harness.terminal.sessions.delete("sess-1")

    await harness.gateway.handleIntent("phone-1", gitIntent({ action: "status", intentId: "i-gone" }))

    expect(lastResult(harness)).toMatchObject({ outcome: "rejected", code: "session_not_found" })
  })
})

/**
 * 终端的事件发射器是这一族里最稀缺的资源，这一节把它当成一道闸而不是一句注释。
 *
 * Node 默认每个事件最多 10 个监听器。网关占了 4 个，终端 IPC 层占了 6 个 ——
 * 4 + 6 正好用满。所以「再想想有没有别的办法」不是风格建议，是一个会崩的边界：
 * 第 11 个监听器会让 Node 打一条警告，然后在某个版本里直接变成一个错误。
 */
describe("MobileGatewayService · 监听器预算", () => {
  /** 网关自己订阅的那四个，写在这里是为了让「4」这个数字有出处。 */
  const GATEWAY_EVENTS = ["data", "stateChanged", "sessionChanged", "sessionDeleted"] as const

  /**
   * 全仓不许出现 `setMaxListeners`。
   *
   * 这是这条预算成不成立的另一半：只要有哪怕一处把它调大，「总数 10」就不再是
   * 上限，而下面那条断言只是在数一个还能再涨的数字。所以扫一遍比断言一个数字更
   * 接近这条约束本身。
   *
   * 找的是**调用**（`setMaxListeners(`）而不是这四个字：这一段的注释、以及
   * `mobile-gateway-service.ts` 里劝人别用它的话，都只是提到了这个名字。
   */
  function filesCallingSetMaxListeners(root: string): readonly string[] {
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "dist-electron") continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.name.endsWith(".ts")) continue
        if (/setMaxListeners\s*\(/.test(readFileSync(full, "utf8"))) hits.push(full)
      }
    }
    walk(root)
    return hits
  }

  it("keeps the terminal event emitter inside Node's default listener budget", async () => {
    const harness = createHarness()
    // 先让摘要真的跑过一轮：`flushSummary` 是这个网关上唯一「可能顺手加一个监听器」的
    // 地方，在它跑之前数是数不到那个人的。
    await attach(harness)
    harness.terminal.events.emit("stateChanged", { sessionId: "sess-1", changeTypes: ["output"] })
    await harness.timers.advance(1_000)

    // 数的是发射器上**全部**的监听器，不是那四个名字上的：预算按个算，挂在哪个
    // 事件上无关紧要 —— 这也正是「再订一次 workingDirectoryChanged」不行的原因。
    const gatewayListeners = harness.terminal.events.eventNames()
      .reduce((total, event) => total + harness.terminal.events.listenerCount(event), 0)
    // 终端 IPC 层在另一个目录、另一个生命周期里订阅，这个套件起不到它，所以数它的源码。
    // 数不到（文件改名、写法变了）这条断言自己会红 —— 那正是它该红的时候。
    const ipcSource = readFileSync(
      path.resolve(import.meta.dirname, "../../../app-capabilities/terminal/main/ipc.ts"),
      "utf8",
    )
    const ipcListeners = ipcSource.split("service.events.on(").length - 1

    expect(gatewayListeners).toBe(4)
    // 而且就是那四个。多订一个别的事件（比如 `workingDirectoryChanged`）同样让上一行
    // 变红，但这一行说的是它必须正好是那四个。
    expect([...harness.terminal.events.eventNames()].sort())
      .toEqual([...GATEWAY_EVENTS].sort())
    expect(ipcListeners).toBe(6)
    expect(
      gatewayListeners + ipcListeners,
      "网关 4 个 + 终端 IPC 层 6 个 = Node 默认上限。要让它变大，先去解决预算，"
      + "不要调 setMaxListeners、也不要把这条断言删掉。",
    ).toBe(10)

    const services = path.resolve(import.meta.dirname, "../..")
    expect(filesCallingSetMaxListeners(services)).toEqual([])
    expect(filesCallingSetMaxListeners(
      path.resolve(import.meta.dirname, "../../../app-capabilities"),
    )).toEqual([])
  })

  it("rides the summary tick instead of subscribing for the directory changes it follows", () => {
    const harness = createHarness()

    // `workingDirectoryChanged` 确实存在、也确实是我们想要的那个事件 —— 但它已经被
    // 终端 IPC 层订阅了，再订一次就是第 11 个，跟是不是同一个事件无关。所以这一族
    // 的目录跟随是搭在既有的摘要 tick 上的。
    expect(harness.terminal.events.listenerCount("workingDirectoryChanged")).toBe(0)

    harness.terminal.reportedCwd.set("sess-1", "/tmp/elsewhere")
    void attach(harness)
    harness.terminal.events.emit("workingDirectoryChanged", { sessionId: "sess-1" })

    expect(harness.terminal.events.listenerCount("workingDirectoryChanged")).toBe(0)
  })
})
