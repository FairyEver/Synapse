import { describe, expect, it, vi } from "vitest"

import type { ControlledProcessResult } from "../../../runtime/process"
import type { ScheduledTaskEntryV1 } from "../types"
import { ShellTaskAction } from "../shell-action"

describe("ShellTaskAction", () => {
  it("uses /bin/sh on non-Windows platforms", async () => {
    const runner = { run: vi.fn(async () => processResult({ stdout: "ok" })) }
    const action = new ShellTaskAction({ processRunner: runner as never, platform: "darwin" })

    const result = await action.execute({
      task: createTask({ content: "echo ok" }),
      runId: "run:1",
      cwd: "/tmp",
      abortSignal: new AbortController().signal,
    })

    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
      command: "/bin/sh",
      args: ["-lc", "echo ok"],
      cwd: "/tmp",
      action: "shell.exec",
    }))
    expect(result.status).toBe("success")
  })

  it("uses cmd.exe on Windows", async () => {
    const runner = { run: vi.fn(async () => processResult({ stdout: "ok" })) }
    const action = new ShellTaskAction({ processRunner: runner as never, platform: "win32" })

    await action.execute({
      task: createTask({ content: "echo ok" }),
      runId: "run:1",
      cwd: "C:\\tmp",
      abortSignal: new AbortController().signal,
    })

    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "echo ok"],
    }))
  })

  it("maps non-zero exits to failed", async () => {
    const runner = { run: vi.fn(async () => processResult({ exitCode: 2, stderr: "nope" })) }
    const action = new ShellTaskAction({ processRunner: runner as never, platform: "darwin" })

    const result = await action.execute({
      task: createTask({ content: "exit 2" }),
      runId: "run:1",
      cwd: "/tmp",
      abortSignal: new AbortController().signal,
    })

    expect(result.status).toBe("failed")
    expect(result.error).toContain("2")
  })

  it("maps process timeouts to timeout", async () => {
    const runner = { run: vi.fn(async () => processResult({ timedOut: true, signal: "SIGTERM" })) }
    const action = new ShellTaskAction({ processRunner: runner as never, platform: "darwin" })

    const result = await action.execute({
      task: createTask({ content: "sleep 60" }),
      runId: "run:1",
      cwd: "/tmp",
      abortSignal: new AbortController().signal,
    })

    expect(result.status).toBe("timeout")
  })

  it("maps aborted process termination to cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    const runner = { run: vi.fn(async () => processResult({ signal: "SIGTERM" })) }
    const action = new ShellTaskAction({ processRunner: runner as never, platform: "darwin" })

    const result = await action.execute({
      task: createTask({ content: "sleep 60" }),
      runId: "run:1",
      cwd: "/tmp",
      abortSignal: controller.signal,
    })

    expect(result.status).toBe("cancelled")
  })
})

function processResult(overrides: Partial<ControlledProcessResult> = {}): ControlledProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1,
    ...overrides,
  }
}

function createTask(action: { readonly content: string }): ScheduledTaskEntryV1 {
  return {
    id: "task:1",
    schemaVersion: 1,
    name: "Build",
    scope: { type: "global" },
    trigger: { type: "interval", everyMinutes: 10 },
    action: {
      type: "shell_command",
      mode: "command",
      timeoutMins: 30,
      ...action,
    },
    enabled: true,
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    runCount: 0,
  }
}
