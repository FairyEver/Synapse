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
})
