import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, vi } from "vitest"
import { spawn } from "node-pty"
import { TerminalAgentNotificationService } from "../agent-notification-service"
import { createTerminalService } from "../service"
import { terminalStoreStateSchema, type TerminalStore } from "../store"
import { createControlledProcessRunner } from "../../../../electron/runtime/process"
import { createAutomationJobTerminator } from "../automation-jobs"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
export async function createInteractiveTerminalRig(shell: "zsh" | "bash") {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-interactive-parity-"))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }))
  const user = path.join(root, "user-config")
  await mkdir(user)
  const rc = "export PARITY_ENV=from_startup\nexport CLICOLOR=1\nalias ls='ls -G'\nalias parity_alias=\"printf 'ALIAS_LOADED\\\\n'\"\nparity_function() { printf 'FUNCTION_LOADED\\n'; }\nPS1='PARITY> '\n"
  await writeFile(path.join(user, ".zshrc"), rc)
  await writeFile(path.join(user, ".bash_profile"), rc)
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }
  const auditSink = { record: vi.fn() }
  const notifications = new TerminalAgentNotificationService({
    settings: { getSingleton: async () => null }, agentSessions: {}, networkRegistry: {}, permissionGuard, auditSink,
    logger: { warn: vi.fn(), info: vi.fn() }, runtimeDir: path.join(root, "runtime"), nodePath: process.execPath,
    createNotification: () => null, focusedWebContentsId: () => null, openTerminalSession: async () => undefined,
  } as unknown as ConstructorParameters<typeof TerminalAgentNotificationService>[0])
  await notifications.start()
  cleanups.push(() => notifications.stop())
  let state = terminalStoreStateSchema.parse({ groups: [], sessions: [], output: [], globalLaunch: {
    revision: 1, updatedAt: new Date().toISOString(), settings: { shell: `/bin/${shell}`, defaultCwd: root,
      environment: { ZDOTDIR: user, HOME: user } },
  } })
  const store: TerminalStore = { persistenceProtection: "available", loadState: async () => state,
    saveState: async value => { state = terminalStoreStateSchema.parse(structuredClone(value)) } }
  const exits: Array<{ promise: Promise<void>; force(): void }> = []
  const service = createTerminalService({ store, agentNotifications: notifications,
    spawnPty: input => {
      const child = spawn(input.shell, [...input.shellArgs ?? []], { cwd: input.cwd, env: input.env, cols: input.cols, rows: input.rows, name: "xterm-256color" })
      let ended = false
      const promise = new Promise<void>(resolve => child.onExit(() => { ended = true; resolve() }))
      exits.push({ promise, force: () => { if (!ended) child.kill("SIGKILL") } })
      return child
    },
    terminateAutomationJobs: createAutomationJobTerminator(createControlledProcessRunner({ permissionGuard, auditSink } as never)) })
  await service.start()
  cleanups.push(async () => {
    await service.stop()
    const force = setTimeout(() => exits.forEach(exit => exit.force()), 1000)
    try { await Promise.all(exits.map(exit => exit.promise)) } finally { clearTimeout(force) }
  })
  const ready = async (id: string, after = 0) => vi.waitFor(() => {
    const prompt = service.getShellPrompt(id)
    expect(prompt?.sequence).toBeGreaterThan(after)
    return prompt!
  }, { timeout: 5_000 })
  return { service, ready, root }
}
