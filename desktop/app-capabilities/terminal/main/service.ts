import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import * as pty from "node-pty"
import { TERMINAL_SESSION_OUTPUT_RETENTION_BYTES } from "../../../config"
import type {
  TerminalCreateGroupInput,
  TerminalCreateSessionInput,
  TerminalGroup,
  TerminalOutputChunk,
  TerminalReadSessionInput,
  TerminalReadSessionResult,
  TerminalResizeSessionInput,
  TerminalSession,
  TerminalStopSessionInput,
  TerminalWriteSessionInput,
} from "../shared/schema"
import { createTerminalOutputBuffer, type TerminalOutputBuffer } from "./output-buffer"
import type { TerminalStore, TerminalStoreState } from "./store"

export type TerminalActor = "user" | "mcp"

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
    for (const disposable of runtime.disposables) {
      disposable.dispose()
    }
  }

  function attachRuntime(session: TerminalSession, child: PtyLike, buffer: TerminalOutputBuffer): void {
    const dataDisposable = child.onData((data) => {
      const runtime = runtimes.get(session.id)
      const current = sessions.get(session.id)
      if (!runtime || !current || current.status !== "running") return

      const chunk = runtime.buffer.append(session.id, data)
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
        status: current.status === "killed" ? "killed" : "exited",
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

  return {
    events,
    async start() {
      groups.clear()
      sessions.clear()
      buffers.clear()
      runtimes.clear()

      const state = await deps.store.loadState()
      for (const group of state.groups) groups.set(group.id, group)

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
            status: "killed",
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
      const timestamp = now()
      const group: TerminalGroup = {
        id: randomUUID(),
        name: input.name,
        createdAt: timestamp,
        updatedAt: timestamp,
        sortOrder: groups.size,
      }
      groups.set(group.id, group)
      await flushPersist()
      return group
    },
    listSessions(): TerminalSession[] {
      return [...sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    },
    getSession(input: { sessionId: string }): TerminalSession {
      return getSessionOrThrow(input.sessionId)
    },
    async createSession(input: TerminalCreateSessionInput): Promise<TerminalSession> {
      const group = input.groupId ? groups.get(input.groupId) : ensureDefaultGroup()
      if (!group) throw new Error("Terminal group not found")

      const cwd = resolveCwd(input.cwd ?? (deps.resolveDefaultCwd?.() ?? defaultCwd()))
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
        agentControl: input.agentControl ? "enabled" : "disabled",
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
    writeSession(input: TerminalWriteSessionInput & { actor: TerminalActor }): void {
      const session = getSessionOrThrow(input.sessionId)
      if (input.actor === "mcp" && session.agentControl !== "enabled") {
        throw new Error("Agent control is disabled")
      }
      getRunningRuntime(input.sessionId).pty.write(input.data)
    },
    async resizeSession(input: TerminalResizeSessionInput): Promise<void> {
      const runtime = getRunningRuntime(input.sessionId)
      const session = getSessionOrThrow(input.sessionId)
      sessions.set(session.id, { ...session, cols: input.cols, rows: input.rows, updatedAt: now() })
      runtime.pty.resize(input.cols, input.rows)
      await flushPersist()
    },
    async setAgentControl(input: { sessionId: string; enabled: boolean }): Promise<TerminalSession> {
      const session = getSessionOrThrow(input.sessionId)
      const updated: TerminalSession = {
        ...session,
        agentControl: input.enabled ? "enabled" : "disabled",
        updatedAt: now(),
      }
      sessions.set(session.id, updated)
      await flushPersist()
      return updated
    },
    async stopSession(input: TerminalStopSessionInput & { actor: TerminalActor }): Promise<void> {
      const session = getSessionOrThrow(input.sessionId)
      if (input.actor === "mcp" && session.agentControl !== "enabled") {
        throw new Error("Agent control is disabled")
      }
      const runtime = getRunningRuntime(input.sessionId)
      const timestamp = now()
      sessions.set(session.id, { ...session, status: "killed", updatedAt: timestamp, endedAt: timestamp })
      runtime.pty.kill()
      await flushPersist()
    },
  }
}

function spawnNodePty(input: SpawnPtyInput): PtyLike {
  return pty.spawn(input.shell, [], {
    name: "xterm-256color",
    cwd: input.cwd,
    cols: input.cols,
    rows: input.rows,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  })
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
