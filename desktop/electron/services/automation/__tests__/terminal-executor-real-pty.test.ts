import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import { type TerminalService } from "../../../../app-capabilities/terminal/main/service"
import { createInteractiveTerminalRig } from "../../../../app-capabilities/terminal/main/__tests__/interactive-terminal-fixture"
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
  beforeEach(async () => {
    diagnostics.warn.mockClear()
    const rig = await createInteractiveTerminalRig("zsh")
    service = rig.service; directory = rig.root
    const prime = await service.createSession({})
    await rig.ready(prime.id)
    await service.resizeSession({ sessionId: prime.id, cols: 140, rows: 35 })
    await service.stopSession({ sessionId: prime.id })
    await vi.waitFor(() => expect(service.listSessions()).toHaveLength(0))
  })
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
  })
  it("keeps native prompts and both ends of fast long output across reopen and display reflow", async () => {
    const script = path.join(directory, "long-output.js")
    await writeFile(script, "console.log('BEGIN_OUTPUT');for(let n=0;n<200;n++)console.log('row-'+n+' '+'x'.repeat(120));console.log('END_OUTPUT')")
    const command = `${quote(process.execPath)} ${quote(script)}`
    const result = await start(command, { autoClose: false }).pending
    expect(result.status).toBe("success")
    const sessionId = result.outputs!.sessionId as string
    expect(result.outputs?.terminalOutput).not.toContain("执行命令:")
    for (let reopen = 0; reopen < 10; reopen++) {
      const snapshot = await service.attachSession({ sessionId })
      expect(snapshot).toMatchObject({ degraded: false, scrollbackTruncated: false })
      const view = new HeadlessTerminal({ cols: snapshot.cols, rows: snapshot.rows, scrollback: 5000, allowProposedApi: true })
      try {
        await new Promise<void>(resolve => view.write(snapshot.serialized!, resolve))
        for (const [cols, rows] of [[120, 45], [40, 60], [100, 30], [20, 8], [200, 70]]) {
          view.resize(cols!, rows!)
          view.scrollToTop()
          expect(view.buffer.active.viewportY).toBe(0)
          const logical: string[] = []
          for (let i = 0; i < view.buffer.active.length; i++) {
            const line = view.buffer.active.getLine(i), text = line?.translateToString(true) ?? ""
            if (line?.isWrapped && logical.length) logical[logical.length - 1] += text
            else logical.push(text)
          }
          const text = logical.join("\n")
          expect(text).toContain("PARITY>")
          expect(text).toContain("long-output.js")
          expect(text).toContain("BEGIN_OUTPUT")
          expect(text).toContain("END_OUTPUT")
        }
      } finally { view.dispose() }
    }
    expect(service.getSession({ sessionId })).toMatchObject({ cols: 140, rows: 35, status: "running" })
    await service.stopSession({ sessionId })
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
    await service.stopSession({ sessionId: session.id })
  })
  it("runs Python with user-configured file redirection and preserves a nonzero exit in a reusable interactive terminal", async () => {
    const script = path.join(directory, "python test.py")
    const inputFile = path.join(directory, "input.txt")
    await writeFile(inputFile, "x".repeat(6000))
    await writeFile(script, "import sys\nprint('PYTHON_OK:'+str(len(sys.stdin.read())))\nsys.exit(7)\n")
    const h = start(`/usr/bin/python3 ${quote(script)} < ${quote(inputFile)}`, { autoClose: false })
    const result = await h.pending
    expect(result).toMatchObject({ status: "failed", metrics: { exitCode: 7 }, outputs: { terminalRetained: true } })
    expect(result.outputs?.terminalOutput).toContain("PYTHON_OK:6000")
    const sessionId = result.outputs!.sessionId as string
    expect(service.getSession({ sessionId })).toMatchObject({ status: "running" })
    expect(await service.attachSession({ sessionId })).toMatchObject({ degraded: false, serialized: expect.stringContaining("PYTHON_OK:6000") })
    expect(service.listSessions().filter(session => session.status === "running")).toHaveLength(1)
    await service.stopSession({ sessionId })
  })
  it.each(["cancel", "timeout"] as const)("%s stops owned PTY jobs and leaves another terminal running", async mode => {
    const marker = path.join(directory, "child.pid")
    const script = path.join(directory, "long.py")
    await writeFile(script, ["import os,sys,time,signal,subprocess", "signal.signal(signal.SIGTERM,signal.SIG_IGN); signal.signal(signal.SIGINT,signal.SIG_IGN)",
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
