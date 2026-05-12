import { describe, expect, it, vi } from "vitest"

import { createScriptAction } from "../executor.main"

describe("builtin.script executor", () => {
  it("runs script config through the selected shell", async () => {
    const run = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "bad",
      timedOut: false,
      durationMs: 7,
    }))
    const action = createScriptAction({
      processRunner: { run },
      platform: "darwin",
    })

    const result = await action.execute({
      config: {
        script: "exit 1",
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

    expect(result.status).toBe("failed")
    expect(result.error).toBe("shell command exited with 1")
    expect(result.logs).toEqual([{ label: "stderr", value: "bad" }])
    expect(result.outputs).toEqual({ stdout: "", stderr: "bad", exitCode: 1 })
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
    const action = createScriptAction({
      processRunner: { run },
      platform: "darwin",
    })

    await action.execute({
      config: {
        script: "echo ok",
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
    const action = createScriptAction({
      processRunner: { run },
      platform: "darwin",
    })

    await action.execute({
      config: {
        script: "echo ok",
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
    const action = createScriptAction({
      processRunner: { run },
      platform: "darwin",
    })

    await action.execute({
      config: {
        script: "echo ok",
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
})
