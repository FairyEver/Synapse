import { afterAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const mocks = vi.hoisted(() => ({ load: vi.fn(), resolveProjectAgent: vi.fn() }))
vi.mock("../../electron/services/config-store", () => ({ configStore: { load: mocks.load } }))
vi.mock("../../electron/modules/agent/ipc-shared", () => ({ resolveProjectAgent: mocks.resolveProjectAgent }))
vi.mock("../../electron/services/log-store", () => ({ createMainLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }))

import { createClaudeCodeTerminalSession } from "../../electron/modules/agent/claude-code-terminal"
import { createClaudeCodeAction } from "../../action-packages/builtin/claude-code/executor.main"
import { createTerminalService } from "../../app-capabilities/terminal/main/service"
import { terminalStoreStateSchema } from "../../app-capabilities/terminal/main/store"
import { claudeHookCommand } from "../../app-capabilities/terminal/main/agent-notification-runtime"

const req = createRequire(import.meta.url)
const pty = req("node-pty")
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "synapse-single-run-live-")))
// Isolate the launcher's stale-directory sweep from real application sessions.
const tmpdir = vi.spyOn(os, "tmpdir").mockReturnValue(root)
afterAll(() => tmpdir.mockRestore())
const local = JSON.parse(readFileSync(path.join(os.homedir(), ".claude/settings.json"), "utf8"))
const provider = { id: "test-local", name: "Existing local CLI configuration", active: true, model: local.model }
const results = []

const hookSource = String.raw`
const fs = require('node:fs'); const path = require('node:path'); let raw = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', v => { if (raw.length < 1048576) raw += v });
process.stdin.on('end', () => {
  try {
    const p = JSON.parse(raw), dir = process.env.SINGLE_RUN_LIVE_DIR;
    const record = value => fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({at: Date.now(), ...value}) + '\n');
    if (p.hook_event_name !== 'Stop') return;
    const marker = (p.last_assistant_message || '').includes('SECOND_DONE') ? 'SECOND_DONE' : (p.last_assistant_message || '').includes('FIRST_DONE') ? 'FIRST_DONE' : null;
    record({event: 'Stop', marker, background: p.background_tasks?.length, crons: p.session_crons?.length});
    if (process.env.SINGLE_RUN_LIVE_GATE !== '1') return;
    const once = path.join(dir, 'continued-once');
    if (!fs.existsSync(once)) {
      fs.writeFileSync(once, '1'); record({event: 'continue_requested'});
      process.stdout.write(JSON.stringify({decision: 'block', reason: 'Controlled lifecycle test: reply exactly SECOND_DONE. Do not use tools or perform any other actions.'}));
    } else record({event: 'continuation_finished', marker});
  } catch { process.exitCode = 1 }
});
`

describe("real Claude Code automation single-run lifecycle (explicit opt-in)", () => {
  it.each([false, true])("singleRun=%s uses the production action, launcher and terminal lifecycle", async singleRun => {
    const dir = path.join(root, singleRun ? "single" : "interactive")
    mkdirSync(dir)
    const configDir = path.join(dir, "config")
    mkdirSync(configDir)
    writeFileSync(path.join(configDir, ".claude.json"), JSON.stringify({
      hasCompletedOnboarding: true, lastOnboardingVersion: "2.1.278",
      projects: { [dir]: { hasTrustDialogAccepted: true } },
    }), { mode: 0o600 })
    const hookPath = path.join(dir, "stop.cjs")
    writeFileSync(hookPath, hookSource, { mode: 0o600 })
    mocks.load.mockResolvedValue({ agent: { defaultPermissionMode: "default" } })
    mocks.resolveProjectAgent.mockResolvedValue({
      project: { uuid: "test-project", name: "Lifecycle test", localPath: dir },
      providerService: {
        listAllProviders: async () => [provider],
        buildEnv: async () => ({ ...local.env, ANTHROPIC_MODEL: local.model, CLAUDE_CONFIG_DIR: configDir,
          SINGLE_RUN_LIVE_DIR: dir, SINGLE_RUN_LIVE_GATE: singleRun ? "1" : "0" }),
      },
    })
    let state = terminalStoreStateSchema.parse({ groups: [], sessions: [], output: [] })
    let persistedProviderValue = false
    let text = ""
    let settingsPath
    const exits = []
    const pids = []
    const terminal = createTerminalService({
      store: { loadState: async () => state, saveState: async next => {
        const serialized = JSON.stringify(next)
        persistedProviderValue ||= Object.values(local.env ?? {}).some(value => typeof value === "string" && value.length > 12 && serialized.includes(value))
        state = terminalStoreStateSchema.parse(next)
      } },
      resolveDefaultShell: () => "/bin/zsh", resolveDefaultCwd: () => dir,
      spawnPty: options => {
        settingsPath = options.shellArgs[options.shellArgs.indexOf("--settings") + 1]
        const args = ["--tools", "", "--disable-slash-commands", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', ...options.shellArgs]
        const child = pty.spawn(options.shell, args, { cwd: options.cwd, env: options.env, cols: options.cols, rows: options.rows, name: "xterm-256color" })
        child.onData(data => { text = (text + data).slice(-50_000) })
        child.onExit(event => exits.push({ ...event, at: Date.now() }))
        pids.push(child.pid)
        return child
      },
    })
    await terminal.start()
    const resolve = id => {
      if (id === "core.terminal") return terminal
      if (id === "core.process-environment") return { nodePath: process.execPath }
      if (id === "core.terminal-agent-notifications") return { buildClaudeCodeHookSettings: () => ({ hooks: {
        Stop: [{ hooks: [{ type: "command", command: claudeHookCommand(process.execPath, hookPath, "Stop"), timeout: 5 }] }],
      } }) }
      throw new Error(`Unexpected service: ${id}`)
    }
    const events = () => existsSync(path.join(dir, "events.jsonl"))
      ? readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse) : []
    const start = Date.now()
    try {
      const result = await createClaudeCodeAction({ launch: input => createClaudeCodeTerminalSession(resolve, input) }).execute({
        config: { projectId: "test-project", prompt: "Reply exactly FIRST_DONE. Do not use any tools or perform other actions.", singleRun },
        context: { taskId: "test-task", runId: "test-run", cwd: dir, triggeredBy: "schedule",
          actor: { kind: "user", id: "automation" }, abortSignal: new AbortController().signal,
          templateVariables: {}, persistOutputs: async () => undefined },
      })
      expect(result.status).toBe("success")
      const sessionId = result.outputs.sessionId
      if (singleRun) {
        await vi.waitFor(() => expect(exits).toHaveLength(1), { timeout: 60_000 })
        expect(exits[0].exitCode).toBe(0)
        expect(events().some(e => e.event === "continue_requested")).toBe(true)
        const finished = events().find(e => e.event === "continuation_finished")
        expect(finished?.marker).toBe("SECOND_DONE")
        expect(exits[0].at).toBeGreaterThanOrEqual(finished.at)
        expect(terminal.listSessions()).toHaveLength(0)
        expect(terminal.listWorkspaces()).toHaveLength(0)
      } else {
        await vi.waitFor(() => expect(events().some(e => e.event === "Stop")).toBe(true), { timeout: 60_000 })
        expect(text.includes("FIRST_DONE")).toBe(true)
        expect(events().find(e => e.event === "Stop")?.marker).toBe("FIRST_DONE")
        expect(exits).toHaveLength(0)
        expect(terminal.listSessions()).toMatchObject([{ id: sessionId, status: "running" }])
        expect(terminal.listWorkspaces()).toHaveLength(1)
        // Explicit test cleanup, after proving unchecked mode did not auto-close.
        await terminal.stopSession({ sessionId })
        await vi.waitFor(() => expect(exits).toHaveLength(1), { timeout: 15_000 })
      }
      await vi.waitFor(() => expect(existsSync(settingsPath)).toBe(false))
      expect(terminal.listSessions()).toHaveLength(0)
      expect(terminal.listWorkspaces()).toHaveLength(0)
      expect(persistedProviderValue).toBe(false)
      results.push({ singleRun, elapsedMs: Date.now() - start, exits, events: events(), cleaned: true, pids })
      writeFileSync(path.join(root, "results.json"), JSON.stringify(results, null, 2))
    } finally {
      writeFileSync(path.join(dir, "terminal.txt"), text, { mode: 0o600 })
      await terminal.stop()
      // A failed acceptance run can stop the service before the CLI's end callback runs.
      if (settingsPath && path.dirname(settingsPath).startsWith(root + path.sep)) rmSync(path.dirname(settingsPath), { recursive: true, force: true })
    }
  })
})
