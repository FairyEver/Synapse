import type { ControlledProcessRunner } from "../../../electron/runtime/process"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { TERMINAL_CWD_PROBE_ACTOR_ID } from "../../../electron/runtime/security"

/**
 * 终端当前目录的兜底探测。
 *
 * 正常路径是 shell 自己发的 OSC 7（见 `agent-notification-service` 的 shell 集成）。
 * 这一层服务的是那条路覆盖不到的情况：自定义 shell、Windows 的 pwsh / cmd、用户主动
 * 重置了 PATH 之类。**它只在有人问的时候跑一次，不做定时轮询。**
 *
 * 命令是固定的：`ps -t <tty>` 找前台进程，`lsof -a -d cwd -p <pid>` 读它的 cwd。
 * 这里不拼 shell 字符串、不接受任何来自上层的命令，权限动作也是一个窄动作
 * （`process.cwd_probe`）而不是 `shell.exec` —— 否则等于给终端开了一条通用命令通道。
 */
export type TerminalWorkingDirectoryProbe = {
  /**
   * 纯读缓存：这个水位下已经算过就返回结果（可能是 null，代表「算过了，没结果」），
   * 没算过就返回 undefined。**不执行任何命令。**
   */
  read(input: { readonly sessionId: string; readonly watermark: number }): string | null | undefined
  /**
   * 真的去探一次。同一水位重复调用只执行一次命令；失败一律返回 null，不抛。
   */
  probe(input: {
    readonly sessionId: string
    readonly watermark: number
    readonly tty?: string
    readonly pid?: number
  }): Promise<string | null>
  /** 会话没了——它的一切都只活到那一刻（ADR 0215），缓存也一样。 */
  forget(sessionId: string): void
}

export type TerminalWorkingDirectoryProbeDeps = {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger?: { warn(message: string, meta?: unknown): void }
  /** 探测是兜底，不是主路，慢一点就放弃。 */
  readonly timeoutMs?: number
  readonly platform?: NodeJS.Platform
}

const DEFAULT_TIMEOUT_MS = 3_000
const PROBE_SOURCE = "terminal.working-directory-probe"

export function createTerminalWorkingDirectoryProbe(
  deps: TerminalWorkingDirectoryProbeDeps,
): TerminalWorkingDirectoryProbe {
  const platform = deps.platform ?? process.platform
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const actor: ActorIdentity = { kind: "system", id: TERMINAL_CWD_PROBE_ACTOR_ID }
  /** 缓存键是「该 session 的 PTY 输出水位」：输出一动就重探，不然 cd 之后永远是头一个值。 */
  const cache = new Map<string, { readonly watermark: number; readonly path: string | null }>()
  const inFlight = new Map<string, Promise<string | null>>()

  function read(input: { readonly sessionId: string; readonly watermark: number }): string | null | undefined {
    const cached = cache.get(input.sessionId)
    return cached && cached.watermark === input.watermark ? cached.path : undefined
  }

  async function probe(input: {
    readonly sessionId: string
    readonly watermark: number
    readonly tty?: string
    readonly pid?: number
  }): Promise<string | null> {
    const cached = read(input)
    if (cached !== undefined) return cached
    const existing = inFlight.get(input.sessionId)
    if (existing) return existing
    const run = runProbe(input).finally(() => inFlight.delete(input.sessionId))
    inFlight.set(input.sessionId, run)
    return run
  }

  async function runProbe(input: {
    readonly sessionId: string
    readonly watermark: number
    readonly tty?: string
    readonly pid?: number
  }): Promise<string | null> {
    // Windows 上没有 `lsof`，也没有 PTY 设备名这回事：这条路本来就不通，直接放弃。
    if (platform === "win32" || (!input.tty && input.pid === undefined)) return null
    const resource = input.tty ?? `pid:${String(input.pid)}`
    let permission: Awaited<ReturnType<PermissionGuard["check"]>>
    try {
      permission = await deps.permissionGuard.check({
        action: PROBE_ACTION,
        actor,
        resource,
        context: { source: PROBE_SOURCE, sessionId: input.sessionId },
      })
    } catch (error) {
      // check 自己抛的时候受控执行器不会留下记录（它还没走到那一步），这里补齐。
      recordAudit("failed", resource, input.sessionId, { error: messageOf(error) })
      deps.logger?.warn("Terminal working directory probe was refused.", { sessionId: input.sessionId, error })
      return null
    }
    if (!permission.allowed) {
      // 被拒之后**不调用**受控执行器：让它去拒绝一次只会得到第二条 denied 记录。
      recordAudit("denied", resource, input.sessionId, { reason: permission.reason })
      return null
    }
    const path = await runProbeCommands(input)
    cache.set(input.sessionId, { watermark: input.watermark, path })
    return path
  }

  async function runProbeCommands(input: {
    readonly sessionId: string
    readonly tty?: string
    readonly pid?: number
  }): Promise<string | null> {
    try {
      const pid = (input.tty ? await foregroundPid(input.tty) : null) ?? input.pid ?? null
      if (pid === null) return null
      const result = await deps.processRunner.run({
        actor,
        action: PROBE_ACTION,
        command: "lsof",
        args: ["-a", "-d", "cwd", "-p", String(pid), "-Fn"],
        timeoutMs,
        output: { stdout: "buffer", stderr: "ignore" },
        metadata: { source: PROBE_SOURCE, sessionId: input.sessionId },
      })
      // 进程已经退出了：lsof 非零退出加空输出，这不是错误，就是没有答案。
      return parseLsofCwd(result.stdout ?? "")
    } catch (error) {
      // 兜底失败不是错误：阶段 1 的结果仍然有效，调用方拿会话启动目录就好。
      deps.logger?.warn("Terminal working directory probe failed.", { sessionId: input.sessionId, error })
      return null
    }
  }

  async function foregroundPid(tty: string): Promise<number | null> {
    try {
      const result = await deps.processRunner.run({
        actor,
        action: PROBE_ACTION,
        command: "ps",
        args: ["-t", tty, "-o", "pid=", "-o", "stat="],
        timeoutMs,
        output: { stdout: "buffer", stderr: "ignore" },
        metadata: { source: PROBE_SOURCE },
      })
      return parseForegroundPid(result.stdout ?? "")
    } catch (error) {
      deps.logger?.warn("Terminal working directory probe could not list the tty.", { tty, error })
      return null
    }
  }

  function recordAudit(
    outcome: "denied" | "failed",
    resource: string,
    sessionId: string,
    metadata: Record<string, unknown>,
  ): void {
    deps.auditSink.record({
      action: PROBE_ACTION,
      actor,
      resource,
      outcome,
      metadata: { source: PROBE_SOURCE, sessionId, ...metadata },
    })
  }

  return {
    read,
    probe,
    forget: (sessionId) => {
      cache.delete(sessionId)
    },
  }
}

/** 窄动作：受控执行器只接受这一个，别的一律不从这里出去。 */
const PROBE_ACTION = "process.cwd_probe" as const

/**
 * `ps -t <tty> -o pid= -o stat=` 的解析。
 *
 * 同一台设备上可能挂着好几个进程（shell 自己、正在跑的前台程序）。`stat` 里的 `+` 是
 * 「在这个控制终端的前台进程组里」，优先取它；没有标记就取第一个 —— 也就是 PTY 子进程
 * 自己，它的 cwd 正是用户 `cd` 到的那个目录。
 */
export function parseForegroundPid(stdout: string): number | null {
  let first: number | null = null
  for (const line of stdout.split("\n")) {
    const [pidText, stat] = line.trim().split(/\s+/)
    if (!pidText) continue
    const pid = Number.parseInt(pidText, 10)
    if (!Number.isSafeInteger(pid)) continue
    if (first === null) first = pid
    if (stat?.includes("+")) return pid
  }
  return first
}

/** `lsof -Fn` 的输出里，`n` 开头的那一行就是路径。 */
export function parseLsofCwd(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    if (line.startsWith("n") && line.length > 1) return line.slice(1)
  }
  return null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
