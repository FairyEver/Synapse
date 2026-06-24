import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTerminalService, ensureExecutableIfPresent, type PtyLike, type TerminalService } from "../service"
import type { TerminalStore, TerminalStoreState } from "../store"
import type { TerminalGroup, TerminalOutputChunk, TerminalSession } from "../../shared/schema"

type Disposable = { dispose(): void }

class FakePty implements PtyLike {
  readonly dataListeners: Array<(data: string) => void> = []
  readonly exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = []
  readonly write = vi.fn()
  readonly resize = vi.fn()
  readonly kill = vi.fn()

  onData(listener: (data: string) => void): Disposable {
    this.dataListeners.push(listener)
    return {
      dispose: () => {
        const index = this.dataListeners.indexOf(listener)
        if (index >= 0) this.dataListeners.splice(index, 1)
      },
    }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): Disposable {
    this.exitListeners.push(listener)
    return {
      dispose: () => {
        const index = this.exitListeners.indexOf(listener)
        if (index >= 0) this.exitListeners.splice(index, 1)
      },
    }
  }

  emitData(data: string): void {
    for (const listener of [...this.dataListeners]) listener(data)
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const listener of [...this.exitListeners]) listener(event)
  }
}

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-service-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("TerminalService", () => {
  it("marks a present node-pty spawn helper as executable", async () => {
    const helperPath = path.join(tempDir, "spawn-helper")
    await writeFile(helperPath, "#!/bin/sh\n")
    await chmod(helperPath, 0o644)

    ensureExecutableIfPresent(helperPath)

    expect((await stat(helperPath)).mode & 0o111).not.toBe(0)
  })

  it("creates a session and records output", async () => {
    const store = createMemoryStore()
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const onData = vi.fn()
    service.events.on("data", onData)

    const session = await service.createSession({ title: "Shell" })
    pty.emitData("hello\n")
    await service.flushPersistQueue()

    const read = service.readSession({ sessionId: session.id })
    expect(read.session).toMatchObject({
      id: session.id,
      status: "running",
      lastOutputSeq: 1,
      cwd: tempDir,
      shell: "/bin/zsh",
    })
    expect(read.chunks.map((chunk) => chunk.data)).toEqual(["hello\n"])
    expect(store.state.output.map((chunk) => chunk.data)).toEqual(["hello\n"])
    expect(onData).toHaveBeenCalledWith({
      sessionId: session.id,
      chunk: expect.objectContaining({ sessionId: session.id, seq: 1, data: "hello\n", source: "pty" }),
    })
  })

  it("blocks MCP write until agent control is enabled, then writes raw data", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({})

    expect(() => service.writeSession({ sessionId: session.id, data: "pwd\n", actor: "mcp" }))
      .toThrow("Agent control is disabled")
    expect(pty.write).not.toHaveBeenCalled()

    await service.setAgentControl({ sessionId: session.id, enabled: true })
    service.writeSession({ sessionId: session.id, data: "\u001b[A", actor: "mcp" })

    expect(pty.write).toHaveBeenCalledWith("\u001b[A")
  })

  it("marks restored running sessions as lost", async () => {
    const group = createGroup()
    const runningSession = createSession({ status: "running" })
    const store = createMemoryStore({ groups: [group], sessions: [runningSession], output: [] })
    const service = await createStartedService(store)

    const restored = service.getSession({ sessionId: runningSession.id })
    expect(restored.status).toBe("lost")
    expect(restored.endedAt).toBeDefined()
    expect(store.state.sessions[0]).toMatchObject({ id: runningSession.id, status: "lost" })
  })

  it("readSession returns restored output after start", async () => {
    const group = createGroup()
    const session = createSession({ status: "exited", lastOutputSeq: 2, endedAt: "2026-06-24T00:00:03.000Z" })
    const output = [
      createOutput({ seq: 1, data: "old" }),
      createOutput({ seq: 2, data: " output" }),
    ]
    const service = await createStartedService(createMemoryStore({
      groups: [group],
      sessions: [session],
      output,
    }))

    expect(service.readSession({ sessionId: session.id })).toMatchObject({
      session,
      chunks: output,
      nextSeq: 2,
      firstSeq: 1,
      truncated: false,
    })
  })

  it("resizeSession updates metadata and calls pty.resize", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({ cols: 80, rows: 24 })

    await service.resizeSession({ sessionId: session.id, cols: 120, rows: 40 })

    expect(pty.resize).toHaveBeenCalledWith(120, 40)
    expect(service.getSession({ sessionId: session.id })).toMatchObject({ cols: 120, rows: 40 })
  })

  it("resizeSession throws when the session is not running", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({})
    pty.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()

    await expect(service.resizeSession({ sessionId: session.id, cols: 100, rows: 30 }))
      .rejects.toThrow("Terminal session is not running")
  })

  it("stopSession marks killed and calls pty.kill; MCP stop is blocked without agent control", async () => {
    const store = createMemoryStore()
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})

    await expect(service.stopSession({ sessionId: session.id, actor: "mcp" }))
      .rejects.toThrow("Agent control is disabled")
    expect(pty.kill).not.toHaveBeenCalled()

    await service.stopSession({ sessionId: session.id, actor: "user" })

    expect(pty.kill).toHaveBeenCalledTimes(1)
    expect(service.getSession({ sessionId: session.id })).toMatchObject({ status: "killed" })
    expect(store.state.sessions.find((item) => item.id === session.id)?.status).toBe("killed")
  })

  it("stopSession throws when the session is not running", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({})
    pty.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()

    await expect(service.stopSession({ sessionId: session.id, actor: "user" }))
      .rejects.toThrow("Terminal session is not running")
  })

  it("onExit marks exited and removes runtime", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({})
    const onSessionChanged = vi.fn()
    service.events.on("sessionChanged", onSessionChanged)

    pty.emitExit({ exitCode: 2, signal: 15 })
    await service.flushPersistQueue()

    expect(service.getSession({ sessionId: session.id })).toMatchObject({
      status: "exited",
      exitCode: 2,
      signal: 15,
    })
    expect(onSessionChanged).toHaveBeenCalledWith(expect.objectContaining({
      id: session.id,
      status: "exited",
      exitCode: 2,
      signal: 15,
    }))
    expect(() => service.writeSession({ sessionId: session.id, data: "x", actor: "user" }))
      .toThrow("Terminal session is not running")
  })

  it("onExit keeps killed status when a killed session exits", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({})

    await service.stopSession({ sessionId: session.id, actor: "user" })
    pty.emitExit({ exitCode: 1 })
    await service.flushPersistQueue()

    expect(service.getSession({ sessionId: session.id })).toMatchObject({
      status: "killed",
      exitCode: 1,
    })
  })

  it("setAgentControl persists agent control changes", async () => {
    const store = createMemoryStore()
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})

    await service.setAgentControl({ sessionId: session.id, enabled: true })

    expect(store.state.sessions.find((item) => item.id === session.id)?.agentControl).toBe("enabled")
  })

  it("serializes quick output persistence and preserves final state", async () => {
    let activeSaves = 0
    let maxActiveSaves = 0
    const store = createMemoryStore(undefined, async () => {
      activeSaves += 1
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeSaves -= 1
    })
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})

    pty.emitData("one")
    pty.emitData("two")
    pty.emitData("three")
    await service.flushPersistQueue()

    expect(maxActiveSaves).toBe(1)
    expect(store.state.sessions.find((item) => item.id === session.id)?.lastOutputSeq).toBe(3)
    expect(store.state.output.map((chunk) => chunk.data)).toEqual(["one", "two", "three"])
  })

  it("stop kills live ptys and persists sessions as lost", async () => {
    const store = createMemoryStore()
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})
    pty.kill.mockImplementation(() => pty.emitExit({ exitCode: 143, signal: 15 }))

    await service.stop()

    expect(pty.kill).toHaveBeenCalledTimes(1)
    expect(service.getSession({ sessionId: session.id })).toMatchObject({
      status: "lost",
      exitCode: 143,
      signal: 15,
    })
    expect(store.state.sessions.find((item) => item.id === session.id)?.status).toBe("lost")
    expect(() => service.writeSession({ sessionId: session.id, data: "x", actor: "user" }))
      .toThrow("Terminal session is not running")
  })

  it("coalesces quick output persistence into a bounded number of saves", async () => {
    const saveStarted: Array<() => void> = []
    const saveCalls: TerminalStoreState[] = []
    let blockSaves = false
    const store = createMemoryStore(undefined, async (state) => {
      saveCalls.push(structuredClone(state))
      if (blockSaves) await new Promise<void>((resolve) => saveStarted.push(resolve))
    })
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})

    blockSaves = true
    for (let index = 0; index < 100; index += 1) {
      pty.emitData(`chunk-${index}`)
    }
    expect(saveStarted).toHaveLength(1)
    expect(service.getPersistDiagnostics().idleWaiterCount).toBe(0)

    saveStarted.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saveStarted).toHaveLength(1)
    saveStarted.shift()?.()
    await service.flushPersistQueue()

    const outputSaves = saveCalls.filter((state) => state.output.length > 0)
    expect(outputSaves).toHaveLength(2)
    expect(store.state.sessions.find((item) => item.id === session.id)?.lastOutputSeq).toBe(100)
    expect(store.state.output).toHaveLength(100)
    expect(store.state.output.at(-1)?.data).toBe("chunk-99")
  })

  it("surfaces and logs persistence failures", async () => {
    const persistError = new Error("disk full")
    const logger = { warn: vi.fn(), error: vi.fn() }
    const store = createMemoryStore(undefined, async (state) => {
      if (state.output.length > 0) throw persistError
    })
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty], logger })
    await service.createSession({})

    pty.emitData("lost")
    await service.flushPersistQueue()

    expect(service.getLastPersistError()).toBe(persistError)
    expect(logger.warn).toHaveBeenCalledWith("Terminal service failed to persist state.", {
      error: persistError,
    })
  })
})

async function createStartedService(
  store: TerminalStore,
  options: {
    ptys?: FakePty[]
    logger?: { warn(message: string, meta?: Record<string, unknown>): void }
  } = {},
): Promise<TerminalService> {
  const queue = [...(options.ptys ?? [])]
  const service = createTerminalService({
    store,
    outputRetentionBytes: 10 * 1024,
    resolveDefaultShell: () => "/bin/zsh",
    resolveDefaultCwd: () => tempDir,
    logger: options.logger,
    spawnPty: () => {
      const next = queue.shift()
      if (!next) throw new Error("No fake pty available")
      return next
    },
  })
  await service.start()
  return service
}

function createMemoryStore(
  initial: TerminalStoreState = { groups: [], sessions: [], output: [] },
  onSave?: (state: TerminalStoreState) => Promise<void>,
): TerminalStore & { state: TerminalStoreState } {
  const store = {
    state: structuredClone(initial),
    async loadState() {
      return structuredClone(store.state)
    },
    async saveState(state: TerminalStoreState) {
      await onSave?.(state)
      store.state = structuredClone(state)
    },
  }
  return store
}

function createGroup(overrides: Partial<TerminalGroup> = {}): TerminalGroup {
  return {
    id: "g1",
    name: "Default",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    sortOrder: 0,
    ...overrides,
  }
}

function createSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    groupId: "g1",
    title: "zsh",
    cwd: tempDir,
    shell: "/bin/zsh",
    status: "running",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    agentControl: "disabled",
    cols: 80,
    rows: 24,
    lastOutputSeq: 0,
    ...overrides,
  }
}

function createOutput(overrides: Partial<TerminalOutputChunk> = {}): TerminalOutputChunk {
  return {
    sessionId: "s1",
    seq: 1,
    data: "hello",
    createdAt: "2026-06-24T00:00:01.000Z",
    source: "pty",
    ...overrides,
  }
}
