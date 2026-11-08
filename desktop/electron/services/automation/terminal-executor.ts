import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import type { TerminalSession } from "../../../app-capabilities/terminal/shared/schema"
import { TerminalContractError } from "../../../app-capabilities/terminal/shared/errors"
import type { RunAutomationTerminal } from "../../../action-packages/builtin/terminal/executor.main"
import type { ActionRunResult } from "../../../action-packages/types"
import { redactSensitiveText } from "../../../src/lib/agent-redaction"
import { createMainLogger } from "../log-store"

const OUTPUT_LIMIT = 64 * 1024
const STOP_GRACE_MS = 2_000
// Leave time for durable completion within the service registry's 5s shutdown budget.
const STOP_CONFIRM_MS = 4_000
const logger = createMainLogger("automation.terminal")
type Exit = { exitCode: number | null; signal?: number; externalClose?: boolean }
type Terminal = Pick<TerminalService, "createAutomationSession" | "events" | "signalAutomationSession" | "deleteTerminalSession">

/** The terminal owns the process; the action owns durable completion and release. */
export function createAutomationTerminalRunner(terminal: Terminal): RunAutomationTerminal {
  return async ({ config, context }) => {
    const started = Date.now()
    const project = config.projectId ? { projectId: config.projectId } : {}
    let sessionId: string | undefined
    let launched = false
    let retained = false
    let finalExit: Exit | undefined
    let settled = false
    let reason: "timeout" | "cancelled" | undefined
    let stopError = false
    let truncated = false
    let bytes = 0
    const chunks: string[] = []
    let complete!: (exit: Exit) => void
    const ended = new Promise<Exit>(resolve => { complete = exit => { if (!settled) { settled = true; finalExit = exit; resolve(exit) } } })
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let confirmTimer: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined

    const append = (text: string) => {
      const data = Buffer.from(text, "utf8"), remaining = OUTPUT_LIMIT - bytes
      if (data.length > remaining) truncated = true
      if (remaining > 0) { chunks.push(data.subarray(0, remaining).toString("utf8")); bytes += Math.min(data.length, remaining) }
    }
    const changed = (session: TerminalSession) => {
      if (session.id !== sessionId || !["ended", "failed", "lost"].includes(session.status)) return
      complete({ exitCode: session.exitCode ?? null, signal: session.signal })
    }
    const removed = (event: { sessionId: string }) => {
      if (event.sessionId === sessionId) { retained = false; complete({ exitCode: null, externalClose: true }) }
    }
    const signal = (force = false) => {
      if (!sessionId) return false
      try { return terminal.signalAutomationSession(sessionId, force) }
      catch (error) {
        stopError = true
        logger.warn("Automation terminal termination was not confirmed.", { runId: context.runId, sessionId, force, errorName: error instanceof Error ? error.name : "unknown", errorCode: (error as NodeJS.ErrnoException)?.code })
        return false
      }
    }
    const stop = (status: "timeout" | "cancelled") => {
      reason ??= status
      if (!sessionId || !launched || settled || forceTimer) return
      signal()
      forceTimer = setTimeout(() => { if (!settled) signal(true) }, STOP_GRACE_MS)
      confirmTimer = setTimeout(() => { stopError = true; complete({ exitCode: null }) }, STOP_CONFIRM_MS)
    }
    const abort = () => stop("cancelled")
    terminal.events.on("sessionChanged", changed)
    terminal.events.on("sessionDeleted", removed)
    context.abortSignal.addEventListener("abort", abort, { once: true })

    try {
      context.abortSignal.throwIfAborted()
      if (!context.persistOutputs) throw new Error("运行记录无法保存")
      if (config.timeoutMins !== null) timeout = setTimeout(() => stop("timeout"), config.timeoutMins * 60_000)
      const created = await terminal.createAutomationSession({
        title: `自动化 · ${context.taskName || context.taskId}`.slice(0, 120), cwd: context.cwd, command: config.command,
        ...project,
        onOutput: append, onExited: exit => complete(exit),
        onCreated: async id => {
          sessionId = id
          await context.persistOutputs!({ ...project, sessionId: id, terminalRetained: true })
          if (context.abortSignal.aborted || reason) throw new Error("执行在启动前已停止")
        },
      })
      launched = created.status !== "failed"
      retained = launched
      if (created.status !== "running") changed(created)
      if (context.abortSignal.aborted || reason) stop(reason ?? "cancelled")
      const exit = await ended
      if (timeout) clearTimeout(timeout)
      if (forceTimer) clearTimeout(forceTimer)
      if (confirmTimer) clearTimeout(confirmTimer)
      // The shell may exit before its ordinary background children. Reap its remaining group too.
      if (launched && !exit.externalClose && !stopError) {
        if (reason) signal(true)
        else if (signal()) {
          await new Promise(resolve => setTimeout(resolve, STOP_GRACE_MS))
          signal(true)
        }
      }
      const status = reason ?? (exit.externalClose ? "cancelled" : stopError || exit.exitCode !== 0 || Boolean(exit.signal) ? "failed" : "success")
      const terminalOutput = redactSensitiveText(chunks.join(""))
      const outputs = { ...project, sessionId, terminalOutput, outputTruncated: truncated, exitCode: exit.exitCode, signal: exit.signal ?? null,
        executionStatus: status, terminalRetained: retained }
      const summary = status === "timeout" ? "执行超时" : status === "cancelled" ? "已取消" : exit.signal ? `进程被信号 ${exit.signal} 终止` : `退出码 ${exit.exitCode ?? "未知"}`
      const result: ActionRunResult = {
        status, summary, outputs, metrics: { durationMs: Date.now() - started, exitCode: exit.exitCode },
        logs: [{ label: "终端输出", value: terminalOutput }, ...(truncated ? [{ label: "日志提示", value: "终端输出超过 64 KiB，运行记录仅保留开头部分。" }] : [])],
        ...(stopError ? { error: "停止未确认，请查看关联终端" } : {}),
      }
      // This is intentionally before deletion, including cancellation and nonzero exits.
      await context.persistOutputs(outputs)
      if (config.autoClose && retained && !stopError && !exit.externalClose) {
        await terminal.deleteTerminalSession(sessionId!, "automation")
        retained = false
        outputs.terminalRetained = false
      }
      return result
    } catch (error) {
      // No failure path may silently leave a newly started command running.
      if (launched && sessionId && !settled) {
        stop(context.abortSignal.aborted ? "cancelled" : reason ?? "cancelled")
        await ended
      }
      logger.warn("Automation terminal execution failed.", { runId: context.runId, sessionId, errorName: error instanceof Error ? error.name : "unknown" })
      const projectUnavailable = error instanceof TerminalContractError && error.payload.details?.reason === "automation_project_unavailable"
      return { status: reason ?? (context.abortSignal.aborted ? "cancelled" : "failed"), summary: "终端执行未完成", error: projectUnavailable ? "所选项目已不可用，请重新选择项目" : "无法完成终端执行或保存记录，请查看关联终端",
        outputs: { ...project, sessionId, terminalOutput: redactSensitiveText(chunks.join("")), terminalRetained: retained, outputTruncated: truncated,
          exitCode: finalExit?.exitCode ?? null, signal: finalExit?.signal ?? null },
        logs: [{ label: "终端输出", value: redactSensitiveText(chunks.join("")) }],
        metrics: { durationMs: Date.now() - started, exitCode: finalExit?.exitCode ?? null } }
    } finally {
      if (timeout) clearTimeout(timeout)
      if (forceTimer) clearTimeout(forceTimer)
      if (confirmTimer) clearTimeout(confirmTimer)
      context.abortSignal.removeEventListener("abort", abort)
      terminal.events.off("sessionChanged", changed)
      terminal.events.off("sessionDeleted", removed)
    }
  }
}
