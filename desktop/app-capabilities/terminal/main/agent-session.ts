/**
 * Agent 会话档案与状态机。
 *
 * 这个文件里只有纯函数：没有 I/O、没有定时器、没有 `await`。环回 HTTP 处理器把事件解析、
 * 鉴权、限流之后，走到这里的只是几个已经成形的取值，所以合并一次是微秒级的，不会让主线程
 * 等任何东西——要把它整体搬进 worker 也不需要改一行逻辑。
 *
 * 它回答的不是「要不要弹通知」，而是「现在到底跑到哪一步了」：通知是提示，档案是事实。
 */

export const TERMINAL_AGENT_STATES = ["launching", "idle", "working", "needs_input", "ended"] as const
export type TerminalAgentState = (typeof TERMINAL_AGENT_STATES)[number]

export type TerminalAgentKind = "claude" | "codex"

/**
 * 一份 agent 会话档案。
 *
 * 字段是白名单，不是「先存着兴许有用」的袋子：提示词、回答、终端输出、工具参数一个都不在
 * 里面，也不允许以后加进来。终端里发生了什么，只有「跑到哪一步了」这一件事需要离开这个
 * 进程。`transcriptPath` 是一条路径而不是内容——它只被 `stat`，永远不被读。
 *
 * `sessionId` 就是任务一注入的 `SYNAPSE_SESSION_ID`：终端会话是绑定的锚点，agent 是跑在
 * 它里面的东西。
 */
export type TerminalAgentSession = {
  readonly id: string
  readonly schemaVersion: 1
  readonly sessionId: string
  /**
   * 跑的是哪个 agent。进程真的启动之前不知道，所以 `launching` 阶段的档案没有这一项。
   * `codex` 仅保留用于读取旧档案；新会话不再注入 Codex Hook。
   */
  readonly agentKind?: TerminalAgentKind
  /**
   * agent 自己的会话 id。`--resume` 前后它是同一个，所以它不能用来认「这一任进程是谁」——
   * 那是 {@link TerminalAgentSession.pid} 的活。
   */
  readonly agentSessionId?: string
  readonly state: TerminalAgentState
  /** 单调递增：每接受一次变更 +1。对账时只认比本地大的。 */
  readonly version: number
  readonly lastActivityAt: string
  readonly stateChangedAt: string
  /** 这一任 agent 进程的 pid；换进程（`--resume`）之后它跟着变。 */
  readonly pid?: number
  /** agent 会话记录文件的路径。只 `stat`，不读。 */
  readonly transcriptPath?: string
}

/** 一次被观察到、并且已经成形的变化。 */
export type TerminalAgentUpdate = {
  readonly id: string
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly state: TerminalAgentState
  readonly version: number
  readonly at: string
  readonly agentKind?: TerminalAgentKind
  readonly agentSessionId?: string
  /** 这一任进程是谁。带上它表示「现在的进程换成了这个」。 */
  readonly pid?: number
  /**
   * 这条更新是**关于某个进程**的结论（例如「pid 为 X 的那一任没了」）。
   *
   * 与 `pid` 是两件事：`pid` 说的是「现在换成谁了」，`aboutPid` 说的是「我在讲谁」。
   * 前者可以让记录换任，后者只在讲的还是当前这一任时才算数。
   */
  readonly aboutPid?: number
  readonly transcriptPath?: string
  /** 为什么变成这样。只给人看，不参与对账。 */
  readonly reason: string
}

export type TerminalAgentEvent = {
  readonly source: TerminalAgentKind
  readonly event: string
  readonly at: string
  readonly toolName?: string
  readonly notificationType?: string
  readonly agentId?: string
  readonly parentSessionId?: string
  readonly agentSessionId?: string
  readonly transcriptPath?: string
  readonly pid?: number
  readonly backgroundTaskCount?: number
  readonly sessionCronCount?: number
}

/**
 * 状态机。返回 `null` 表示这条事件对父级状态没有信息量，什么都不该改。
 *
 * 形状是 `launching → idle ⇄ working → needs_input → ended`：`needs_input` 不会自己回到
 * `working`，要等 agent 真的又动起来（`PostToolUse` / `UserPromptSubmit`）才算人已经回答了。
 */
export function reduceTerminalAgentEvent(input: {
  readonly current: TerminalAgentSession | undefined
  readonly sessionId: string
  readonly event: TerminalAgentEvent
}): TerminalAgentUpdate | null {
  const { current, sessionId, event } = input
  // 子 agent 的生死对父级没有信息量：它开始时父级已经在 working，结束时父级还在 working。
  // 把它当成父级事件处理，只会让侧栏在两个正确状态之间来回跳。
  if (event.agentId || event.parentSessionId || event.event === "SubagentStop") return null

  const state = reduceState(event)
  if (!state) return null
  return {
    id: sessionId,
    schemaVersion: 1,
    sessionId,
    state,
    version: nextTerminalAgentVersion(current),
    at: event.at,
    agentKind: event.source,
    ...(event.agentSessionId ? { agentSessionId: event.agentSessionId } : {}),
    ...(event.pid === undefined ? {} : { pid: event.pid }),
    ...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
    reason: describeTerminalAgentEvent(event),
  }
}

/**
 * 这一任进程没了。
 *
 * 带上 pid 是关键：它不是「把会话标成结束」，而是「pid 为 X 的那一任进程没了」这个命题。
 * 记录已经换到自己这一任之后，前任的结论会被 {@link applyTerminalAgentUpdate} 挡掉。
 */
export function terminalAgentProcessExitUpdate(
  current: TerminalAgentSession,
  input: { readonly pid: number; readonly at: string },
): TerminalAgentUpdate {
  return {
    id: current.id,
    schemaVersion: 1,
    sessionId: current.sessionId,
    state: "ended",
    version: nextTerminalAgentVersion(current),
    at: input.at,
    // 只带 `aboutPid`，不带 `pid`：记录说自己结束了，但不能顺手把 pid 改成别的值。
    aboutPid: input.pid,
    ...(current.agentKind ? { agentKind: current.agentKind } : {}),
    reason: "agent_process_exited",
  }
}

/**
 * 卡住的 `working`：agent 的 transcript 已经很久没有新内容了。
 *
 * 只把 `working` 降回 `idle`，不推断 `ended`——文件不再更新只说明「它现在没在写」，
 * 说明不了进程还在不在，那是存活探测的事。没有 transcriptPath 就什么都不做：这个纠正
 * 宁可不动，也不能靠猜。
 */
export function terminalAgentStalledUpdate(
  current: TerminalAgentSession,
  input: { readonly at: string; readonly staleMs: number },
): TerminalAgentUpdate | null {
  if (current.state !== "working") return null
  const changedAtMs = Date.parse(current.stateChangedAt)
  if (!Number.isFinite(changedAtMs)) return null
  if (Date.parse(input.at) - changedAtMs < input.staleMs) return null
  return {
    id: current.id,
    schemaVersion: 1,
    sessionId: current.sessionId,
    state: "idle",
    version: nextTerminalAgentVersion(current),
    at: input.at,
    ...(current.agentKind ? { agentKind: current.agentKind } : {}),
    reason: "agent_transcript_stalled",
  }
}

/**
 * 合并一条更新，只接受「比本地新」的那一条。
 *
 * 三条拒绝规则，各自对应的都是真实会发生的事：
 *
 * - `version` 不比本地大：重复送达的同一条更新不该再改一次档案。
 * - 更新讲的是**别的进程**（`aboutPid` 不是当前这一任）：前任的迟到结论。记录已经换成
 *   自己这一任了，别的进程说自己死了，跟这一任没有关系——`--resume` 换 pid 之后被前任
 *   误标 `ended`，挡住的正是这一条。
 * - 已经 `ended` 了：结束是终态，其余迟到的旧事件一律不算。唯一的例外是另一个进程接管了
 *   这个会话（`--resume`），那是正向证据，不是旧闻。
 */
export function applyTerminalAgentUpdate(
  current: TerminalAgentSession | undefined,
  update: TerminalAgentUpdate,
): { readonly applied: boolean; readonly session: TerminalAgentSession } {
  if (!current) return { applied: true, session: toTerminalAgentSession(update) }
  if (update.version <= current.version) return { applied: false, session: current }
  if (update.aboutPid !== undefined && current.pid !== undefined && update.aboutPid !== current.pid) {
    return { applied: false, session: current }
  }
  if (current.state === "ended") {
    const takeover = update.pid !== undefined && update.pid !== current.pid && update.aboutPid === undefined
    if (!takeover) return { applied: false, session: current }
  }
  return {
    applied: true,
    session: {
      ...current,
      state: update.state,
      version: update.version,
      lastActivityAt: update.at,
      // 状态没变就只是活动时间在走，`stateChangedAt` 留着上一次真正变的时候。
      stateChangedAt: update.state === current.state ? current.stateChangedAt : update.at,
      ...(update.agentKind ? { agentKind: update.agentKind } : {}),
      ...(update.agentSessionId ? { agentSessionId: update.agentSessionId } : {}),
      ...(update.pid === undefined ? {} : { pid: update.pid }),
      ...(update.transcriptPath ? { transcriptPath: update.transcriptPath } : {}),
    },
  }
}

export function nextTerminalAgentVersion(current: TerminalAgentSession | undefined): number {
  return (current?.version ?? 0) + 1
}

/**
 * 终端会话一建立就有的档案，停在 `launching`。
 *
 * 它只在内存里：一个从没有 agent 跑进来过的终端不值得在库里占一行，等第一次真正的状态
 * 变化再落盘。但它必须现在就有——「不依赖 hook 送达」的意思正是档案的存在早于任何事件。
 */
export function createTerminalAgentSession(input: {
  readonly sessionId: string
  readonly at: string
}): TerminalAgentSession {
  return {
    id: input.sessionId,
    schemaVersion: 1,
    sessionId: input.sessionId,
    state: "launching",
    version: 1,
    lastActivityAt: input.at,
    stateChangedAt: input.at,
  }
}

/** 一条从没被任何事件碰过的档案：它在库里没有对应的一行。 */
export function isTerminalAgentSessionUnstarted(session: TerminalAgentSession): boolean {
  return session.state === "launching"
}

/**
 * 档案里唯一允许离开这个进程的那部分。
 *
 * 写成白名单而不是「挑几个删掉」，是为了让泄露在类型层面写不出来：`transcriptPath` 指向
 * 用户整段对话（提示词、回答、工具调用与被读进上下文的文件内容），把它交出去等于把对话
 * 内容外包一次查询；`pid` 与 agent 自己的会话 id 是宿主进程细节，外部不需要。
 *
 * 调用方要判断「变了没有」看 {@link TerminalAgentStateView.version}，它是单调的。
 */
export type TerminalAgentStateView = {
  readonly state: TerminalAgentState
  /** `launching` 阶段不知道，其余阶段由 shim 上报。 */
  readonly agentKind?: TerminalAgentKind
  readonly version: number
  readonly lastActivityAt: string
  readonly stateChangedAt: string
}

/**
 * 读出去之前把档案投影成白名单。
 *
 * 没跑过 agent 的会话没有可读的东西，返回 `null` —— 调用方据此知道「这里从来没有 agent」，
 * 这与「agent 跑过、现在已经结束」（`state = "ended"`）是两件不同的事，不得合并。
 */
export function terminalAgentStateView(session: TerminalAgentSession): TerminalAgentStateView | null {
  if (isTerminalAgentSessionUnstarted(session)) return null
  return {
    state: session.state,
    version: session.version,
    lastActivityAt: session.lastActivityAt,
    stateChangedAt: session.stateChangedAt,
    ...(session.agentKind ? { agentKind: session.agentKind } : {}),
  }
}

function toTerminalAgentSession(update: TerminalAgentUpdate): TerminalAgentSession {
  return {
    id: update.id,
    schemaVersion: 1,
    sessionId: update.sessionId,
    state: update.state,
    version: update.version,
    lastActivityAt: update.at,
    stateChangedAt: update.at,
    ...(update.agentKind ? { agentKind: update.agentKind } : {}),
    ...(update.agentSessionId ? { agentSessionId: update.agentSessionId } : {}),
    ...(update.pid === undefined ? {} : { pid: update.pid }),
    ...(update.transcriptPath ? { transcriptPath: update.transcriptPath } : {}),
  }
}

function reduceState(event: TerminalAgentEvent): TerminalAgentState | null {
  switch (event.event) {
    // 新的一任进程接管了这个会话（多半是 `--resume`）。pid 由上面的 update 一起带过来，
    // 上一任之后说的任何话都会被 pid 校验挡掉。
    case "AgentProcessStart":
    case "SessionStart":
      return "idle"
    case "UserPromptSubmit":
    case "PostToolUse":
      return "working"
    case "PreToolUse":
      return isQuestionTool(event.toolName) ? "needs_input" : "working"
    case "PermissionRequest":
      return "needs_input"
    case "Notification":
      return isActionNotification(event.notificationType) ? "needs_input" : null
    case "Stop":
      return (event.backgroundTaskCount ?? 0) > 0 || (event.sessionCronCount ?? 0) > 0
        ? "working"
        : "idle"
    case "Interrupt":
      return "idle"
    case "SessionEnd":
      return "ended"
    default:
      return null
  }
}

function describeTerminalAgentEvent(event: TerminalAgentEvent): string {
  if (event.event === "PreToolUse" && isQuestionTool(event.toolName)) return "agent_question_tool"
  if (event.event === "Notification") return `agent_notification_${event.notificationType ?? "unspecified"}`
  return `agent_${event.event.toLowerCase()}`
}

function isQuestionTool(toolName: string | undefined): boolean {
  return toolName === "AskUserQuestion" || toolName === "ExitPlanMode" || toolName === "request_user_input"
}

function isActionNotification(type: string | undefined): boolean {
  return type === undefined || ["permission_prompt", "idle_prompt", "elicitation_dialog"].includes(type)
}
