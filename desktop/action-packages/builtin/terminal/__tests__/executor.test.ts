import { describe, expect, it, vi } from "vitest"
import { terminalActionConfigSchema } from "../schema"
import { createTerminalAction } from "../executor.main"

describe("terminal automation action", () => {
  it("accepts an optional configured project and scopes authorization to it", () => {
    const config = terminalActionConfigSchema.parse({ command: "node custom.js", projectId: "project-alpha" })
    const action = createTerminalAction({ run: vi.fn() })
    const context = { taskId: "a", runId: "r", cwd: "/unrelated", actor: { kind: "user" as const, id: "automation" }, triggeredBy: "manual" as const, abortSignal: new AbortController().signal }
    expect(action.buildPermissionRequest({ config, context })).toMatchObject({ resource: "terminal-project:project-alpha", context: { projectId: "project-alpha" } })
  })
  it("accepts arbitrary commands and defaults to closing after completion", () => {
    expect(terminalActionConfigSchema.parse({ command: "python3 custom.py && node other.mjs" })).toEqual({ command: "python3 custom.py && node other.mjs", autoClose: true, timeoutMins: 30 })
    expect(terminalActionConfigSchema.parse({ command: "my-custom-program", autoClose: false, timeoutMins: null })).toMatchObject({ autoClose: false, timeoutMins: null })
    expect(() => terminalActionConfigSchema.parse({ command: "  " })).toThrow()
    expect(() => terminalActionConfigSchema.parse({ command: "ok", autoClose: "true" })).toThrow()
  })

  it("passes literal command text and trigger input separately, under shell permission", async () => {
    const run = vi.fn(async () => ({ status: "success" as const, metrics: { exitCode: 0 } }))
    const action = createTerminalAction({ run })
    const input = { config: terminalActionConfigSchema.parse({ command: "echo '{{trigger.untrusted}}'" }), context: {
      taskId: "a", runId: "r", cwd: "/tmp", actor: { kind: "user" as const, id: "automation" }, triggeredBy: "manual" as const,
      abortSignal: new AbortController().signal, triggerInput: { text: "$(touch unwanted)" }, persistOutputs: vi.fn(),
    } }
    expect(action.buildPermissionRequest(input)).toMatchObject({ action: "shell.exec", resource: "/tmp" })
    expect(await action.execute(input)).toMatchObject({ metrics: { exitCode: 0 } })
    expect(run).toHaveBeenCalledWith(input)
  })
})
