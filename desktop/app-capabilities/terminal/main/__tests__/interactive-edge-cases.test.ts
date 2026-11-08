import { appendFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createInteractiveTerminalRig as rig } from "./interactive-terminal-fixture"
import { createAutomationTerminalRunner } from "../../../../electron/services/automation/terminal-executor"
import type { ActionRuntimeContext } from "../../../../electron/action-runtime/action-registry"

vi.mock("../../../../electron/services/log-store", () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))
describe.skipIf(process.env.SYNAPSE_TERMINAL_REAL_PTY !== "1" || process.platform !== "darwin")("interactive terminal adversarial cases", () => {
  it.each(["zsh", "bash"] as const)("preserves %s heredocs, Unicode, tabs and long native command input", async shell => {
    const h = await rig(shell)
    const session = await h.service.createAutomationSession({ title: "edge", cwd: h.root, onCreated: async () => undefined })
    await h.ready(session.id)
    await h.service.resizeSession({ sessionId: session.id, cols: 140, rows: 35 })
    const run = (command: string) => h.service.executeAutomationCommand({ sessionId: session.id, command, signal: AbortSignal.timeout(8000) })
    expect(await run("cat <<'END_INPUT' > '中文 文件.txt'\n内容🙂\t保留制表\nEND_INPUT\ncat '中文 文件.txt'\n(exit 11)")).toMatchObject({ exitCode: 11 })
    const text = "x".repeat(12_000)
    expect(await run(`long_value='${text}'; printf 'COUNT:%s\\n' "${'${#long_value}'}"`)).toMatchObject({ exitCode: 0 })
    const lines = (await h.service.getView({ sessionId: session.id, kind: "scrollback", tailLines: 500, maxBytes: 128 * 1024 })).lines
    expect(lines.some(line => line.includes("内容🙂") && line.includes("保留制表"))).toBe(true)
    expect(lines).toContain("COUNT:12000")
    expect(await run("set -o pipefail; false | true")).toMatchObject({ exitCode: 1 })
    expect(await run("synapse_nonexistent_fixture_command")).toMatchObject({ exitCode: 127 })
  }, 25_000)
  it("does not lose command receipts when macOS Bash startup has an array PROMPT_COMMAND", async () => {
    const h = await rig("bash")
    await appendFile(path.join(h.root, "user-config", ".bash_profile"), "PROMPT_COMMAND=('printf USER_PROMPT_HOOK')\n")
    const session = await h.service.createAutomationSession({ title: "edge", cwd: h.root, onCreated: async () => undefined })
    await h.ready(session.id)
    await h.service.resizeSession({ sessionId: session.id, cols: 140, rows: 35 })
    expect(await h.service.executeAutomationCommand({ sessionId: session.id, command: "(exit 7)", signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 7 })
    const raw = h.service.readSession({ sessionId: session.id }).chunks.map(chunk => chunk.data).join("")
    expect(raw).toContain("USER_PROMPT_HOOK")
  }, 12_000)
  it.each(["zsh", "bash"] as const)("preserves literal paste-boundary bytes inside %s quoted command strings", async shell => {
    const h = await rig(shell)
    const session = await h.service.createAutomationSession({ title: "edge", cwd: h.root, onCreated: async () => undefined })
    await h.ready(session.id)
    await h.service.resizeSession({ sessionId: session.id, cols: 140, rows: 35 })
    const command = "printf '%s' 'a\x1b[201~b' | /usr/bin/od -An -tx1"
    expect(await h.service.executeAutomationCommand({ sessionId: session.id, command, signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 0 })
    const lines = (await h.service.getView({ sessionId: session.id, kind: "scrollback", tailLines: 100, maxBytes: 64 * 1024 })).lines
    expect(lines.map(line => line.trim().replace(/\s+/g, " ")).filter(line => /^[0-9a-f ]+$/.test(line) && line.includes("61"))).toEqual(["61 1b 5b 32 30 31 7e 62"])
  }, 12_000)
  it.each(["zsh", "bash"] as const)("preserves native multiline and ESC input with %s vi editing mode", async shell => {
    const h = await rig(shell)
    await appendFile(path.join(h.root, "user-config", shell === "zsh" ? ".zshrc" : ".bash_profile"), shell === "zsh" ? "bindkey -v\n" : "set -o vi\n")
    const session = await h.service.createAutomationSession({ title: "vi-edge", cwd: h.root, onCreated: async () => undefined })
    await h.ready(session.id)
    await h.service.resizeSession({ sessionId: session.id, cols: 140, rows: 35 })
    const command = "printf '%s' 'a\x1b[201~b' | /usr/bin/od -An -tx1\n(exit 4)"
    expect(await h.service.executeAutomationCommand({ sessionId: session.id, command, signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 4 })
    const lines = (await h.service.getView({ sessionId: session.id, kind: "scrollback", tailLines: 100, maxBytes: 64 * 1024 })).lines
    expect(lines.map(line => line.trim().replace(/\s+/g, " ")).filter(line => /^[0-9a-f ]+$/.test(line) && line.includes("61"))).toEqual(["61 1b 5b 32 30 31 7e 62"])
  }, 12_000)
  it("isolates five simultaneous full automation runs and closes only their own terminals", async () => {
    const h = await rig("zsh")
    const prime = await h.service.createSession({})
    await h.ready(prime.id)
    await h.service.resizeSession({ sessionId: prime.id, cols: 140, rows: 35 })
    const runner = createAutomationTerminalRunner(h.service)
    const results = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      const context: ActionRuntimeContext = { taskId: `edge-${index}`, runId: `edge-run-${index}`, cwd: h.root, triggeredBy: "manual", actor: { kind: "system", id: "test" }, abortSignal: AbortSignal.timeout(8000), persistOutputs: async () => undefined }
      return runner({ config: { command: `printf 'TASK:${index}\\n'; sleep 0.${index + 1}; (exit ${index % 2})`, autoClose: true, timeoutMins: null }, context })
    }))
    expect(new Set(results.map(result => result.outputs!.sessionId)).size).toBe(5)
    results.forEach((result, index) => {
      expect(result.status).toBe(index % 2 === 0 ? "success" : "failed")
      expect(result.outputs).toMatchObject({ exitCode: index % 2, terminalRetained: false })
      expect(result.outputs!.terminalOutput).toContain(`TASK:${index}\r\n`)
      for (let other = 0; other < 5; other++) if (other !== index) expect(result.outputs!.terminalOutput).not.toContain(`TASK:${other}\r\n`)
    })
    expect(h.service.listSessions().map(session => session.id)).toEqual([prime.id])
    expect(h.service.getSession({ sessionId: prime.id }).status).toBe("running")
  }, 15_000)
  it.each([false, true])("cancels during layout wait, saving evidence before close (save failure: %s)", async saveFails => {
    const h = await rig("zsh")
    const controller = new AbortController()
    let sessionId = "", savedFailure = false, closedAfterSave: boolean | undefined
    h.service.events.on("sessionChanged", session => {
      if (session.id === sessionId && session.status === "ended") closedAfterSave = savedFailure
    })
    const context: ActionRuntimeContext = { taskId: "layout-wait", runId: "layout-run", cwd: h.root, triggeredBy: "manual", actor: { kind: "system", id: "test" }, abortSignal: controller.signal,
      persistOutputs: async output => {
        sessionId = output.sessionId as string
        if ("exitCode" in output) {
          if (saveFails) throw new Error("disk unavailable")
          savedFailure = true
          expect(output).toMatchObject({ exitCode: null, executionStatus: "cancelled" })
        }
      },
    }
    const pending = createAutomationTerminalRunner(h.service)({ config: { command: "printf 'MUST_NOT_EXECUTE\\n'", autoClose: true, timeoutMins: null }, context })
    await vi.waitFor(() => expect(sessionId).not.toBe(""))
    await h.ready(sessionId)
    controller.abort()
    const result = await pending
    expect(result.status).toBe("cancelled")
    expect(h.service.readSession({ sessionId }).chunks.map(chunk => chunk.data).join("")).not.toContain("MUST_NOT_EXECUTE")
    if (saveFails) {
      expect(closedAfterSave).toBeUndefined()
      expect(h.service.getSession({ sessionId }).status).toBe("running")
      expect(result.error).toContain("保存")
    } else {
      expect(closedAfterSave).toBe(true)
      expect(h.service.getSession({ sessionId }).status).toBe("ended")
    }
  }, 12_000)
  it("cancels a raw-mode foreground process and a background job while preserving a reusable shell", async () => {
    const h = await rig("zsh")
    const session = await h.service.createAutomationSession({ title: "edge", cwd: h.root, onCreated: async () => undefined })
    await h.ready(session.id)
    await h.service.resizeSession({ sessionId: session.id, cols: 140, rows: 35 })
    const controller = new AbortController()
    const command = "sleep 60 & background=$!; printf 'BACKGROUND:%s\\n' \"$background\"; stty raw -echo; printf 'RAW_READY\\n'; sleep 60"
    const raw = () => h.service.readSession({ sessionId: session.id }).chunks.map(chunk => chunk.data).join("")
    const pending = h.service.executeAutomationCommand({ sessionId: session.id, command, signal: controller.signal })
    await vi.waitFor(() => expect(raw()).toContain("RAW_READY\n"))
    const background = Number(/BACKGROUND:(\d+)\r?\n/.exec(raw())?.[1])
    expect(background).toBeGreaterThan(0)
    controller.abort()
    expect(await pending).toMatchObject({ stopConfirmed: true })
    await vi.waitFor(() => expect(() => process.kill(background, 0)).toThrow())
    expect(h.service.getSession({ sessionId: session.id }).status).toBe("running")
    expect(await h.service.executeAutomationCommand({ sessionId: session.id, command: "printf 'AFTER_CANCEL\\n'", signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 0 })
    // stty raw is the user's own persistent setting; do not silently replace it
    // with sane mode. In raw mode the native output newline has no extra CR.
    expect(raw()).toContain("AFTER_CANCEL\n")
  }, 12_000)
})
