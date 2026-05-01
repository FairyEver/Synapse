import { describe, expect, it, vi } from "vitest"

import { createCommandAction } from "../executor.main"

describe("builtin.command executor", () => {
  it("runs command config and stores stdout/stderr in ActionRunResult", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      durationMs: 12,
    }))
    const action = createCommandAction({
      processRunner: { run },
      platform: "darwin",
      baseEnv: { PATH: "/usr/bin" },
    })

    const result = await action.execute({
      config: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 1,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "manual",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(result).toEqual({
      status: "success",
      summary: "退出码 0",
      logs: [{ label: "stdout", value: "ok" }],
      outputs: { stdout: "ok", stderr: "", exitCode: 0 },
      metrics: { durationMs: 12, exitCode: 0 },
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      command: "/bin/sh",
      args: ["-lc", "echo ok"],
      cwd: "/tmp",
    }))
  })

  it("builds shell.exec permission context", () => {
    const action = createCommandAction({ processRunner: { run: vi.fn() } })
    const request = action.buildPermissionRequest({
      config: { command: "echo ok", shell: "posix", env: { TOKEN: "x" }, timeoutMins: 5 },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(request).toEqual(expect.objectContaining({
      action: "shell.exec",
      resource: "echo ok",
      context: expect.objectContaining({
        actionType: "builtin.command",
        taskId: "task:1",
        runId: "run:1",
        shell: "posix",
        cwd: "/tmp",
        envKeys: ["TOKEN"],
        timeoutMins: 5,
      }),
    }))
  })
})
