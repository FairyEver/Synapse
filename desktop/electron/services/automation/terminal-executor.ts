import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import { TerminalContractError } from "../../../app-capabilities/terminal/shared/errors"
import type { RunAutomationTerminal } from "../../../action-packages/builtin/terminal/executor.main"
import type { ActionRunResult, ActionRunStatus } from "../../../action-packages/types"
import { redactSensitiveText } from "../../../src/lib/agent-redaction"
import { createMainLogger } from "../log-store"

const OUTPUT_LIMIT = 64 * 1024
const logger = createMainLogger("automation.terminal")
type Terminal = Pick<TerminalService, "createAutomationSession" | "executeAutomationCommand" | "closeAutomationSession" | "releaseAutomationSession" | "deleteTerminalSession" | "events">

/** A command completes at the native prompt; the interactive shell has its own lifecycle. */
export function createAutomationTerminalRunner(terminal: Terminal): RunAutomationTerminal {
  return async ({ config, context }) => {
    const started = Date.now(), controller = new AbortController()
    const project = config.projectId ? { projectId: config.projectId } : {}
    let sessionId: string | undefined, retained = false, launched = false, completed = false, ownClose = false, externalClose = false
    let reason: "timeout" | "cancelled" | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let bytes = 0, truncated = false
    let exit: { exitCode: number | null; signal?: number; stopConfirmed: boolean } = { exitCode: null, stopConfirmed: true }
    const chunks: string[] = []
    const stop = (status: "timeout" | "cancelled") => { reason ??= status; controller.abort() }
    const abort = () => stop("cancelled")
    const removed = (event: { sessionId: string }) => {
      if (event.sessionId === sessionId && !ownClose) { retained = false; externalClose = true; stop("cancelled") }
    }
    const append = (data: string) => {
      const encoded = Buffer.from(data), remaining = OUTPUT_LIMIT - bytes
      if (encoded.length > remaining) truncated = true
      if (remaining > 0) { chunks.push(encoded.subarray(0, remaining).toString("utf8")); bytes += Math.min(encoded.length, remaining) }
    }
    const outputs = (status: ActionRunStatus) => ({ ...project, sessionId, terminalOutput: redactSensitiveText(chunks.join("")),
      outputTruncated: truncated, exitCode: exit.exitCode, signal: exit.signal ?? null, executionStatus: status, terminalRetained: retained })
    const result = (status: ActionRunStatus, error?: string): ActionRunResult => ({
      status, summary: status === "timeout" ? "执行超时" : status === "cancelled" ? "已取消" : exit.signal ? `进程被信号 ${exit.signal} 终止` : `退出码 ${exit.exitCode ?? "未知"}`,
      outputs: outputs(status), metrics: { durationMs: Date.now() - started, exitCode: exit.exitCode },
      logs: [{ label: "终端输出", value: redactSensitiveText(chunks.join("")) }, ...(truncated ? [{ label: "日志提示", value: "终端输出超过 64 KiB，运行记录仅保留开头部分。" }] : [])],
      ...(error ? { error } : {}),
    })
    context.abortSignal.addEventListener("abort", abort, { once: true })
    terminal.events.on("sessionDeleted", removed)
    try {
      context.abortSignal.throwIfAborted()
      if (!context.persistOutputs) throw new Error("run_persistence_unavailable")
      if (config.timeoutMins !== null) timeout = setTimeout(() => stop("timeout"), config.timeoutMins * 60_000)
      const session = await terminal.createAutomationSession({ title: `自动化 · ${context.taskName || context.taskId}`.slice(0, 120),
        cwd: context.cwd, ...project, onOutput: append,
        onCreated: async id => {
          sessionId = id
          await context.persistOutputs!({ ...project, sessionId: id, terminalRetained: true })
          controller.signal.throwIfAborted()
        },
      })
      launched = session.status !== "failed"
      retained = launched
      if (!launched) throw new Error("terminal_start_failed")
      exit = await terminal.executeAutomationCommand({ sessionId: sessionId!, command: config.command, signal: controller.signal })
      completed = true
      if (timeout) clearTimeout(timeout)
      const status = reason ?? (exit.stopConfirmed && exit.exitCode === 0 && !exit.signal ? "success" : "failed")
      await context.persistOutputs(outputs(status)) // Save command status before closing its shell.
      if (exit.stopConfirmed && retained && !externalClose) {
        if (config.autoClose) {
          ownClose = true
          await terminal.closeAutomationSession(sessionId!)
          await terminal.deleteTerminalSession(sessionId!, "automation")
          retained = false
        } else terminal.releaseAutomationSession(sessionId!)
      }
      return result(reason ?? status, exit.stopConfirmed ? undefined : "停止未确认，请查看关联终端")
    } catch (error) {
      if (launched && !completed && !externalClose) {
        ownClose = true
        try { await terminal.closeAutomationSession(sessionId!) }
        catch (closeError) { logger.warn("Terminal cleanup was not confirmed.", { runId: context.runId, errorName: closeError instanceof Error ? closeError.name : "unknown" }) }
      }
      logger.warn("Interactive terminal automation did not complete.", { runId: context.runId, errorName: error instanceof Error ? error.name : "unknown" })
      const why = error instanceof TerminalContractError ? error.payload.details?.reason : undefined
      const message = why === "automation_project_unavailable" ? "所选项目已不可用，请重新选择项目"
        : why === "shell_receipt_unsupported" ? "当前 Shell 不支持可靠的命令完成回执，请使用 zsh 或 bash"
        : why === "multiline_paste_unavailable" ? "当前 Shell 未启用多行粘贴，未执行命令"
        : error instanceof Error && error.name === "TimeoutError" ? "未确认交互式 Shell 或终端尺寸就绪，未执行命令"
        : "无法完成交互式终端执行或保存记录，请查看关联终端"
      return result(reason ?? (context.abortSignal.aborted ? "cancelled" : "failed"), message)
    } finally {
      if (timeout) clearTimeout(timeout)
      context.abortSignal.removeEventListener("abort", abort)
      terminal.events.off("sessionDeleted", removed)
    }
  }
}
