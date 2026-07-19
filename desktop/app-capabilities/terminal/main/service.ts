import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { chmodSync, existsSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import * as pty from "node-pty"
import { TERMINAL_SESSION_OUTPUT_RETENTION_BYTES } from "../../../config"
import type {
  TerminalCreateGroupCommandInput,
  TerminalCreateGroupInput,
  TerminalCreateSessionInput,
  TerminalDeleteGroupCommandInput,
  TerminalDeleteGroupInput,
  TerminalDeleteSessionInput,
  TerminalGroup,
  TerminalGroupCommand,
  TerminalGroupSettings,
  TerminalLaunchGroupCommandInput,
  TerminalOutputChunk,
  TerminalReadSessionInput,
  TerminalReadSessionResult,
  TerminalRenameGroupInput,
  TerminalRenameSessionInput,
  TerminalResizeSessionInput,
  TerminalRunStartupCommandInput,
  TerminalSession,
  TerminalStopSessionInput,
  TerminalUpdateGroupCommandInput,
  TerminalUpdateGroupSettingsInput,
  TerminalWriteSessionInput,
} from "../shared/schema"
import { encodeTerminalCommandInput } from "../shared/terminal-input"
import { createTerminalOutputBuffer, type TerminalOutputBuffer } from "./output-buffer"
import type { TerminalStore, TerminalStoreState } from "./store"

export type PtyDisposable = {
  dispose(): void
}

export type PtyLike = {
  onData(listener: (data: string) => void): PtyDisposable
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

type TerminalRuntime = {
  pty: PtyLike
  buffer: TerminalOutputBuffer
  disposables: PtyDisposable[]
}

type StartupEchoFilter = {
  pending: string[]
}

type SpawnPtyInput = {
  shell: string
  cwd: string
  cols: number
  rows: number
}

type TerminalServiceLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
}

export type TerminalService = ReturnType<typeof createTerminalService>

export function createTerminalService(deps: {
  store: TerminalStore
  outputRetentionBytes?: number
  resolveDefaultShell?: () => string
  resolveDefaultCwd?: () => string
  spawnPty?: (input: SpawnPtyInput) => PtyLike
  logger?: TerminalServiceLogger
}) {
  const events = new EventEmitter()
  const groups = new Map<string, TerminalGroup>()
  const sessions = new Map<string, TerminalSession>()
  const runtimes = new Map<string, TerminalRuntime>()
  const buffers = new Map<string, TerminalOutputBuffer>()
  const pendingStartupCommands = new Map<string, string>()
  const startupEchoFilters = new Map<string, StartupEchoFilter>()
  const outputRetentionBytes = deps.outputRetentionBytes ?? TERMINAL_SESSION_OUTPUT_RETENTION_BYTES
  let persistInFlight: Promise<void> | undefined
  let persistPending = false
  let persistIdleWaiters: Array<() => void> = []
  let lastPersistError: unknown

  function now(): string {
    return new Date().toISOString()
  }

  function snapshotState(): TerminalStoreState {
    const output: TerminalOutputChunk[] = []
    for (const buffer of buffers.values()) {
      output.push(...buffer.snapshot())
    }
    return {
      groups: [...groups.values()],
      sessions: [...sessions.values()],
      output,
    }
  }

  function schedulePersist(): void {
    persistPending = true
    if (!persistInFlight) {
      persistInFlight = runPersistLoop()
    }
  }

  function flushPersist(): Promise<void> {
    schedulePersist()
    return waitForPersistIdle()
  }

  async function runPersistLoop(): Promise<void> {
    try {
      do {
        persistPending = false
        await persistSnapshot()
      } while (persistPending)
    } finally {
      persistInFlight = undefined
      const waiters = persistIdleWaiters
      persistIdleWaiters = []
      for (const resolve of waiters) resolve()
    }
  }

  async function persistSnapshot(): Promise<void> {
    try {
      await deps.store.saveState(snapshotState())
      lastPersistError = undefined
    } catch (error) {
      lastPersistError = error
      deps.logger?.warn("Terminal service failed to persist state.", { error })
    }
  }

  function waitForPersistIdle(): Promise<void> {
    if (!persistInFlight) return Promise.resolve()
    return new Promise((resolve) => persistIdleWaiters.push(resolve))
  }

  function ensureDefaultGroup(): TerminalGroup {
    const existing = [...groups.values()].sort((left, right) => left.sortOrder - right.sortOrder)[0]
    if (existing) return existing

    const timestamp = now()
    const group: TerminalGroup = {
      id: randomUUID(),
      name: "默认",
      createdAt: timestamp,
      updatedAt: timestamp,
      sortOrder: 0,
    }
    groups.set(group.id, group)
    return group
  }

  function getSessionOrThrow(sessionId: string): TerminalSession {
    const session = sessions.get(sessionId)
    if (!session) throw new Error("Terminal session not found")
    return session
  }

  function getGroupOrThrow(groupId: string): TerminalGroup {
    const group = groups.get(groupId)
    if (!group) throw new Error("Terminal group not found")
    return group
  }

  function getGroupCommandOrThrow(group: TerminalGroup, commandId: string): TerminalGroupCommand {
    const command = group.settings?.commands?.find((item) => item.id === commandId)
    if (!command) throw new Error("Terminal command not found")
    return command
  }

  function getRunningRuntime(sessionId: string): TerminalRuntime {
    const session = getSessionOrThrow(sessionId)
    const runtime = runtimes.get(sessionId)
    if (!runtime || session.status !== "running") {
      throw new Error("Terminal session is not running")
    }
    return runtime
  }

  function cleanupRuntime(sessionId: string): void {
    const runtime = runtimes.get(sessionId)
    if (!runtime) return
    runtimes.delete(sessionId)
    pendingStartupCommands.delete(sessionId)
    startupEchoFilters.delete(sessionId)
    for (const disposable of runtime.disposables) {
      disposable.dispose()
    }
  }

  function runPendingStartupCommand(sessionId: string): void {
    const command = pendingStartupCommands.get(sessionId)
    if (!command) return
    pendingStartupCommands.delete(sessionId)
    writeStartupCommand(sessionId, command)
  }

  function writeStartupCommand(sessionId: string, command: string): void {
    const runtime = getRunningRuntime(sessionId)
    startupEchoFilters.set(sessionId, createStartupEchoFilter(command))
    runtime.pty.write(encodeTerminalCommandInput(command))
  }

  function filterStartupCommandEcho(sessionId: string, data: string): string {
    const filter = startupEchoFilters.get(sessionId)
    if (!filter) return data

    let remainingData = data
    while (filter.pending.length > 0 && remainingData) {
      const pendingEcho = filter.pending[0]
      if (!pendingEcho) {
        filter.pending.shift()
        continue
      }
      if (pendingEcho.startsWith(remainingData)) {
        filter.pending[0] = pendingEcho.slice(remainingData.length)
        remainingData = ""
        break
      }
      if (remainingData.startsWith(pendingEcho)) {
        remainingData = remainingData.slice(pendingEcho.length)
        filter.pending.shift()
        continue
      }
      break
    }

    if (filter.pending.length === 0 || remainingData) {
      startupEchoFilters.delete(sessionId)
    }
    return remainingData
  }

  function attachRuntime(session: TerminalSession, child: PtyLike, buffer: TerminalOutputBuffer): void {
    const dataDisposable = child.onData((data) => {
      const runtime = runtimes.get(session.id)
      const current = sessions.get(session.id)
      if (!runtime || !current || current.status !== "running") return

      const filteredData = filterStartupCommandEcho(session.id, data)
      if (!filteredData) return

      const chunk = runtime.buffer.append(session.id, filteredData)
      const updated = { ...current, lastOutputSeq: chunk.seq, updatedAt: now() }
      sessions.set(session.id, updated)
      events.emit("data", { sessionId: session.id, chunk })
      schedulePersist()
    })
    const exitDisposable = child.onExit((event) => {
      const current = sessions.get(session.id)
      if (!current) return

      cleanupRuntime(session.id)
      const timestamp = now()
      const updated: TerminalSession = {
        ...current,
        status: current.status === "killed" || current.status === "lost" ? current.status : "exited",
        exitCode: event.exitCode,
        signal: event.signal,
        updatedAt: timestamp,
        endedAt: current.endedAt ?? timestamp,
      }
      sessions.set(session.id, updated)
      events.emit("sessionChanged", updated)
      void flushPersist()
    })
    runtimes.set(session.id, {
      pty: child,
      buffer,
      disposables: [dataDisposable, exitDisposable],
    })
  }

  function deleteSessionRecord(sessionId: string): void {
    const session = getSessionOrThrow(sessionId)
    const runtime = runtimes.get(session.id)
    if (runtime) {
      cleanupRuntime(session.id)
      try {
        runtime.pty.kill()
      } catch (error) {
        deps.logger?.warn("Terminal service failed to kill deleted session runtime.", {
          error,
          sessionId: session.id,
        })
      }
    }
    sessions.delete(session.id)
    buffers.delete(session.id)
    events.emit("sessionDeleted", { sessionId: session.id })
  }

  function withGroupCommands(group: TerminalGroup, commands: TerminalGroupCommand[]): TerminalGroup {
    const settings = normalizeGroupSettings({
      ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
      ...(commands.length > 0 ? { commands } : {}),
    }, now())
    const updated: TerminalGroup = {
      ...group,
      updatedAt: now(),
    }
    if (settings) {
      updated.settings = settings
    } else {
      delete updated.settings
    }
    return updated
  }

  async function createSessionRecord(input: TerminalCreateSessionInput): Promise<TerminalSession> {
    const group = input.groupId ? groups.get(input.groupId) : ensureDefaultGroup()
    if (!group) throw new Error("Terminal group not found")

    const cwd = resolveCwd(input.cwd ?? group.settings?.defaultCwd ?? (deps.resolveDefaultCwd?.() ?? defaultCwd()))
    const shell = deps.resolveDefaultShell?.() ?? defaultShell()
    const cols = input.cols ?? 80
    const rows = input.rows ?? 24
    const timestamp = now()
    const session: TerminalSession = {
      id: randomUUID(),
      groupId: group.id,
      title: input.title ?? path.basename(shell),
      cwd,
      shell,
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      cols,
      rows,
      lastOutputSeq: 0,
    }
    const buffer = createTerminalOutputBuffer({ maxBytes: outputRetentionBytes })
    const child = deps.spawnPty?.({ shell, cwd, cols, rows }) ?? spawnNodePty({ shell, cwd, cols, rows })
    buffers.set(session.id, buffer)
    sessions.set(session.id, session)
    attachRuntime(session, child, buffer)
    await flushPersist()
    return session
  }

  return {
    events,
    async start() {
      groups.clear()
      sessions.clear()
      buffers.clear()
      runtimes.clear()
      pendingStartupCommands.clear()
      startupEchoFilters.clear()

      const state = await deps.store.loadState()
      for (const group of state.groups) {
        const settings = normalizeGroupSettings(group.settings, group.updatedAt)
        const normalized = { ...group }
        if (settings) {
          normalized.settings = settings
        } else {
          delete normalized.settings
        }
        groups.set(group.id, normalized)
      }

      const outputBySession = new Map<string, TerminalOutputChunk[]>()
      for (const chunk of state.output) {
        const chunks = outputBySession.get(chunk.sessionId) ?? []
        chunks.push(chunk)
        outputBySession.set(chunk.sessionId, chunks)
      }

      const timestamp = now()
      for (const session of state.sessions) {
        const restoredSession: TerminalSession = session.status === "running"
          ? { ...session, status: "lost", updatedAt: timestamp, endedAt: timestamp }
          : session
        sessions.set(session.id, restoredSession)
        buffers.set(session.id, createTerminalOutputBuffer({
          maxBytes: outputRetentionBytes,
          initialChunks: outputBySession.get(session.id) ?? [],
        }))
      }

      await flushPersist()
    },
    async stop() {
      const timestamp = now()
      for (const [sessionId, runtime] of [...runtimes.entries()]) {
        const current = sessions.get(sessionId)
        if (current?.status === "running") {
          const updated: TerminalSession = {
            ...current,
            status: "lost",
            updatedAt: timestamp,
            endedAt: current.endedAt ?? timestamp,
          }
          sessions.set(sessionId, updated)
          events.emit("sessionChanged", updated)
        }
        try {
          runtime.pty.kill()
        } finally {
          cleanupRuntime(sessionId)
        }
      }
      await flushPersist()
    },
    flushPersistQueue() {
      return waitForPersistIdle()
    },
    getLastPersistError() {
      return lastPersistError
    },
    getPersistDiagnostics() {
      return {
        inFlight: Boolean(persistInFlight),
        pending: persistPending,
        idleWaiterCount: persistIdleWaiters.length,
      }
    },
    listGroups(): TerminalGroup[] {
      return [...groups.values()].sort((left, right) => left.sortOrder - right.sortOrder)
    },
    async createGroup(input: TerminalCreateGroupInput): Promise<TerminalGroup> {
      const name = input.name.trim()
      if (!name) throw new Error("Terminal group name is required")
      if (name.length > 80) throw new Error("Terminal group name is too long")
      const timestamp = now()
      const group: TerminalGroup = {
        id: randomUUID(),
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        sortOrder: groups.size,
      }
      groups.set(group.id, group)
      await flushPersist()
      return group
    },
    async renameGroup(input: TerminalRenameGroupInput): Promise<TerminalGroup> {
      const group = getGroupOrThrow(input.groupId)
      const name = input.name.trim()
      if (!name) throw new Error("Terminal group name is required")
      if (name.length > 80) throw new Error("Terminal group name is too long")
      const updated = { ...group, name, updatedAt: now() }
      groups.set(group.id, updated)
      await flushPersist()
      return updated
    },
    async updateGroupSettings(input: TerminalUpdateGroupSettingsInput): Promise<TerminalGroup> {
      const group = getGroupOrThrow(input.groupId)
      const name = input.name.trim()
      if (!name) throw new Error("Terminal group name is required")
      if (name.length > 80) throw new Error("Terminal group name is too long")
      const settings = normalizeGroupSettings(input.settings, now())
      if (settings?.defaultCwd) resolveCwd(settings.defaultCwd)
      const updated: TerminalGroup = {
        ...group,
        name,
        updatedAt: now(),
      }
      if (settings) {
        updated.settings = settings
      } else {
        delete updated.settings
      }
      groups.set(group.id, updated)
      await flushPersist()
      return updated
    },
    async createGroupCommand(input: TerminalCreateGroupCommandInput): Promise<TerminalGroupCommand> {
      const group = getGroupOrThrow(input.groupId)
      const normalized = normalizeGroupCommandInput(input)
      const timestamp = now()
      const command: TerminalGroupCommand = {
        id: randomUUID(),
        name: normalized.name,
        command: normalized.command,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const updated = withGroupCommands(group, [...(group.settings?.commands ?? []), command])
      groups.set(group.id, updated)
      await flushPersist()
      return command
    },
    async updateGroupCommand(input: TerminalUpdateGroupCommandInput): Promise<TerminalGroupCommand> {
      const group = getGroupOrThrow(input.groupId)
      const currentCommand = getGroupCommandOrThrow(group, input.commandId)
      const normalized = normalizeGroupCommandInput(input)
      const updatedCommand: TerminalGroupCommand = {
        ...currentCommand,
        name: normalized.name,
        command: normalized.command,
        updatedAt: now(),
      }
      const updated = withGroupCommands(
        group,
        (group.settings?.commands ?? []).map((command) =>
          command.id === input.commandId ? updatedCommand : command),
      )
      groups.set(group.id, updated)
      await flushPersist()
      return updatedCommand
    },
    async deleteGroupCommand(input: TerminalDeleteGroupCommandInput): Promise<void> {
      const group = getGroupOrThrow(input.groupId)
      getGroupCommandOrThrow(group, input.commandId)
      const updated = withGroupCommands(
        group,
        (group.settings?.commands ?? []).filter((command) => command.id !== input.commandId),
      )
      groups.set(group.id, updated)
      await flushPersist()
    },
    async deleteGroup(input: TerminalDeleteGroupInput): Promise<void> {
      const group = getGroupOrThrow(input.groupId)
      const groupSessions = [...sessions.values()].filter((session) => session.groupId === group.id)
      for (const session of groupSessions) {
        deleteSessionRecord(session.id)
      }
      groups.delete(group.id)
      await flushPersist()
    },
    listSessions(): TerminalSession[] {
      return [...sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    },
    getSession(input: { sessionId: string }): TerminalSession {
      return getSessionOrThrow(input.sessionId)
    },
    async createSession(input: TerminalCreateSessionInput): Promise<TerminalSession> {
      return createSessionRecord(input)
    },
    async launchGroupCommand(input: TerminalLaunchGroupCommandInput): Promise<TerminalSession> {
      const group = getGroupOrThrow(input.groupId)
      const command = getGroupCommandOrThrow(group, input.commandId)
      const session = await createSessionRecord({
        groupId: group.id,
        title: command.name,
        cols: input.cols,
        rows: input.rows,
      })
      writeStartupCommand(session.id, command.command)
      return session
    },
    readSession(input: TerminalReadSessionInput): TerminalReadSessionResult {
      const session = getSessionOrThrow(input.sessionId)
      const buffer = buffers.get(input.sessionId)
      if (!buffer) {
        return {
          session,
          chunks: [],
          nextSeq: session.lastOutputSeq,
          firstSeq: session.lastOutputSeq,
          truncated: false,
        }
      }
      return {
        session,
        ...buffer.read({
          afterSeq: input.afterSeq,
          limitBytes: input.limitBytes ?? 64 * 1024,
        }),
      }
    },
    async renameSession(input: TerminalRenameSessionInput): Promise<TerminalSession> {
      const session = getSessionOrThrow(input.sessionId)
      const title = input.title.trim()
      if (!title) throw new Error("Terminal session title is required")
      if (title.length > 120) throw new Error("Terminal session title is too long")
      const updated = { ...session, title, updatedAt: now() }
      sessions.set(session.id, updated)
      events.emit("sessionChanged", updated)
      await flushPersist()
      return updated
    },
    writeSession(input: TerminalWriteSessionInput): void {
      getSessionOrThrow(input.sessionId)
      getRunningRuntime(input.sessionId).pty.write(input.data)
    },
    runStartupCommand(input: TerminalRunStartupCommandInput): void {
      getSessionOrThrow(input.sessionId)
      runPendingStartupCommand(input.sessionId)
    },
    async resizeSession(input: TerminalResizeSessionInput): Promise<void> {
      const runtime = getRunningRuntime(input.sessionId)
      const session = getSessionOrThrow(input.sessionId)
      if (session.cols === input.cols && session.rows === input.rows) return
      sessions.set(session.id, { ...session, cols: input.cols, rows: input.rows, updatedAt: now() })
      runtime.pty.resize(input.cols, input.rows)
      await flushPersist()
    },
    async deleteSession(input: TerminalDeleteSessionInput): Promise<void> {
      deleteSessionRecord(input.sessionId)
      await flushPersist()
    },
    async stopSession(input: TerminalStopSessionInput): Promise<void> {
      const session = getSessionOrThrow(input.sessionId)
      const runtime = getRunningRuntime(input.sessionId)
      const timestamp = now()
      sessions.set(session.id, { ...session, status: "killed", updatedAt: timestamp, endedAt: timestamp })
      runtime.pty.kill()
      await flushPersist()
    },
  }
}

function spawnNodePty(input: SpawnPtyInput): PtyLike {
  ensureNodePtySpawnHelperExecutable()
  return pty.spawn(input.shell, [], {
    name: "xterm-256color",
    cwd: input.cwd,
    cols: input.cols,
    rows: input.rows,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  })
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (os.platform() === "win32") return

  const packageRoot = path.dirname(require.resolve("node-pty/package.json"))
  const helperCandidates = [
    path.join(packageRoot, "build", "Release", "spawn-helper"),
    path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ]

  for (const helperPath of helperCandidates) {
    ensureExecutableIfPresent(resolveUnpackedPath(helperPath))
  }
}

export function ensureExecutableIfPresent(filePath: string): void {
  if (!existsSync(filePath)) return

  const mode = statSync(filePath).mode
  if ((mode & 0o111) !== 0) return

  chmodSync(filePath, mode | 0o755)
}

function resolveUnpackedPath(filePath: string): string {
  return filePath
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked")
}

function defaultShell(): string {
  if (os.platform() === "win32") return process.env.ComSpec || "powershell.exe"
  return process.env.SHELL || "/bin/zsh"
}

function defaultCwd(): string {
  return os.homedir() || process.cwd()
}

function resolveCwd(cwd: string): string {
  if (!path.isAbsolute(cwd)) {
    throw new Error("Terminal cwd must be an existing absolute path")
  }
  try {
    if (!statSync(cwd).isDirectory()) {
      throw new Error("not a directory")
    }
  } catch {
    throw new Error("Terminal cwd must be an existing absolute path")
  }
  return cwd
}

function normalizeGroupSettings(
  settings: TerminalGroupSettings | undefined,
  legacyCommandTimestamp: string,
): TerminalGroupSettings | undefined {
  const defaultCwd = settings?.defaultCwd?.trim()
  const commands = normalizeGroupCommands(settings?.commands)
  const startupCommand = normalizeStartupCommand(settings?.startupCommand)
  const normalized: TerminalGroupSettings = {
    ...(defaultCwd ? { defaultCwd: validateAbsoluteCwdInput(defaultCwd) } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  }
  if (!normalized.commands && startupCommand) {
    normalized.commands = [{
      id: randomUUID(),
      name: "启动命令",
      command: startupCommand,
      createdAt: legacyCommandTimestamp,
      updatedAt: legacyCommandTimestamp,
    }]
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeGroupCommands(commands: TerminalGroupCommand[] | undefined): TerminalGroupCommand[] {
  return (commands ?? []).map((command) => {
    const normalized = normalizeGroupCommandInput(command)
    return {
      ...command,
      name: normalized.name,
      command: normalized.command,
    }
  })
}

function normalizeGroupCommandInput(input: { name: string; command: string }): { name: string; command: string } {
  const name = input.name.trim()
  if (!name) throw new Error("Terminal command name is required")
  if (name.length > 80) throw new Error("Terminal command name is too long")
  const command = normalizeStartupCommand(input.command)
  if (!command) throw new Error("Terminal command is required")
  if (Buffer.byteLength(command) > 64 * 1024) throw new Error("Terminal command is too long")
  return { name, command }
}

function normalizeStartupCommand(command: string | undefined): string | undefined {
  const normalized = command?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  return normalized || undefined
}

function createStartupEchoFilter(command: string): StartupEchoFilter {
  return {
    pending: command
      .split("\n")
      .map((line) => `${line}\r\n`)
      .filter((line) => line.trim().length > 0),
  }
}

function validateAbsoluteCwdInput(cwd: string): string {
  if (!path.isAbsolute(cwd)) {
    throw new Error("Terminal cwd must be an absolute path")
  }
  return cwd
}
