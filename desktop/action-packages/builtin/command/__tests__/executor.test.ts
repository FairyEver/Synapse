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

  it("does not spread baseEnv/process.env into env so buildAllowedEnv can resolve shell PATH", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }))
    const action = createCommandAction({
      processRunner: { run },
      platform: "darwin",
      baseEnv: { PATH: "/usr/bin", HOME: "/Users/test" },
    })

    await action.execute({
      config: {
        command: "node -v",
        shell: "posix",
        timeoutMins: 1,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callEnv = (run.mock.calls as any)[0][0].env
    // env must NOT contain baseEnv keys — buildAllowedEnv handles PATH resolution
    // and process.env fallback internally. Leaking process.env here defeats the
    // shell PATH fallback that resolves nvm/homebrew paths on macOS.
    expect(callEnv).toBeUndefined()
  })

  it("passes user-specified config.env through without spreading process.env", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }))
    const action = createCommandAction({
      processRunner: { run },
      platform: "darwin",
      baseEnv: { PATH: "/usr/bin" },
    })

    await action.execute({
      config: {
        command: "echo $TOKEN",
        shell: "posix",
        timeoutMins: 1,
        env: { TOKEN: "secret" },
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callEnv = (run.mock.calls as any)[0][0].env
    // Only user-specified env, no process.env/baseEnv leakage
    expect(callEnv).toEqual({ TOKEN: "secret" })
  })

  it("passes pathStrategy through to processRunner.run", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }))
    const action = createCommandAction({
      processRunner: { run },
      platform: "darwin",
    })

    await action.execute({
      config: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 1,
        pathStrategy: "replace",
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ pathStrategy: "replace" }),
    )
  })

  it("passes posixLogin through to resolveShellCommand", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }))
    const action = createCommandAction({
      processRunner: { run },
      platform: "darwin",
    })

    await action.execute({
      config: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 1,
        posixLogin: false,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["-c", "echo ok"] }),
    )
  })

  it("defaults to -lc when posixLogin is undefined", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }))
    const action = createCommandAction({
      processRunner: { run },
      platform: "darwin",
    })

    await action.execute({
      config: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 1,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["-lc", "echo ok"] }),
    )
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
      resource: "builtin.command",
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
