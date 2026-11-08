import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createInteractiveTerminalRig as rig } from "./interactive-terminal-fixture"
import { createAutomationTerminalRunner } from "../../../../electron/services/automation/terminal-executor"
import type { ActionRuntimeContext } from "../../../../electron/action-runtime/action-registry"

describe.skipIf(process.env.SYNAPSE_TERMINAL_REAL_PTY !== "1" || process.platform !== "darwin")("manual versus automatic interactive PTY", () => {
  it.each(["zsh", "bash"] as const)("loads %s interactive startup and reports the real nonzero command status", async shell => {
    const h = await rig(shell)
    const session = await h.service.createSession({})
    const first = await h.ready(session.id)
    h.service.writeSession({ sessionId: session.id, data: "parity_alias; parity_function; printf 'ENV:%s FLAGS:%s\\n' \"$PARITY_ENV\" \"$-\"; (exit 7)\r" })
    const result = await h.ready(session.id, first.sequence)
    expect(result.exitCode).toBe(7)
    const output = h.service.readSession({ sessionId: session.id }).chunks.map(chunk => chunk.data).join("")
    expect(output).toContain("ALIAS_LOADED")
    expect(output).toContain("FUNCTION_LOADED")
    expect(output).toContain("ENV:from_startup")
    expect(output).not.toContain("SynapseShell;")
  }, 12_000)
  it.each(["zsh", "bash"] as const)("runs the same %s command manually and automatically with identical functional output and geometry", async shell => {
    const h = await rig(shell)
    const prime = await h.service.createSession({})
    await h.ready(prime.id)
    await h.service.resizeSession({ sessionId: prime.id, cols: 140, rows: 35 })
    const manual = await h.service.createSession({})
    const before = await h.ready(manual.id)
    const command = "parity_alias; parity_function; printf 'ENV:%s FLAGS:%s ZERO:%s\\n' \"$PARITY_ENV\" \"$-\" \"$0\"; stty size; test -t 0 && test -t 1 && printf 'TTY_OK\\n'; (exit 7)"
    h.service.writeSession({ sessionId: manual.id, data: command + "\r" })
    expect((await h.ready(manual.id, before.sequence)).exitCode).toBe(7)
    const automatic = await h.service.createAutomationSession({ title: "automatic", cwd: h.root, onCreated: async () => undefined })
    const result = await h.service.executeAutomationCommand({ sessionId: automatic.id, command, signal: AbortSignal.timeout(5000) })
    expect(result).toMatchObject({ exitCode: 7, stopConfirmed: true })
    const view = async (id: string) => (await h.service.getView({ sessionId: id, kind: "scrollback", tailLines: 100, maxBytes: 64 * 1024 })).lines.filter(line => /^(ALIAS_LOADED$|FUNCTION_LOADED$|ENV:|35 140$|TTY_OK$|CONTINUE_WORKING$)/.test(line))
    const manually = await view(manual.id), automatically = await view(automatic.id)
    expect(automatically).toEqual(manually)
    expect(automatically).toHaveLength(5)
    expect(automatically).toContain("35 140")
    expect(automatically).toContain("TTY_OK")
    expect(automatically.some(line => /FLAGS:.*i/.test(line))).toBe(true)
    h.service.releaseAutomationSession(automatic.id)
    const prior = h.service.getShellPrompt(automatic.id)!.sequence
    h.service.writeSession({ sessionId: automatic.id, data: "printf 'CONTINUE_WORKING\\n'\r" })
    await h.ready(automatic.id, prior)
    expect((await view(automatic.id))).toContain("CONTINUE_WORKING")
  }, 15_000)
  it.each(["zsh", "bash"] as const)("preserves native %s multiline definitions, aliases, redirects, pipelines and state", async shell => {
    const h = await rig(shell)
    const prime = await h.service.createSession({})
    await h.ready(prime.id)
    await h.service.resizeSession({ sessionId: prime.id, cols: 140, rows: 35 })
    const command = "keep_value=retained\nnew_function() {\n printf 'MULTILINE:%s\\n' \"$keep_value\"\n}\nparity_alias\nnew_function > result.txt\nsleep 0.2\ncat result.txt | grep MULTILINE\n(exit 9)"
    const manual = await h.service.createSession({})
    const before = await h.ready(manual.id)
    // The user pastes into the native editor; quoted-insert works on older Readline too.
    h.service.writeSession({ sessionId: manual.id, data: command.replace(/\n/g, "\x16\n") + "\r" })
    expect((await h.ready(manual.id, before.sequence)).exitCode).toBe(9)
    const automatic = await h.service.createAutomationSession({ title: "auto", cwd: h.root, onCreated: async () => undefined })
    expect(await h.service.executeAutomationCommand({ sessionId: automatic.id, command, signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 9, stopConfirmed: true })
    const output = (await h.service.getView({ sessionId: automatic.id, kind: "scrollback", tailLines: 100, maxBytes: 64 * 1024 })).lines
    expect(output).toContain("MULTILINE:retained")
    h.service.releaseAutomationSession(automatic.id)
    const sequence = h.service.getShellPrompt(automatic.id)!.sequence
    h.service.writeSession({ sessionId: automatic.id, data: "new_function\r" })
    await h.ready(automatic.id, sequence)
    expect(h.service.getSession({ sessionId: automatic.id }).status).toBe("running")
  }, 15_000)
  it.each(["zsh", "bash"] as const)("matches manual %s colored multi-column ls, interactive input and native exit", async shell => {
    const h = await rig(shell)
    await mkdir(path.join(h.root, "app"))
    await mkdir(path.join(h.root, "docs"))
    await writeFile(path.join(h.root, "README.md"), "fixture")
    const manual = await h.service.createSession({})
    const start = await h.ready(manual.id)
    await h.service.resizeSession({ sessionId: manual.id, cols: 140, rows: 35 })
    const automatic = await h.service.createAutomationSession({ title: "auto", cwd: h.root, onCreated: async () => undefined })
    const command = "ls"
    h.service.writeSession({ sessionId: manual.id, data: command + "\r" })
    await h.ready(manual.id, start.sequence)
    expect(await h.service.executeAutomationCommand({ sessionId: automatic.id, command, signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 0 })
    const raw = (id: string) => h.service.readSession({ sessionId: id }).chunks.map(chunk => chunk.data).join("")
    // ZLE redraws typed versus pasted text differently; compare the program's
    // actual colored listing, without pretending those input echoes are equal.
    const listing = (data: string) => data.split(/\r?\n/).filter(line => line.includes("README.md"))
    expect(listing(raw(automatic.id))).toEqual(listing(raw(manual.id)))
    expect(raw(automatic.id).split("\x1b[").some(part => /^[0-9;]+mapp/.test(part))).toBe(true)
    const lines = (await h.service.getView({ sessionId: automatic.id, kind: "scrollback", tailLines: 100, maxBytes: 64 * 1024 })).lines
    expect(lines.some(line => /app\s+.*docs|docs\s+.*runtime|README.md\s+.*app/.test(line))).toBe(true)
    // A program owns stdin until it finishes; automation must not infer completion from output.
    const interactive = "printf 'INPUT_READY\\n'; read answer; printf 'ANSWER:%s\\n' \"$answer\"; (exit 6)"
    const previous = h.service.getShellPrompt(manual.id)!.sequence
    h.service.writeSession({ sessionId: manual.id, data: interactive + "\r" })
    let settled = false
    const running = h.service.executeAutomationCommand({ sessionId: automatic.id, command: interactive, signal: AbortSignal.timeout(5000) }).finally(() => { settled = true })
    await vi.waitFor(() => expect(raw(automatic.id)).toContain("INPUT_READY\r\n"))
    expect(settled).toBe(false)
    h.service.writeSession({ sessionId: manual.id, data: "typed by user\r" })
    h.service.writeSession({ sessionId: automatic.id, data: "typed by user\r" })
    expect((await h.ready(manual.id, previous)).exitCode).toBe(6)
    expect(await running).toMatchObject({ exitCode: 6, stopConfirmed: true })
    expect(raw(automatic.id)).toContain("ANSWER:typed by user\r\n")
    expect(raw(manual.id)).toContain("ANSWER:typed by user\r\n")
    expect(await h.service.executeAutomationCommand({ sessionId: automatic.id, command: "exit 12", signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 12, stopConfirmed: true })
    expect(h.service.getSession({ sessionId: automatic.id }).status).toBe("ended")
  }, 15_000)
  it("waits for desktop geometry before injecting input and ignores nested-shell prompts", async () => {
    const h = await rig("zsh")
    const automatic = await h.service.createAutomationSession({ title: "auto", cwd: h.root, onCreated: async () => undefined })
    await h.ready(automatic.id)
    let settled = false
    const running = h.service.executeAutomationCommand({ sessionId: automatic.id, command: "/bin/zsh -i", signal: AbortSignal.timeout(5000) }).finally(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 80))
    const raw = () => h.service.readSession({ sessionId: automatic.id }).chunks.map(chunk => chunk.data).join("")
    expect(raw()).not.toContain("/bin/zsh -i")
    const measured = await h.service.createSession({})
    await h.ready(measured.id)
    await h.service.resizeSession({ sessionId: measured.id, cols: 140, rows: 35 })
    await vi.waitFor(() => expect(h.service.getSession({ sessionId: automatic.id })).toMatchObject({ cols: 140, rows: 35 }))
    await vi.waitFor(() => expect((raw().match(/PARITY> /g) ?? []).length).toBeGreaterThan(1))
    expect(settled).toBe(false)
    h.service.writeSession({ sessionId: automatic.id, data: "exit 8\r" })
    expect(await running).toMatchObject({ exitCode: 8, stopConfirmed: true })
    expect(await h.service.executeAutomationCommand({ sessionId: automatic.id, command: "exec /usr/bin/true", signal: AbortSignal.timeout(5000) })).toMatchObject({ exitCode: 0, stopConfirmed: true })
  }, 12_000)
  it("cancels an exec-replaced root that ignores interrupts", async () => {
    const h = await rig("zsh")
    const automatic = await h.service.createAutomationSession({ title: "auto", cwd: h.root, onCreated: async () => undefined })
    await h.ready(automatic.id)
    await h.service.resizeSession({ sessionId: automatic.id, cols: 140, rows: 35 })
    const controller = new AbortController()
    const command = `exec /usr/bin/python3 -c 'import signal,time; signal.signal(signal.SIGINT,signal.SIG_IGN); signal.signal(signal.SIGTERM,signal.SIG_IGN); print("EXEC_READY",flush=True); time.sleep(60)'`
    const running = h.service.executeAutomationCommand({ sessionId: automatic.id, command, signal: controller.signal })
    await vi.waitFor(() => expect(h.service.readSession({ sessionId: automatic.id }).chunks.map(c => c.data).join("")).toContain("EXEC_READY\r\n"))
    controller.abort()
    expect(await running).toMatchObject({ stopConfirmed: true })
    expect(h.service.getSession({ sessionId: automatic.id }).status).toBe("ended")
  }, 12_000)
  it("preserves an explicitly measured mobile grid while automation waits for input readiness", async () => {
    const h = await rig("zsh")
    const automatic = await h.service.createAutomationSession({ title: "auto", cwd: h.root, onCreated: async () => undefined })
    await h.ready(automatic.id)
    const running = h.service.executeAutomationCommand({ sessionId: automatic.id, command: "sleep 0.2; stty size", signal: AbortSignal.timeout(5000) })
    await h.service.resizeSessionFromDevice({ sessionId: automatic.id, cols: 52, rows: 18, deviceLabel: "phone", mobileClientInstanceId: "phone-test" })
    const measured = await h.service.createSession({})
    await h.ready(measured.id)
    await h.service.resizeSession({ sessionId: measured.id, cols: 140, rows: 35 })
    expect(await running).toMatchObject({ exitCode: 0, stopConfirmed: true })
    expect(h.service.getSession({ sessionId: automatic.id })).toMatchObject({ cols: 52, rows: 18, sizeOwner: { kind: "mobile", mobileClientInstanceId: "phone-test" } })
    expect((await h.service.getView({ sessionId: automatic.id, kind: "scrollback", tailLines: 100, maxBytes: 64 * 1024 })).lines).toContain("18 52")
  }, 12_000)
  it.each(["zsh", "bash"] as const)("matches the full Automation runner against manual %s execution", async shell => {
    const h = await rig(shell)
    const manual = await h.service.createSession({})
    const before = await h.ready(manual.id)
    await h.service.resizeSession({ sessionId: manual.id, cols: 140, rows: 35 })
    const command = "parity_alias; parity_function; printf 'ENV:%s\\n' \"$PARITY_ENV\"; stty size; test -t 0 && test -t 1 && printf 'TTY_OK\\n'; (exit 7)"
    h.service.writeSession({ sessionId: manual.id, data: command + "\r" })
    expect((await h.ready(manual.id, before.sequence)).exitCode).toBe(7)
    const saved: Record<string, unknown>[] = []
    const context: ActionRuntimeContext = { taskId: "parity", runId: "parity-run", cwd: h.root, triggeredBy: "manual", actor: { kind: "system", id: "test" }, abortSignal: AbortSignal.timeout(5000), persistOutputs: async value => { saved.push(value) } }
    const result = await createAutomationTerminalRunner(h.service)({ config: { command, autoClose: false, timeoutMins: null }, context })
    expect(result).toMatchObject({ status: "failed", outputs: { exitCode: 7, terminalRetained: true } })
    const automaticId = result.outputs!.sessionId as string
    const lines = async (id: string) => (await h.service.getView({ sessionId: id, kind: "scrollback", tailLines: 100, maxBytes: 64 * 1024 })).lines.filter(line => /^(ALIAS_LOADED$|FUNCTION_LOADED$|ENV:|35 140$|TTY_OK$)/.test(line))
    expect(await lines(automaticId)).toEqual(await lines(manual.id))
    expect(await lines(automaticId)).toHaveLength(5)
    expect(saved.at(-1)).toMatchObject({ exitCode: 7, terminalRetained: true })
    const sequence = h.service.getShellPrompt(automaticId)!.sequence
    h.service.writeSession({ sessionId: automaticId, data: "parity_function\r" })
    await h.ready(automaticId, sequence)
    expect(h.service.getSession({ sessionId: automaticId }).status).toBe("running")
  }, 12_000)
})
