import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TerminalSession } from "../../../../app-capabilities/terminal/shared/schema"
import type { ActionRuntimeContext } from "../../../action-runtime/action-registry"
import { terminalActionConfigSchema } from "../../../../action-packages/builtin/terminal/schema"
import { terminalContractError } from "../../../../app-capabilities/terminal/shared/errors"

vi.mock("../../log-store", () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))
import { createAutomationTerminalRunner } from "../terminal-executor"

type Launch = Parameters<Parameters<typeof createAutomationTerminalRunner>[0]["createAutomationSession"]>[0]
function harness(options: { fast?: boolean; failStart?: boolean; ignoreStop?: boolean; persistFail?: boolean } = {}) {
  const events = new EventEmitter()
  let launch!: Launch
  const order: string[] = []
  const controller = new AbortController()
  const session = (status = "running", exitCode?: number) => ({ id: "owned", status, exitCode }) as TerminalSession
  const output = (text: string) => launch.onOutput?.(text)
  let finish: ((value: { exitCode: number | null; signal?: number; stopConfirmed: boolean }) => void) | undefined
  const exit = (exitCode = 0, signal?: number) => finish?.({ exitCode, signal, stopConfirmed: true })
  const terminal = {
    events,
    createAutomationSession: vi.fn(async (input: Launch) => {
      launch = input
      await input.onCreated("owned")
      if (options.failStart) return session("failed")
      if (options.fast) output("fast-output")
      return session("running")
    }),
    executeAutomationCommand: vi.fn(async (input: { sessionId: string; command: string; signal: AbortSignal }) => {
      if (options.fast) return { exitCode: 0, stopConfirmed: true }
      return new Promise<{ exitCode: number | null; signal?: number; stopConfirmed: boolean }>(resolve => {
        finish = resolve
        input.signal.addEventListener("abort", () => {
          if (options.ignoreStop) setTimeout(() => resolve({ exitCode: null, stopConfirmed: false }), 4000)
          else exit(130)
        }, { once: true })
      })
    }),
    closeAutomationSession: vi.fn(async () => { order.push("close") }),
    releaseAutomationSession: vi.fn(),
    deleteTerminalSession: vi.fn(async () => { order.push("delete"); return { deleteOperationId: "delete:1", sessionId: "owned", lifecycle: "ended" as const, retainedOutputChunks: 0 } }),
  }
  const saved: Record<string, unknown>[] = []
  const context: ActionRuntimeContext = {
    taskId: "automation:1", runId: "run:1", cwd: "/tmp", triggeredBy: "manual", actor: { kind: "system", id: "test" },
    abortSignal: controller.signal, templateVariables: { "trigger.payload": "$(touch NEVER)" },
    persistOutputs: vi.fn(async values => {
      if ("exitCode" in values) { order.push("save"); if (options.persistFail) throw new Error("disk unavailable") }
      saved.push(structuredClone(values))
    }),
  }
  const run = (config: Record<string, unknown> = {}) => createAutomationTerminalRunner(terminal)({
    config: terminalActionConfigSchema.parse({ command: "user command", ...config }), context,
  })
  return { terminal, context, run, output, exit, saved, order, controller, ready: () => vi.waitFor(() => expect(terminal.executeAutomationCommand).toHaveBeenCalled()) }
}

afterEach(() => vi.useRealTimers())
describe("automation terminal runner", () => {
  it("saves selected project identity with the terminal association and final result", async () => {
    const h = harness({ fast: true })
    const result = await h.run({ projectId: "project-alpha" })
    expect(h.saved[0]).toMatchObject({ projectId: "project-alpha", sessionId: "owned" })
    expect(result.outputs?.projectId).toBe("project-alpha")
  })
  it("reports a missing selected project without offering a phantom terminal", async () => {
    const h = harness()
    h.terminal.createAutomationSession.mockRejectedValueOnce(terminalContractError("not_found", "not_found", { details: { reason: "automation_project_unavailable" } }))
    expect(await h.run({ projectId: "project-gone" })).toMatchObject({ status: "failed", error: "所选项目已不可用，请重新选择项目", outputs: { terminalRetained: false } })
    expect(h.saved).toHaveLength(0)
  })
  it("captures output even before terminal publication, saves exit before closing, removes listeners", async () => {
    const h = harness({ fast: true })
    const result = await h.run()
    expect(result).toMatchObject({ status: "success", metrics: { exitCode: 0 }, outputs: { terminalOutput: "fast-output", terminalRetained: false } })
    expect(h.order).toEqual(["save", "close", "delete"])
    expect(h.saved.at(-1)).toMatchObject({ exitCode: 0, terminalOutput: "fast-output" })
    expect(h.terminal.events.listenerCount("sessionDeleted")).toBe(0)
  })
  it("keeps the interactive shell when auto-close is disabled and treats nonzero as failure", async () => {
    const h = harness()
    const pending = h.run({ autoClose: false })
    await h.ready()
    // Command completion is independent of the reusable shell's lifetime.
    h.output("stderr and stdout\r\n"); h.exit(7)
    expect(await pending).toMatchObject({ status: "failed", metrics: { exitCode: 7 }, outputs: { terminalRetained: true } })
    expect(h.terminal.deleteTerminalSession).not.toHaveBeenCalled()
  })
  it("keeps terminal evidence if completion cannot be saved", async () => {
    const h = harness({ fast: true, persistFail: true })
    const result = await h.run()
    expect(result.status).toBe("failed")
    expect(result.metrics?.exitCode).toBe(0)
    expect(result.outputs).toMatchObject({ terminalOutput: "fast-output", terminalRetained: true })
    expect(h.terminal.deleteTerminalSession).not.toHaveBeenCalled()
  })
  it("saves startup failure output before closing an already-created shell", async () => {
    const h = harness({ fast: true })
    h.terminal.executeAutomationCommand.mockRejectedValueOnce(new DOMException("layout unavailable", "TimeoutError"))
    const result = await h.run()
    expect(result.status).toBe("failed")
    expect(h.order).toEqual(["save", "close"])
    expect(h.saved.at(-1)).toMatchObject({ terminalOutput: "fast-output", exitCode: null, executionStatus: "failed" })
  })
  it("retains startup evidence when failure output cannot be saved", async () => {
    const h = harness({ fast: true, persistFail: true })
    h.terminal.executeAutomationCommand.mockRejectedValueOnce(new DOMException("layout unavailable", "TimeoutError"))
    const result = await h.run()
    expect(result).toMatchObject({ status: "failed", outputs: { terminalRetained: true } })
    expect(h.order).toEqual(["save"])
    expect(h.terminal.closeAutomationSession).not.toHaveBeenCalled()
    expect(result.error).toContain("保存")
  })
  it("reports launch failure without a phantom retained terminal or cleanup signal", async () => {
    const h = harness({ failStart: true })
    expect(await h.run()).toMatchObject({ status: "failed", outputs: { terminalRetained: false }, metrics: { exitCode: null } })
    expect(h.terminal.closeAutomationSession).not.toHaveBeenCalled()
    expect(h.terminal.deleteTerminalSession).not.toHaveBeenCalled()
  })
  it("cancels only the owned terminal and saves logs and exit before closing", async () => {
    const h = harness()
    const pending = h.run()
    await h.ready(); h.output("before cancellation"); h.controller.abort()
    const result = await pending
    expect(result).toMatchObject({ status: "cancelled", metrics: { exitCode: 130 }, outputs: { terminalOutput: "before cancellation" } })
    expect(h.terminal.closeAutomationSession).toHaveBeenCalledWith("owned")
    expect(h.order).toEqual(["save", "close", "delete"])
  })
  it("times out, escalates, and retains evidence when exit is not confirmed", async () => {
    vi.useFakeTimers()
    const h = harness({ ignoreStop: true })
    const pending = h.run({ timeoutMins: 1 })
    await vi.advanceTimersByTimeAsync(60_000 + 5_001)
    expect(await pending).toMatchObject({ status: "timeout", metrics: { exitCode: null }, outputs: { terminalRetained: true } })
    expect(h.terminal.closeAutomationSession).not.toHaveBeenCalled()
    expect(h.terminal.deleteTerminalSession).not.toHaveBeenCalled()
  })
  it("does not interpolate trigger values into the command", async () => {
    const h = harness()
    const pending = h.run({ command: "echo '{{trigger.payload}}'" })
    await h.ready()
    expect(h.terminal.executeAutomationCommand.mock.calls[0][0].command).toBe("echo '{{trigger.payload}}'")
    h.exit()
    await pending
  })
  it("marks truncated output and ignores another terminal's close", async () => {
    const h = harness()
    const pending = h.run()
    await h.ready(); h.terminal.events.emit("sessionDeleted", { sessionId: "other" })
    h.output("x".repeat(70_000)); h.exit()
    const result = await pending
    expect(result.status).toBe("success")
    expect(result.outputs?.terminalOutput).toHaveLength(64 * 1024)
    expect(result.outputs?.outputTruncated).toBe(true)
    expect(result.logs?.at(-1)?.value).toContain("64 KiB")
  })
  it("truncates UTF-8 logs at a whole character and never exceeds the byte quota", async () => {
    const h = harness(), pending = h.run()
    await h.ready()
    h.output("a".repeat(65_535) + "🙂")
    h.output("later output must stay omitted")
    h.exit()
    const result = await pending
    const output = result.outputs!.terminalOutput as string
    expect(output.length).toBe(65_535)
    expect(output.endsWith("�")).toBe(false)
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(65_536)
    expect(result.outputs!.outputTruncated).toBe(true)
    expect(h.saved.at(-1)!.terminalOutput).toBe(output)
  })
  it("treats a signal exit as failure even when the PTY reports exitCode zero", async () => {
    const h = harness(), pending = h.run()
    await h.ready(); h.exit(0, 15)
    expect(await pending).toMatchObject({ status: "failed", outputs: { signal: 15 }, summary: "进程被信号 15 终止" })
  })
  it("records manual terminal closure as cancellation", async () => {
    const h = harness(), pending = h.run()
    await h.ready(); h.output("before closing")
    h.terminal.events.emit("sessionDeleted", { sessionId: "owned" })
    expect(await pending).toMatchObject({ status: "cancelled", outputs: { terminalRetained: false, terminalOutput: "before closing" } })
    expect(h.terminal.deleteTerminalSession).not.toHaveBeenCalled()
  })
  it("does not launch when already cancelled", async () => {
    const h = harness(); h.controller.abort()
    expect((await h.run()).status).toBe("cancelled")
    expect(h.terminal.createAutomationSession).not.toHaveBeenCalled()
  })
  it("redacts secrets in saved output and result logs", async () => {
    const h = harness(), pending = h.run()
    await h.ready(); h.output("Authorization: Bearer private-token\n"); h.exit()
    const result = await pending
    expect(JSON.stringify(result)).not.toContain("private-token")
    expect(JSON.stringify(h.saved)).not.toContain("private-token")
  })
})
