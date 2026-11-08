import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTerminalService, type TerminalService } from "../../../../app-capabilities/terminal/main/service"
import { terminalStoreStateSchema, type TerminalStore, type TerminalStoreState } from "../../../../app-capabilities/terminal/main/store"
import { terminalActionConfigSchema, type TerminalActionConfig } from "../../../../action-packages/builtin/terminal/schema"
import type { ActionRuntimeContext } from "../../../action-runtime/action-registry"

const diagnostics = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock("../../log-store", () => ({ createMainLogger: () => diagnostics }))
import { createAutomationTerminalRunner } from "../terminal-executor"

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

// Opt-in: real short-lived processes only, no Synapse app, listener, build or user data.
describe.skipIf(process.env.SYNAPSE_TERMINAL_REAL_PTY !== "1" || process.platform === "win32")("terminal executor real PTY", () => {
  let service: TerminalService
  let directory: string
  let state: TerminalStoreState
  beforeEach(async () => {
    diagnostics.warn.mockClear()
    directory = await mkdtemp(path.join(os.tmpdir(), "synapse-automation-terminal-"))
    state = terminalStoreStateSchema.parse({ groups: [], sessions: [], output: [] })
    const store: TerminalStore = {
      persistenceProtection: "available", loadState: async () => structuredClone(state),
      saveState: async value => { state = terminalStoreStateSchema.parse(structuredClone(value)) },
    }
    service = createTerminalService({ store, resolveDefaultShell: () => "/bin/bash", resolveDefaultCwd: () => directory })
    await service.start()
  })
  afterEach(async () => { await service?.stop(); await rm(directory, { recursive: true, force: true }) })
  function start(command: string, config: Partial<TerminalActionConfig> = {}) {
    const controller = new AbortController()
    const saved: Record<string, unknown>[] = []
    const context: ActionRuntimeContext = {
      taskId: "real-pty", runId: "real-pty-run", cwd: directory, triggeredBy: "manual", actor: { kind: "system", id: "test" },
      abortSignal: controller.signal, persistOutputs: async output => { saved.push(structuredClone(output)) },
    }
    const parsed = terminalActionConfigSchema.parse({ command, ...config, timeoutMins: null })
    // Accelerated timer exercises the same runtime path; the public form still requires >=1 minute.
    const pending = createAutomationTerminalRunner(service)({ config: { ...parsed, ...config }, context })
    return { pending, controller, saved }
  }
  it("runs Node in the configured cwd, saves output/exit, then removes the terminal", async () => {
    const script = path.join(directory, "node test.js")
    await writeFile(script, "console.log('NODE_OK '+process.cwd());console.error('NODE_STDERR')")
    const h = start(`${quote(process.execPath)} ${quote(script)}`)
    const result = await h.pending
    expect(result.status).toBe("success")
    expect(result.metrics?.exitCode).toBe(0)
    expect(result.outputs?.terminalOutput).toContain(`NODE_OK ${await realpath(directory)}`)
    expect(result.outputs?.terminalOutput).toContain("NODE_STDERR")
    expect(h.saved.at(-1)).toMatchObject({ exitCode: 0, terminalRetained: true })
    expect(service.listSessions()).toHaveLength(0)
    expect(state.sessions).toHaveLength(0)
  })
  it("runs in the selected project's group and directory instead of the Automation cwd", async () => {
    const projectDirectory = path.join(directory, "selected project")
    await mkdir(projectDirectory)
    await service.syncProjectGroups([{ projectId: "project-alpha", name: "Alpha", path: projectDirectory }])
    const h = start(`${quote(process.execPath)} -e ${quote("console.log('PROJECT_CWD:'+process.cwd())")}`, { projectId: "project-alpha", autoClose: false })
    const result = await h.pending
    expect(result).toMatchObject({ status: "success", outputs: { projectId: "project-alpha", terminalRetained: true } })
    expect(result.outputs?.terminalOutput).toContain(`PROJECT_CWD:${await realpath(projectDirectory)}`)
    const session = service.getSession({ sessionId: result.outputs!.sessionId as string })
    expect(service.getGroup(session.groupId).projectId).toBe("project-alpha")
    expect(h.saved[0]).toMatchObject({ projectId: "project-alpha", sessionId: session.id })
    await service.deleteTerminalSession(session.id, "test")
  })
  it("runs Python with user-configured file redirection and preserves a nonzero exit in an ended terminal", async () => {
    const script = path.join(directory, "python test.py")
    const inputFile = path.join(directory, "input.txt")
    await writeFile(inputFile, "x".repeat(6000))
    await writeFile(script, "import sys\nprint('PYTHON_OK:'+str(len(sys.stdin.read())))\nsys.exit(7)\n")
    const h = start(`/usr/bin/python3 ${quote(script)} < ${quote(inputFile)}`, { autoClose: false })
    const result = await h.pending
    expect(result).toMatchObject({ status: "failed", metrics: { exitCode: 7 }, outputs: { terminalRetained: true } })
    expect(result.outputs?.terminalOutput).toContain("PYTHON_OK:6000")
    const sessionId = result.outputs!.sessionId as string
    expect(service.getSession({ sessionId })).toMatchObject({ status: "ended", exitCode: 7 })
    expect(await service.attachSession({ sessionId })).toMatchObject({ degraded: false, serialized: expect.stringContaining("PYTHON_OK:6000") })
    expect(service.listSessions().filter(session => session.status === "running")).toHaveLength(0)
    await service.deleteTerminalSession(sessionId, "test")
  })
  it.each(["cancel", "timeout"] as const)("%s kills the owned process group, leaves another terminal running", async mode => {
    const marker = path.join(directory, "child.pid")
    const script = path.join(directory, "long.py")
    await writeFile(script, ["import os,sys,time,signal,subprocess", "signal.signal(signal.SIGTERM,signal.SIG_IGN)",
      "child=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)'])",
      `open(${JSON.stringify(marker)},'w').write(str(child.pid))`, "print('READY',flush=True)", "time.sleep(60)"].join("\n"))
    const other = await service.createSession({ cwd: directory })
    const h = start(`/usr/bin/python3 ${quote(script)}`, mode === "timeout" ? { timeoutMins: 0.1 } : {})
    let childPid = 0
    await vi.waitFor(async () => { childPid = Number(await readFile(marker, "utf8")); expect(childPid).toBeGreaterThan(0) }, { timeout: 4000 })
    if (mode === "cancel") h.controller.abort()
    const result = await h.pending
    expect(result.status).toBe(mode === "cancel" ? "cancelled" : "timeout")
    expect(result.outputs?.terminalOutput).toContain("READY")
    expect(result, JSON.stringify({ warnings: diagnostics.warn.mock.calls, result })).toMatchObject({ outputs: { terminalRetained: false } })
    await vi.waitFor(() => expect(alive(childPid)).toBe(false), { timeout: 4000 })
    expect(service.getSession({ sessionId: other.id }).status).toBe("running")
    expect(service.listSessions()).toHaveLength(1)
  }, 20_000)
})
