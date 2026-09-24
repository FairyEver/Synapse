import { randomUUID, timingSafeEqual } from "node:crypto"
import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type {
  LocalHttpRequest,
  LocalHttpResponse,
  NetworkServiceRegistry,
  ResolvedNetworkBinding,
} from "../../../electron/runtime/network"
import { createLocalNetworkHostLifecycle } from "../../../electron/runtime/network"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import { terminalContractError } from "../shared/errors"
import type { TerminalAgentAttentionUpdate } from "../shared/contract-schema"
import type {
  TerminalAgentNotificationSettings,
  TerminalUpdateAgentNotificationSettingsInput,
} from "../shared/schema"
import {
  CLAUDE_AGENT_HOOK_EVENTS,
  CLAUDE_AGENT_MANAGED_MARKER,
  claudeHookCommand,
  createTerminalAgentUnixShim,
  createTerminalAgentWindowsShim,
  TERMINAL_AGENT_HOOK_RUNTIME,
  TERMINAL_AGENT_WRAPPER_RUNTIME,
} from "./agent-notification-runtime"
import {
  applyTerminalAgentUpdate,
  createTerminalAgentSession,
  isTerminalAgentSessionUnstarted,
  nextTerminalAgentVersion,
  reduceTerminalAgentEvent,
  terminalAgentProcessExitUpdate,
  terminalAgentStalledUpdate,
  terminalAgentStateView,
  type TerminalAgentEvent,
  type TerminalAgentStateView,
  type TerminalAgentSession,
  type TerminalAgentUpdate,
} from "./agent-session"

export const TERMINAL_AGENT_NOTIFICATION_SERVICE_ID = "core.terminal-agent-notifications"
const NETWORK_SERVICE_ID = "terminal.agent-notifications"
const EVENT_PATH = "/terminal-agent-event"
const MAX_BODY_BYTES = 16 * 1024
const RATE_LIMIT_PER_MINUTE = 120
const DEDUPLICATION_WINDOW_MS = 2_000
/** How often the archive checks whether the process it is watching still exists. */
const AGENT_SESSION_SWEEP_MS = 30_000
/** A `working` this long with a transcript that stopped growing is not working. */
const AGENT_TRANSCRIPT_STALE_MS = 10 * 60_000

type AgentProvider = "claude"
type AgentNotificationKind = "needs_action" | "completed"
/**
 * 同一个 kind 下需要不同说法的细分。
 *
 * `idle_prompt` 不是「它在问你」，而是「它跑完了、一直没等到你」——和一分钟前那条「任务已完成」
 * 共用一句会让用户以为同一条通知弹了两次，所以它有自己的文案。
 */
type AgentNotificationVariant = "idle"

type SessionBinding = {
  readonly sessionId: string
  readonly token: string
  title: string
  waiting: boolean
  backgroundWorkPending: boolean
  stopStatusUnknown: boolean
}

export type TerminalAgentLaunchIntegration = {
  readonly env: Record<string, string>
  readonly shellArgs?: readonly string[]
}

export type TerminalAgentNotificationHandle = {
  show(): void
  on(event: "click" | "close", listener: () => void): void
}

export type TerminalAgentNotificationServiceDeps = {
  readonly settings: DataNamespace<TerminalAgentNotificationSettings>
  /** 结构化元数据落这里；原始输出与检查点不走这条路（见 `encrypted-block-store`）。 */
  readonly agentSessions: DataNamespace<TerminalAgentSession>
  readonly networkRegistry: NetworkServiceRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger: Pick<StructuredLogger, "warn" | "info">
  readonly runtimeDir: string
  readonly nodePath: string
  readonly platform?: NodeJS.Platform
  readonly createNotification: (input: {
    readonly title: string
    readonly body: string
  }) => TerminalAgentNotificationHandle | null
  readonly focusedWebContentsId: () => number | null
  readonly focusApp: () => void
  readonly openTerminalSession: (sessionId: string) => Promise<void>
  readonly syncCompletion?: (input: { sessionId: string; title: string; body: string; sourceKey: string }) => Promise<void>
  readonly setSessionAttention?: (update: TerminalAgentAttentionUpdate) => void
  readonly now?: () => number
  /** Injectable so the liveness sweep can be decided without real processes. */
  readonly isProcessAlive?: (pid: number) => boolean
  readonly readTranscriptMtimeMs?: (path: string) => Promise<number | null>
  readonly sweepIntervalMs?: number
}

export class TerminalAgentNotificationService {
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly isProcessAlive: (pid: number) => boolean
  private readonly readTranscriptMtimeMs: (path: string) => Promise<number | null>
  /** 权威副本。查询读它，写入经 {@link commitAgentSessionUpdate} 之后才追上磁盘。 */
  private readonly agentSessions = new Map<string, TerminalAgentSession>()
  private readonly sessionsByToken = new Map<string, SessionBinding>()
  private readonly sessionTokens = new Map<string, string>()
  private readonly activeSessionByWebContents = new Map<number, string | null>()
  private readonly requestTimesByToken = new Map<string, number[]>()
  private readonly lastNotificationAt = new Map<string, number>()
  private readonly liveNotifications = new Set<TerminalAgentNotificationHandle>()
  private settingsQueue: Promise<void> = Promise.resolve()
  private stateQueue: Promise<void> = Promise.resolve()
  private settings: TerminalAgentNotificationSettings = defaultSettings()
  private binding?: ResolvedNetworkBinding
  private runtime?: RuntimePaths
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: TerminalAgentNotificationServiceDeps) {
    this.platform = deps.platform ?? process.platform
    this.now = deps.now ?? (() => Date.now())
    this.isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive
    this.readTranscriptMtimeMs = deps.readTranscriptMtimeMs ?? defaultReadTranscriptMtimeMs
  }

  async start(): Promise<void> {
    this.settings = await this.deps.settings.getSingleton() ?? defaultSettings()
    await this.hydrateAgentSessions()
    // shell 集成不再由 Agent 原生通知的开关门控：先无条件把 runtime 文件准备好，
    // 否则关掉通知的终端连 OSC 7 上报都没有，`getCurrentWorkingDirectory` 会一直
    // 停在会话创建时的目录。
    try {
      await this.ensureRuntime()
    } catch (error) {
      this.deps.logger.warn("Terminal shell integration could not be prepared.", { error })
    }
    if (this.settings.enabled) {
      try {
        await this.enableRuntime()
      } catch (error) {
        this.deps.logger.warn("Terminal agent notifications could not start.", { error })
      }
    }
    this.startSweep()
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    await this.stopIngress()
    this.sessionsByToken.clear()
    this.sessionTokens.clear()
    this.activeSessionByWebContents.clear()
    this.liveNotifications.clear()
    this.agentSessions.clear()
  }

  /* ---------------------------------------------------------------- *
   * Agent 会话档案
   * ---------------------------------------------------------------- */

  /** 权威答案。推送只是提示，这里才是事实。 */
  getAgentSession(sessionId: string): TerminalAgentSession | null {
    return this.agentSessions.get(sessionId) ?? null
  }

  /**
   * 所有真的跑过 agent 的会话档案。
   *
   * 停在 `launching` 的不在其中：那是「这个终端开过、但没有任何 agent 进来过」，
   * 它只在内存里活着，不该被当成一条 agent 记录读出去。
   */
  listAgentSessions(): TerminalAgentSession[] {
    return [...this.agentSessions.values()].filter((session) => !isTerminalAgentSessionUnstarted(session))
  }

  /**
   * 档案的对外形状。
   *
   * 投影在服务内部完成，原始 `TerminalAgentSession` 不越过这个边界——「不许泄露」由
   * `TerminalAgentStateView` 的类型保证，而不是靠每个调用方记得删字段。
   */
  getAgentStateView(sessionId: string): TerminalAgentStateView | null {
    const session = this.agentSessions.get(sessionId)
    return session ? terminalAgentStateView(session) : null
  }

  /**
   * 一次存活探测。
   *
   * 公开出来是为了让「想知道就走一次」这件事不必等到下一个 tick，也让测试能直接决定
   * 某个 pid 死没死，而不是去杀真进程。
   */
  async sweepAgentSessions(): Promise<void> {
    const at = new Date(this.now()).toISOString()
    for (const session of [...this.agentSessions.values()]) {
      if (session.state === "ended" || session.state === "launching") continue
      if (session.pid !== undefined && !this.isProcessAlive(session.pid)) {
        this.commitAgentSessionUpdate(
          session.sessionId,
          terminalAgentProcessExitUpdate(session, { pid: session.pid, at }),
        )
        continue
      }
      await this.correctStalledAgentSession(session, at)
    }
  }

  /**
   * `working` 卡住了：agent 的 transcript 已经很久没长过。
   *
   * 只读 `stat`，不读内容——档案里永远不该出现终端输出的正文。文件读不到就什么都不做：
   * 这条纠正宁可不动，也不能靠猜。
   */
  private async correctStalledAgentSession(session: TerminalAgentSession, at: string): Promise<void> {
    if (!session.transcriptPath) return
    const stalled = terminalAgentStalledUpdate(session, { at, staleMs: AGENT_TRANSCRIPT_STALE_MS })
    if (!stalled) return
    const mtimeMs = await this.readTranscriptMtimeMs(session.transcriptPath)
    if (mtimeMs === null) return
    if (mtimeMs > Date.parse(session.stateChangedAt)) return
    this.commitAgentSessionUpdate(session.sessionId, stalled)
  }

  private async applyAgentEvent(sessionId: string, payload: AgentEventPayload): Promise<void> {
    const current = this.agentSessions.get(sessionId)
      ?? createTerminalAgentSession({ sessionId, at: new Date(this.now()).toISOString() })
    const event: TerminalAgentEvent = {
      source: payload.source,
      event: payload.event,
      at: new Date(this.now()).toISOString(),
      ...(payload.toolName ? { toolName: payload.toolName } : {}),
      ...(payload.notificationType ? { notificationType: payload.notificationType } : {}),
      ...(payload.agentId ? { agentId: payload.agentId } : {}),
      ...(payload.parentSessionId ? { parentSessionId: payload.parentSessionId } : {}),
      ...(payload.agentSessionId ? { agentSessionId: payload.agentSessionId } : {}),
      ...(payload.transcriptPath ? { transcriptPath: payload.transcriptPath } : {}),
      ...(payload.agentPid === undefined ? {} : { pid: payload.agentPid }),
      ...(payload.backgroundTaskCount === undefined ? {} : { backgroundTaskCount: payload.backgroundTaskCount }),
      ...(payload.sessionCronCount === undefined ? {} : { sessionCronCount: payload.sessionCronCount }),
    }
    const update = reduceTerminalAgentEvent({ current, sessionId, event })
    if (update) this.commitAgentSessionUpdate(sessionId, update)
  }

  /**
   * 合并、落盘、并把结果记一行。
   *
   * 被拒绝的更新不写任何东西，所以重复送达、前任的迟到结论、乱序的旧事件都停在这里：
   * 档案不会因为它们抖一下。
   */
  private commitAgentSessionUpdate(sessionId: string, update: TerminalAgentUpdate): void {
    const current = this.agentSessions.get(sessionId)
    const { applied, session } = applyTerminalAgentUpdate(current, update)
    if (!applied) return
    this.agentSessions.set(sessionId, session)
    this.deps.logger.info("Terminal agent session state changed.", {
      sessionId,
      state: session.state,
      version: session.version,
      reason: update.reason,
    })
    this.queueAgentSessionWrite(session)
  }

  private queueAgentSessionWrite(session: TerminalAgentSession): void {
    const write = async (): Promise<void> => {
      // 从没有 agent 进来过的终端不值得在库里占一行。
      if (isTerminalAgentSessionUnstarted(session)) return
      try {
        await this.deps.agentSessions.upsert(session)
      } catch (error) {
        this.deps.logger.warn("Terminal agent session persistence failed.", {
          sessionId: session.sessionId,
          error,
        })
      }
    }
    this.stateQueue = this.stateQueue.then(write, write)
  }

  private async hydrateAgentSessions(): Promise<void> {
    try {
      for (const session of await this.deps.agentSessions.list()) {
        this.agentSessions.set(session.sessionId, session)
      }
    } catch (error) {
      this.deps.logger.warn("Terminal agent sessions could not be read back.", { error })
    }
  }

  private startSweep(): void {
    if (this.sweepTimer) return
    const interval = this.deps.sweepIntervalMs ?? AGENT_SESSION_SWEEP_MS
    if (interval <= 0) return
    this.sweepTimer = setInterval(() => {
      void this.sweepAgentSessions().catch((error: unknown) => {
        this.deps.logger.warn("Terminal agent session sweep failed.", { error })
      })
    }, interval)
    this.sweepTimer.unref?.()
  }

  getSettings(): TerminalAgentNotificationSettings {
    return this.settings
  }

  updateSettings(input: TerminalUpdateAgentNotificationSettingsInput): Promise<TerminalAgentNotificationSettings> {
    const operation = this.settingsQueue.then(
      () => this.applySettingsUpdate(input),
      () => this.applySettingsUpdate(input),
    )
    this.settingsQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async applySettingsUpdate(
    input: TerminalUpdateAgentNotificationSettingsInput,
  ): Promise<TerminalAgentNotificationSettings> {
    if (input.expectedRevision !== this.settings.revision) {
      throw terminalContractError("revision_conflict", "revision", {
        details: { currentRevision: this.settings.revision },
      })
    }
    const previous = this.settings
    // 两颗开关都可以单独改，缺的那个保持原值。
    const nextEnabled = input.enabled ?? previous.enabled
    const nextNotify = input.notify ?? previous.notify
    if (nextEnabled === previous.enabled && nextNotify === previous.notify) return previous
    // 只有总闸的翻转才牵动运行时；`notify` 只是最后一公里要不要出声，落盘就够了。
    const enabledChanged = nextEnabled !== previous.enabled
    const updated = {
      ...previous,
      enabled: nextEnabled,
      notify: nextNotify,
      revision: previous.revision + 1,
      updatedAt: new Date(this.now()).toISOString(),
    }
    await this.deps.settings.setSingleton(updated)
    try {
      if (enabledChanged) {
        if (nextEnabled) await this.enableRuntime()
        else await this.stopIngress()
      }
    } catch (error) {
      await this.deps.settings.setSingleton(previous)
      if (nextEnabled) await this.stopIngress()
      throw error
    }
    this.settings = updated
    if (enabledChanged && !nextEnabled) {
      this.sessionsByToken.clear()
      this.sessionTokens.clear()
    }
    return this.settings
  }

  prepareSession(input: {
    readonly sessionId: string
    readonly title: string
    readonly shell: string
    readonly env: Record<string, string>
    readonly defaultShellArgs: readonly string[]
  }): TerminalAgentLaunchIntegration | null {
    /*
     * 门控只看 runtime 文件在不在：shell 集成（OSC 7 上报当前目录）**总是**注入，
     * 它和「agent 原生通知」是两件事。通知相关的 PATH shim、官方 Hook 与会话绑定
     * 仍然只在开关打开且 ingress 就绪时才做，见下面的 `agentNotificationsActive`。
     *
     * runtime 文件在 `start()` 时就准备好（不再等开关），所以这里返回 null 只剩
     * 「runtime 建不出来」一种情形 —— 那时没有可注入的东西，退回默认启动参数。
     */
    if (!this.runtime) return null
    const runtime = this.runtime
    const binding = this.binding
    const agentNotificationsActive = this.settings.enabled && binding !== undefined
    this.unregisterSession(input.sessionId)
    const delimiter = this.platform === "win32" ? ";" : ":"
    const originalPath = input.env.PATH ?? ""
    const env: Record<string, string> = { ...input.env }
    if (agentNotificationsActive && binding) {
      /*
       * token 是**会话能力**，不是需要藏起来的秘密，威胁模型就按这个来读。
       *
       * 它挡的是别的来源替这个会话伪造事件：环回端口本机谁都连得上，浏览器里的页面也够得着，
       * 没有它就等于谁都能让 Synapse 凭空弹通知、改写侧栏状态。跨会话同样挡得住 —— token 在
       * 服务端只绑定到这一个 sessionId。
       *
       * 它**不**挡同一终端进程树里、同一个 uid 的进程，那类进程读得到这组环境变量。这不是本
       * 实现补得上的缺口：同一个用户下它们本来就能做比伪造一条通知重得多的事。所以别把 token
       * 挪出环境变量、改成读文件 —— 换不来任何安全性，只会让注入更难懂。
       */
      const token = randomUUID()
      const session: SessionBinding = {
        sessionId: input.sessionId,
        token,
        title: input.title,
        waiting: false,
        backgroundWorkPending: false,
        stopStatusUnknown: false,
      }
      this.sessionsByToken.set(token, session)
      this.sessionTokens.set(input.sessionId, token)
      // 档案从这一刻就存在，早于任何事件——「不依赖 hook 送达」的意思正是如此。它还停在
      // `launching`，所以只在内存里：没有 agent 进来过的终端不值得在库里占一行。
      this.agentSessions.set(
        input.sessionId,
        createTerminalAgentSession({ sessionId: input.sessionId, at: new Date(this.now()).toISOString() }),
      )
      env.PATH = `${runtime.shimDir}${delimiter}${originalPath}`
      env.SYNAPSE_TERMINAL_SESSION_ID = input.sessionId
      env.SYNAPSE_TERMINAL_AGENT_TOKEN = token
      env.SYNAPSE_TERMINAL_AGENT_EVENT_URL = `http://${binding.bindAddress}:${String(binding.port)}${EVENT_PATH}`
      env.SYNAPSE_TERMINAL_AGENT_NODE = this.deps.nodePath
      env.SYNAPSE_TERMINAL_AGENT_HOOK = runtime.hookPath
      env.SYNAPSE_TERMINAL_AGENT_WRAPPER = runtime.wrapperPath
      env.SYNAPSE_TERMINAL_AGENT_SHIM_DIR = runtime.shimDir
      env.SYNAPSE_TERMINAL_AGENT_ORIGINAL_PATH = originalPath
    }
    const shellName = (this.platform === "win32" ? path.win32.basename(input.shell) : path.basename(input.shell))
      .toLowerCase()
      .replace(/\.exe$/, "")
    if (shellName === "zsh") {
      env.SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR = input.env.ZDOTDIR ?? ""
      env.SYNAPSE_TERMINAL_AGENT_ZDOTDIR = runtime.zshDir
      env.ZDOTDIR = runtime.zshDir
      return { env, shellArgs: input.defaultShellArgs }
    }
    if (shellName === "bash") {
      return { env, shellArgs: ["--noprofile", "--rcfile", runtime.bashRcPath, "-i"] }
    }
    if (shellName === "fish") {
      return { env, shellArgs: ["--init-command", fishInitCommand(agentNotificationsActive)] }
    }
    // pwsh / cmd 这一轮不接入 OSC 7：它们没有 zsh / bash / fish 那种现成的提示符钩子，
    // 交给「cwd 探测兜底」那条路（`working-directory-probe`）。通知相关的 PATH 前置照旧。
    if (agentNotificationsActive && (shellName === "pwsh" || shellName === "powershell")) {
      return { env, shellArgs: ["-NoExit", "-Command", "$env:Path = $env:SYNAPSE_TERMINAL_AGENT_SHIM_DIR + ';' + $env:Path"] }
    }
    if (agentNotificationsActive && shellName === "cmd") {
      return { env, shellArgs: ["/K", "set \"PATH=%SYNAPSE_TERMINAL_AGENT_SHIM_DIR%;%PATH%\""] }
    }
    return { env, shellArgs: input.defaultShellArgs }
  }

  /**
   * 给「Synapse 自己拉起的 Claude Code」用的 hooks 片段。
   *
   * 用户自己敲 `claude` 时，PATH 上的 wrapper 把同一份块合并进 `--settings`；而 Synapse 用内置
   * runtime 起会话时是绝对路径启动、绕过了 wrapper，所以那条路要由这里把同样的东西交给 launcher
   * 写进它自己生成的 settings。两条路写出来的 hooks 必须逐字一致 —— 有测试直接比对两边。
   *
   * 返回 null 表示这次不该注入（总闸关着，或运行时与监听还没就绪），调用方照原样启动即可。
   * `notify` 不参与这里的判断：它只决定最后一公里弹不弹，不决定注不注入。
   */
  buildClaudeCodeHookSettings(): Record<string, unknown> | null {
    if (!this.settings.enabled || !this.binding || !this.runtime) return null
    const hooks: Record<string, unknown> = {}
    for (const event of CLAUDE_AGENT_HOOK_EVENTS) {
      hooks[event] = [{
        matcher: "",
        hooks: [{
          type: "command",
          command: claudeHookCommand(this.deps.nodePath, this.runtime.hookPath, event),
          timeout: 5,
          async: true,
        }],
      }]
    }
    return { __synapse: CLAUDE_AGENT_MANAGED_MARKER, hooks }
  }

  renameSession(sessionId: string, title: string): void {
    const token = this.sessionTokens.get(sessionId)
    const session = token ? this.sessionsByToken.get(token) : undefined
    if (session) session.title = title
  }

  handleUserInput(sessionId: string): void {
    const session = this.getSessionBinding(sessionId)
    if (!session) return
    session.waiting = false
    this.applyAttention({
      sessionId,
      state: "not_waiting",
      kind: "unknown",
      reason: "user_input",
    })
  }

  unregisterSession(sessionId: string): void {
    const token = this.sessionTokens.get(sessionId)
    if (token) {
      this.sessionsByToken.delete(token)
      this.requestTimesByToken.delete(token)
    }
    this.sessionTokens.delete(sessionId)
    this.lastNotificationAt.delete(`${sessionId}:needs_action`)
    this.lastNotificationAt.delete(`${sessionId}:completed`)
    // 终端会话本身没了，跑在里面的 agent 自然也没了。这不是「某个 pid 死了」的判断，
    // 所以不带 aboutPid——它是本机的直接事实，不需要再等存活探测确认一次。
    const current = this.agentSessions.get(sessionId)
    if (current && current.state !== "ended") {
      this.commitAgentSessionUpdate(sessionId, {
        id: current.id,
        schemaVersion: 1,
        sessionId,
        state: "ended",
        version: nextTerminalAgentVersion(current),
        at: new Date(this.now()).toISOString(),
        ...(current.agentKind ? { agentKind: current.agentKind } : {}),
        reason: "terminal_session_unregistered",
      })
    }
  }

  reportActiveSession(webContentsId: number, sessionId: string | null): void {
    this.activeSessionByWebContents.set(webContentsId, sessionId)
  }

  forgetRenderer(webContentsId: number): void {
    this.activeSessionByWebContents.delete(webContentsId)
  }

  /**
   * 生成（或复用）shell 集成的运行时文件。
   *
   * `permissionGuard.check` 那次 `fs.write` **每条 PTY 都要过**，通知关着也一样 ——
   * 这是有意的：注入到用户 shell 里的东西必须一直走在权限与审计里。
   */
  private async ensureRuntime(): Promise<RuntimePaths> {
    if (!this.deps.nodePath) throw new Error("Synapse Node runtime is unavailable.")
    if (!this.runtime) this.runtime = await this.ensureRuntimeFiles()
    return this.runtime
  }

  private async enableRuntime(): Promise<void> {
    await this.ensureRuntime()
    if (!this.binding) await this.startIngress()
  }

  private async ensureRuntimeFiles(): Promise<RuntimePaths> {
    let permission
    try {
      permission = await this.deps.permissionGuard.check({
        action: "fs.write",
        actor: { kind: "user" },
        resource: this.deps.runtimeDir,
        context: { source: "terminal.agent-notifications" },
      })
    } catch (error) {
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "failed")
      throw error
    }
    if (!permission.allowed) {
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "denied")
      throw new Error(permission.reason)
    }
    const shimDir = path.join(this.deps.runtimeDir, "bin")
    const zshDir = path.join(this.deps.runtimeDir, "zsh")
    const wrapperPath = path.join(this.deps.runtimeDir, "wrapper.js")
    const hookPath = path.join(this.deps.runtimeDir, "hook.js")
    const bashRcPath = path.join(this.deps.runtimeDir, "bashrc")
    try {
      await Promise.all([mkdir(shimDir, { recursive: true }), mkdir(zshDir, { recursive: true })])
      await Promise.all([
        writeFile(wrapperPath, TERMINAL_AGENT_WRAPPER_RUNTIME, { encoding: "utf8", mode: 0o700 }),
        writeFile(hookPath, TERMINAL_AGENT_HOOK_RUNTIME, { encoding: "utf8", mode: 0o700 }),
        writeFile(bashRcPath, bashIntegrationScript(), { encoding: "utf8", mode: 0o600 }),
        ...zshStartupFiles().map(([name, contents]) =>
          writeFile(path.join(zshDir, name), contents, { encoding: "utf8", mode: 0o600 })),
      ])
      const shimExtension = this.platform === "win32" ? ".cmd" : ""
      const shimPath = path.join(shimDir, `claude${shimExtension}`)
      const contents = this.platform === "win32"
        ? createTerminalAgentWindowsShim()
        : createTerminalAgentUnixShim()
      await writeFile(shimPath, contents, { encoding: "utf8", mode: 0o700 })
      if (this.platform !== "win32") await chmod(shimPath, 0o700)
      try {
        await unlink(path.join(shimDir, `codex${shimExtension}`))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "allowed")
      return { shimDir, zshDir, wrapperPath, hookPath, bashRcPath }
    } catch (error) {
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "failed")
      throw error
    }
  }

  private async startIngress(): Promise<void> {
    const resource = `127.0.0.1:0${EVENT_PATH}`
    let permission
    try {
      permission = await this.deps.permissionGuard.check({
        action: "network.listen",
        actor: { kind: "user" },
        resource,
        context: { serviceId: NETWORK_SERVICE_ID },
      })
    } catch (error) {
      this.recordInfrastructureAudit("network.listen", resource, "failed")
      throw error
    }
    if (!permission.allowed) {
      this.recordInfrastructureAudit("network.listen", resource, "denied")
      throw new Error(permission.reason)
    }
    this.binding = await this.deps.networkRegistry.register({
      id: NETWORK_SERVICE_ID,
      role: "http",
      bindAddress: "127.0.0.1",
      auth: { kind: "local-token", tokenSecretRef: "terminal-agent.session-token" },
      handler: { handle: () => ({ ok: true }) },
      audit: (event) => {
        this.recordInfrastructureAudit(
          "network.listen",
          event.serviceId,
          event.action === "failed" ? "failed" : "allowed",
          { action: event.action, bindAddress: event.binding?.bindAddress, port: event.binding?.port },
          event.timestamp,
        )
      },
      start: (binding) => createLocalNetworkHostLifecycle(binding, {
        maxBodyBytes: MAX_BODY_BYTES,
        handleHttp: (request) => this.handleHttp(request),
      }),
    })
  }

  private async stopIngress(): Promise<void> {
    if (!this.binding) return
    await this.deps.networkRegistry.unregister(NETWORK_SERVICE_ID)
    this.binding = undefined
  }

  private async handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    if (request.method !== "POST" || request.url !== EVENT_PATH) return { status: 404 }
    if (!isLoopback(request.remoteAddress)) return { status: 403 }
    const token = bearerToken(request.headers.authorization)
    const session = token ? this.sessionsByToken.get(token) : undefined
    if (!token || !session || !secureEqual(token, session.token)) return { status: 401 }
    if (!this.acquireRateLimit(token)) return { status: 429 }
    try {
      const payload = parseAgentEvent(request.body)
      if (payload.sessionId !== session.sessionId) return { status: 403 }
      await this.handleAgentEvent(session, payload)
      return { status: 204 }
    } catch {
      return { status: 400 }
    }
  }

  private async handleAgentEvent(session: SessionBinding, payload: AgentEventPayload): Promise<void> {
    if (payload.agentId || payload.parentSessionId || payload.event === "SubagentStop") return
    if (payload.event === "Notification" && payload.notificationType === "idle_prompt"
      && (session.backgroundWorkPending || session.stopStatusUnknown)) return
    // 档案先于通知推进：通知是提示，档案是事实，而两者由同一批事件驱动。子 agent 的事件
    // 在两个地方都提前返回，父级状态不会被它带动。
    await this.applyAgentEvent(session.sessionId, payload)
    if (payload.event === "SessionStart" || payload.event === "UserPromptSubmit") {
      session.waiting = false
      this.applyAttention({
        sessionId: session.sessionId,
        state: "not_waiting",
        kind: "unknown",
        reason: payload.event === "SessionStart" ? "agent_session_started" : "agent_prompt_submitted",
      })
      return
    }
    if (payload.event === "PermissionRequest") {
      session.waiting = true
      this.applyAttention({
        sessionId: session.sessionId,
        state: "waiting",
        kind: "approval",
        reason: "agent_permission_request",
      })
      await this.notify(session, "needs_action", payload.source)
      return
    }
    if (payload.event === "PreToolUse" && isQuestionTool(payload.toolName)) {
      session.waiting = true
      this.applyAttention({
        sessionId: session.sessionId,
        state: "waiting",
        kind: "agent_question",
        reason: "agent_question_tool",
      })
      await this.notify(session, "needs_action", payload.source)
      return
    }
    if (payload.event === "PreToolUse") {
      session.waiting = false
      this.applyAttention({
        sessionId: session.sessionId,
        state: "not_waiting",
        kind: "unknown",
        reason: "agent_tool_started",
      })
      return
    }
    if (payload.event === "Notification" && isActionNotification(payload.notificationType)) {
      session.waiting = true
      this.applyAttention({
        sessionId: session.sessionId,
        state: "waiting",
        kind: attentionKindForNotification(payload.notificationType),
        reason: `agent_notification_${payload.notificationType ?? "unspecified"}`,
      })
      await this.notify(
        session,
        "needs_action",
        payload.source,
        payload.notificationType === "idle_prompt" ? "idle" : undefined,
      )
      return
    }
    if (payload.event === "Stop") {
      session.backgroundWorkPending = (payload.backgroundTaskCount ?? 0) > 0 || (payload.sessionCronCount ?? 0) > 0
      session.stopStatusUnknown = payload.backgroundTaskCount === undefined || payload.sessionCronCount === undefined
      if (session.waiting) return
      session.waiting = false
      this.applyAttention({
        sessionId: session.sessionId,
        state: "not_waiting",
        kind: "unknown",
        reason: session.backgroundWorkPending ? "agent_background_work" : "agent_stopped",
      })
      if (session.backgroundWorkPending || session.stopStatusUnknown) return
      await this.notify(session, "completed", payload.source)
      return
    }
    if (payload.event === "Interrupt" || payload.event === "SessionEnd") {
      if (!session.waiting) return
      session.waiting = false
      this.applyAttention({
        sessionId: session.sessionId,
        state: "not_waiting",
        kind: "unknown",
        reason: payload.event === "Interrupt" ? "agent_interrupted" : "agent_session_ended",
      })
    }
  }

  private applyAttention(update: TerminalAgentAttentionUpdate): void {
    try {
      this.deps.setSessionAttention?.(update)
    } catch (error) {
      this.deps.logger.warn("Terminal session attention update failed.", {
        sessionId: update.sessionId,
        state: update.state,
        kind: update.kind,
        error,
      })
    }
  }

  private async notify(
    session: SessionBinding,
    kind: AgentNotificationKind,
    provider: AgentProvider,
    variant?: AgentNotificationVariant,
  ): Promise<void> {
    /*
     * 「不弹系统通知」在这里短路。状态与 attention 在上游就已经更新完了，通知是整条链路唯一
     * 出声的地方，所以关掉它不影响侧栏标记、手机端和 MCP 读到的运行状态。
     *
     * 放在权限检查与审计之前是有意的：没有要触发的通知，就不该留下一条通知审计。
     */
    if (!this.settings.enabled || !this.settings.notify) return
    const focused = this.isExactSessionFocused(session.sessionId)
    if (focused && kind !== "completed") return
    const key = `${session.sessionId}:${kind}`
    const previous = this.lastNotificationAt.get(key) ?? 0
    if (this.now() - previous < DEDUPLICATION_WINDOW_MS) return
    this.lastNotificationAt.set(key, this.now())
    const actor = { kind: "user" } as const
    const resource = `terminal.session:${session.sessionId}`
    let permission
    try {
      permission = await this.deps.permissionGuard.check({
        action: "notification.trigger",
        actor,
        resource,
        context: { source: "terminal.agent-notifications", provider, kind },
      })
    } catch (error) {
      this.lastNotificationAt.delete(key)
      this.recordNotificationAudit(resource, provider, kind, "failed")
      this.deps.logger.warn("Failed to authorize Terminal agent notification.", {
        sessionId: session.sessionId,
        error,
      })
      return
    }
    if (!permission.allowed) {
      this.lastNotificationAt.delete(key)
      this.recordNotificationAudit(resource, provider, kind, "denied")
      return
    }
    const title = "Claude Code"
    const sessionTitle = sanitizeSessionTitle(session.title)
    const body = agentNotificationBody(kind, sessionTitle, variant)
    if (kind === "completed") {
      void this.deps.syncCompletion?.({
        sessionId: session.sessionId,
        title,
        body,
        sourceKey: `terminal-complete:${session.sessionId}:${Math.floor(this.now() / DEDUPLICATION_WINDOW_MS)}`,
      }).catch((error: unknown) => {
        this.deps.logger.warn("Terminal completion could not be synced.", { sessionId: session.sessionId, error })
      })
    }
    if (focused) return
    try {
      const notification = this.deps.createNotification({
        title,
        body,
      })
      if (!notification) {
        this.recordNotificationAudit(resource, provider, kind, "allowed")
        return
      }
      const release = () => this.liveNotifications.delete(notification)
      notification.on("close", release)
      notification.on("click", () => {
        release()
        this.deps.focusApp()
        void this.deps.openTerminalSession(session.sessionId).catch((error) => {
          this.deps.logger.warn("Failed to open Terminal session from notification.", {
            sessionId: session.sessionId,
            error,
          })
        })
      })
      this.liveNotifications.add(notification)
      try {
        notification.show()
      } catch (error) {
        this.liveNotifications.delete(notification)
        throw error
      }
      this.recordNotificationAudit(resource, provider, kind, "allowed")
    } catch (error) {
      this.lastNotificationAt.delete(key)
      this.recordNotificationAudit(resource, provider, kind, "failed")
      this.deps.logger.warn("Failed to show Terminal agent notification.", {
        sessionId: session.sessionId,
        error,
      })
    }
  }

  private recordNotificationAudit(
    resource: string,
    provider: AgentProvider,
    kind: AgentNotificationKind,
    outcome: "allowed" | "denied" | "failed",
  ): void {
    try {
      this.deps.auditSink.record({
        action: "notification.trigger",
        actor: { kind: "user" },
        resource,
        outcome,
        timestamp: new Date(this.now()).toISOString(),
        metadata: { source: "terminal.agent-notifications", provider, kind },
      })
    } catch (error) {
      this.deps.logger.warn("Failed to audit Terminal agent notification.", { outcome, error })
    }
  }

  private recordInfrastructureAudit(
    action: "fs.write" | "network.listen",
    resource: string,
    outcome: "allowed" | "denied" | "failed",
    metadata: Record<string, unknown> = {},
    timestamp = new Date(this.now()).toISOString(),
  ): void {
    try {
      this.deps.auditSink.record({
        action,
        actor: { kind: "user" },
        resource,
        outcome,
        timestamp,
        metadata: { source: "terminal.agent-notifications", ...metadata },
      })
    } catch (error) {
      this.deps.logger.warn("Failed to audit Terminal agent notification infrastructure.", {
        action,
        outcome,
        error,
      })
    }
  }

  private isExactSessionFocused(sessionId: string): boolean {
    const focusedId = this.deps.focusedWebContentsId()
    return focusedId !== null && this.activeSessionByWebContents.get(focusedId) === sessionId
  }

  private acquireRateLimit(token: string): boolean {
    const cutoff = this.now() - 60_000
    const current = (this.requestTimesByToken.get(token) ?? []).filter((time) => time > cutoff)
    if (current.length >= RATE_LIMIT_PER_MINUTE) return false
    current.push(this.now())
    this.requestTimesByToken.set(token, current)
    return true
  }

  private getSessionBinding(sessionId: string): SessionBinding | undefined {
    const token = this.sessionTokens.get(sessionId)
    return token ? this.sessionsByToken.get(token) : undefined
  }
}

type RuntimePaths = {
  readonly shimDir: string
  readonly zshDir: string
  readonly wrapperPath: string
  readonly hookPath: string
  readonly bashRcPath: string
}

type AgentEventPayload = {
  readonly source: AgentProvider
  readonly event: string
  readonly sessionId: string
  readonly toolName?: string
  readonly notificationType?: string
  readonly agentId?: string
  readonly parentSessionId?: string
  readonly agentSessionId?: string
  readonly transcriptPath?: string
  /** 这一任 agent 进程的 pid，由 wrapper 在 spawn 之后报上来。 */
  readonly agentPid?: number
  readonly backgroundTaskCount?: number
  readonly sessionCronCount?: number
}

function defaultSettings(): TerminalAgentNotificationSettings {
  return {
    schemaVersion: 2,
    id: "default",
    enabled: false,
    // 默认跟随总闸：打开通知就该收到通知，想安静的人自己关掉这一颗。
    notify: true,
    revision: 1,
    updatedAt: new Date(0).toISOString(),
  }
}

function parseAgentEvent(body: Buffer): AgentEventPayload {
  const value = JSON.parse(body.toString("utf8")) as Record<string, unknown>
  if (value.source !== "claude"
    || typeof value.event !== "string"
    || typeof value.sessionId !== "string") throw new Error("Invalid event")
  return {
    source: value.source,
    event: value.event.slice(0, 64),
    sessionId: value.sessionId,
    ...(typeof value.toolName === "string" ? { toolName: value.toolName.slice(0, 128) } : {}),
    ...(typeof value.notificationType === "string" ? { notificationType: value.notificationType.slice(0, 128) } : {}),
    ...(typeof value.agentId === "string" ? { agentId: value.agentId.slice(0, 128) } : {}),
    ...(typeof value.parentSessionId === "string" ? { parentSessionId: value.parentSessionId.slice(0, 128) } : {}),
    ...(typeof value.agentSessionId === "string" ? { agentSessionId: value.agentSessionId.slice(0, 200) } : {}),
    // 路径只被 `stat`，所以给它一个够用又不会失控的长度上限。
    ...(typeof value.transcriptPath === "string" ? { transcriptPath: value.transcriptPath.slice(0, 4096) } : {}),
    ...(isPositiveInteger(value.agentPid) ? { agentPid: value.agentPid } : {}),
    ...(isNonNegativeInteger(value.backgroundTaskCount) ? { backgroundTaskCount: value.backgroundTaskCount } : {}),
    ...(isNonNegativeInteger(value.sessionCronCount) ? { sessionCronCount: value.sessionCronCount } : {}),
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

/**
 * 进程还在不在。
 *
 * `EPERM` 也算活着：那说明进程存在，只是不归我们管。只有 `ESRCH` 才是「没有这个进程」。
 */
function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** `null` 表示读不到——文件不存在或读不动，两种都只意味着「不知道」，不是「没在写」。 */
async function defaultReadTranscriptMtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    // 不存在、没权限、路径已经变了——原因不同，结论一样：这一轮不知道，那就什么都别改。
    return null
  }
}

function bearerToken(value: string | readonly string[] | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null
  return value.slice(7)
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"
}

function isQuestionTool(toolName: string | undefined): boolean {
  return toolName === "AskUserQuestion" || toolName === "ExitPlanMode"
}

function isActionNotification(type: string | undefined): boolean {
  return type === undefined || ["permission_prompt", "idle_prompt", "elicitation_dialog"].includes(type)
}

/**
 * 同一个 `Notification` 进来的两种等待不是一回事。
 *
 * `idle_prompt` 是 Agent 跑完一轮、空闲着等你下一句（通知文案里的「还在等你」），其余是
 * 它真的举着一个问题或一次审批举在那里（「需要你的操作」）。过去这里一律记成
 * `agent_question`，于是手机「消息」的待处理行对着一个空闲的 Agent 也写「正在等待你的
 * 回答」——用户点进去，终端里并没有在问什么。
 */
function attentionKindForNotification(type: string | undefined): TerminalAgentAttentionUpdate["kind"] {
  if (type === "permission_prompt") return "approval"
  if (type === "idle_prompt") return "agent_idle"
  return "agent_question"
}

/** 通知正文：只出现 Agent 名、会话标题和状态，一句说清。 */
function agentNotificationBody(
  kind: AgentNotificationKind,
  sessionTitle: string,
  variant?: AgentNotificationVariant,
): string {
  if (kind === "completed") return `“${sessionTitle}”本轮回复结束`
  if (variant === "idle") return `“${sessionTitle}”还在等你`
  return `“${sessionTitle}”需要你的操作`
}

function sanitizeSessionTitle(value: string): string {
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
  return (normalized || "终端").slice(0, 60)
}

/**
 * OSC 7 —— 把当前目录报给终端。
 *
 * URL 必须是**空主机名**的 `file://<绝对路径>`。`$PWD` 以 `/` 开头，拼出来天然是三个斜杠。
 * 消费端 `emulator.ts` 的 OSC 7 处理器直接把它交给 `fileURLToPath`，而带主机名的形式
 * （iTerm2 惯例的 `file://$(hostname)/path`）会抛 `ERR_INVALID_FILE_URL_HOST` ——
 * handler 的 `catch` 只 `return false`，于是这条上报被**静默丢弃**，
 * 现象是「配置全对但目录不更新」。绝对不要按 iTerm2 的惯例拼主机名。
 * 结尾用 BEL，与 `/etc/zshrc_Apple_Terminal` 一致。
 */
const OSC7_REPORT_COMMAND = String.raw`printf '\033]7;file://%s\a' "$PWD"`

/**
 * zsh 的上报钩子。
 *
 * 追加进四个启动文件（`.zshenv` / `.zprofile` / `.zshrc` / `.zlogin`；只做转发的 `.zlogout` 不在其内）：用户自己的 `.zshrc`
 * 可能重置 `precmd_functions`，晚一点再 `add-zsh-hook` 一次能把它加回来。`add-zsh-hook`
 * 自身幂等（同一个函数名不会重复注册），所以重复 source 不会变成多次上报 ——
 * 钩子名必须固定，否则靠不住的就是这条幂等性。
 */
const ZSH_OSC7_HOOK = [
  `_synapse_report_cwd() { ${OSC7_REPORT_COMMAND}; }`,
  "autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd _synapse_report_cwd",
].join("\n")

const BASH_OSC7_HOOK = [
  `_synapse_report_cwd() { ${OSC7_REPORT_COMMAND}; }`,
  'if [[ "${PROMPT_COMMAND:-}" != *"_synapse_report_cwd"* ]]; then',
  '  PROMPT_COMMAND="_synapse_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  "fi",
].join("\n")

const FISH_OSC7_HOOK = `function _synapse_report_cwd --on-event fish_prompt; ${OSC7_REPORT_COMMAND}; end`

/**
 * PATH 前置只在 Agent 原生通知开着的时候做。
 *
 * 现在每条 PTY 都会注入 shell 集成（上报目录），但 PATH shim 与官方 Hook 仍然只服务于
 * Agent 通知 —— 判据是 `SYNAPSE_TERMINAL_AGENT_SHIM_DIR` 存不存在，它由 `prepareSession`
 * 按当时的开关决定，所以同一个生成文件能同时服务两种状态。
 */
const ZSH_SHIM_PATH_GUARD = [
  'if [[ -n "${SYNAPSE_TERMINAL_AGENT_SHIM_DIR:-}" ]]; then',
  "  typeset -gU path PATH",
  '  path=("$SYNAPSE_TERMINAL_AGENT_SHIM_DIR" $path)',
  "fi",
].join("\n")

function zshStartupFiles(): readonly (readonly [string, string])[] {
  const zshEnv = [
    'typeset _synapse_original_zdotdir="${SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR:-$HOME}"',
    'if [[ -r "$_synapse_original_zdotdir/.zshenv" ]]; then',
    '  source "$_synapse_original_zdotdir/.zshenv"',
    "fi",
    'if [[ -n "$ZDOTDIR" && "$ZDOTDIR" != "$SYNAPSE_TERMINAL_AGENT_ZDOTDIR" ]]; then',
    '  export SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR="$ZDOTDIR"',
    "fi",
    'export ZDOTDIR="$SYNAPSE_TERMINAL_AGENT_ZDOTDIR"',
    ZSH_SHIM_PATH_GUARD,
    "unset _synapse_original_zdotdir",
    ZSH_OSC7_HOOK,
    "",
  ].join("\n")
  const sourceOriginal = (name: string): readonly string[] => [
    `if [[ -n "$SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR" && -r "$SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR/${name}" ]]; then`,
    `  source "$SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR/${name}"`,
    `elif [[ -r "$HOME/${name}" ]]; then`,
    `  source "$HOME/${name}"`,
    "fi",
  ]
  const remaining = [".zprofile", ".zshrc", ".zlogin"].map((name) => [name, [
    ...sourceOriginal(name),
    ZSH_SHIM_PATH_GUARD,
    ZSH_OSC7_HOOK,
    "",
  ].join("\n")] as const)
  /*
   * `.zlogout` 只在登录 shell 退出时执行，PATH 前置和 OSC 7 上报在这里都没有意义，所以它跟
   * 上面三个不一样：只转发用户自己的文件。它跟 `.zprofile` / `.zlogin` 一样是登录 shell 才有
   * 的文件，既然那两个都转了，漏掉它就不是「不适用」而是遗漏 —— 后果是用户的收尾逻辑
   * （清 ssh-agent、flush 历史之类）在 Synapse 终端里静默不执行。
   */
  const logout = [".zlogout", [...sourceOriginal(".zlogout"), ""].join("\n")] as const
  return [[".zshenv", zshEnv] as const, ...remaining, logout]
}

function bashIntegrationScript(): string {
  return [
    'if [[ -r "$HOME/.bash_profile" ]]; then',
    '  source "$HOME/.bash_profile"',
    'elif [[ -r "$HOME/.bash_login" ]]; then',
    '  source "$HOME/.bash_login"',
    'elif [[ -r "$HOME/.profile" ]]; then',
    '  source "$HOME/.profile"',
    'elif [[ -r "$HOME/.bashrc" ]]; then',
    '  source "$HOME/.bashrc"',
    "fi",
    'if [[ -n "${SYNAPSE_TERMINAL_AGENT_SHIM_DIR:-}" ]]; then',
    '  export PATH="$SYNAPSE_TERMINAL_AGENT_SHIM_DIR:$PATH"',
    "fi",
    BASH_OSC7_HOOK,
    "",
  ].join("\n")
}

function fishInitCommand(includeAgentShimPath: boolean): string {
  return [
    FISH_OSC7_HOOK,
    ...(includeAgentShimPath ? ['set -gx PATH "$SYNAPSE_TERMINAL_AGENT_SHIM_DIR" $PATH'] : []),
  ].join("; ")
}
