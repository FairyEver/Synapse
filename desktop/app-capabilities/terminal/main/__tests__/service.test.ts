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

  it("renames a session with a trimmed title and persists the update", async () => {
    const store = createMemoryStore()
    const service = await createStartedService(store, { ptys: [new FakePty()] })
    const session = await service.createSession({ title: "Shell" })
    const onSessionChanged = vi.fn()
    service.events.on("sessionChanged", onSessionChanged)

    const updated = await withSessionActions(service).renameSession({
      sessionId: session.id,
      title: "  Build logs  ",
    })

    expect(updated).toMatchObject({ id: session.id, title: "Build logs" })
    expect(service.getSession({ sessionId: session.id }).title).toBe("Build logs")
    expect(store.state.sessions.find((item) => item.id === session.id)?.title).toBe("Build logs")
    expect(onSessionChanged).toHaveBeenCalledWith(expect.objectContaining({
      id: session.id,
      title: "Build logs",
    }))
  })

  it("renames a group with a trimmed name and persists the update", async () => {
    const group = createGroup({ name: "默认分组" })
    const store = createMemoryStore({ groups: [group], sessions: [], output: [] })
    const service = await createStartedService(store)

    const updated = await withGroupActions(service).renameGroup({
      groupId: group.id,
      name: "  构建  ",
    })

    expect(updated).toMatchObject({ id: group.id, name: "构建" })
    expect(service.listGroups()).toEqual([expect.objectContaining({ id: group.id, name: "构建" })])
    expect(store.state.groups).toEqual([expect.objectContaining({ id: group.id, name: "构建" })])
  })

  it("rejects empty renamed terminal group names", async () => {
    const group = createGroup()
    const service = await createStartedService(createMemoryStore({ groups: [group], sessions: [], output: [] }))

    await expect(withGroupActions(service).renameGroup({
      groupId: group.id,
      name: "   ",
    })).rejects.toThrow("Terminal group name is required")
  })

  it("rejects empty renamed terminal titles", async () => {
    const service = await createStartedService(createMemoryStore(), { ptys: [new FakePty()] })
    const session = await service.createSession({ title: "Shell" })

    await expect(withSessionActions(service).renameSession({
      sessionId: session.id,
      title: "   ",
    })).rejects.toThrow("Terminal session title is required")
  })

  it("writes MCP raw data without session-level agent control", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({})

    service.writeSession({ sessionId: session.id, data: "\u001b[A" })

    expect(pty.write).toHaveBeenCalledWith("\u001b[A")
  })

  it("deletes an ended session and removes retained output", async () => {
    const group = createGroup()
    const session = createSession({ status: "exited", endedAt: "2026-06-24T00:00:03.000Z", lastOutputSeq: 2 })
    const store = createMemoryStore({
      groups: [group],
      sessions: [session],
      output: [
        createOutput({ seq: 1, data: "old" }),
        createOutput({ seq: 2, data: " output" }),
      ],
    })
    const service = await createStartedService(store)
    const onSessionDeleted = vi.fn()
    service.events.on("sessionDeleted", onSessionDeleted)

    await withSessionActions(service).deleteSession({ sessionId: session.id })

    expect(service.listSessions()).toEqual([])
    expect(store.state.sessions).toEqual([])
    expect(store.state.output).toEqual([])
    expect(onSessionDeleted).toHaveBeenCalledWith({ sessionId: session.id })
    expect(() => service.readSession({ sessionId: session.id }))
      .toThrow("Terminal session not found")
  })

  it("deletes a running session by killing the pty without reviving it on exit", async () => {
    const store = createMemoryStore()
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})
    pty.emitData("active")
    await service.flushPersistQueue()

    await withSessionActions(service).deleteSession({ sessionId: session.id })
    pty.emitExit({ exitCode: 143, signal: 15 })
    await service.flushPersistQueue()

    expect(pty.kill).toHaveBeenCalledTimes(1)
    expect(service.listSessions()).toEqual([])
    expect(store.state.sessions).toEqual([])
    expect(store.state.output).toEqual([])
    expect(() => service.writeSession({ sessionId: session.id, data: "x" }))
      .toThrow("Terminal session not found")
  })

  it("deletes an empty group and persists the update", async () => {
    const group = createGroup()
    const store = createMemoryStore({ groups: [group], sessions: [], output: [] })
    const service = await createStartedService(store)

    await withGroupActions(service).deleteGroup({ groupId: group.id })

    expect(service.listGroups()).toEqual([])
    expect(store.state.groups).toEqual([])
  })

  it("deletes a non-empty group with sessions and retained output", async () => {
    const group = createGroup()
    const session = createSession({ status: "exited", endedAt: "2026-06-24T00:00:03.000Z", lastOutputSeq: 2 })
    const otherGroup = createGroup({ id: "g2", name: "Other", sortOrder: 1 })
    const otherSession = createSession({ id: "s2", groupId: "g2" })
    const store = createMemoryStore({
      groups: [group, otherGroup],
      sessions: [session, otherSession],
      output: [
        createOutput({ sessionId: session.id, seq: 1, data: "old" }),
        createOutput({ sessionId: otherSession.id, seq: 1, data: "keep" }),
      ],
    })
    const service = await createStartedService(store)
    const onSessionDeleted = vi.fn()
    service.events.on("sessionDeleted", onSessionDeleted)

    await withGroupActions(service).deleteGroup({ groupId: group.id })

    expect(service.listGroups()).toEqual([expect.objectContaining({ id: "g2" })])
    expect(service.listSessions()).toEqual([expect.objectContaining({ id: "s2" })])
    expect(store.state.output).toEqual([expect.objectContaining({ sessionId: "s2", data: "keep" })])
    expect(onSessionDeleted).toHaveBeenCalledWith({ sessionId: session.id })
  })

  it("deletes a group with a running session by killing the pty without reviving it on exit", async () => {
    const store = createMemoryStore()
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})
    pty.emitData("active")
    await service.flushPersistQueue()

    await withGroupActions(service).deleteGroup({ groupId: session.groupId })
    pty.emitExit({ exitCode: 143, signal: 15 })
    await service.flushPersistQueue()

    expect(pty.kill).toHaveBeenCalledTimes(1)
    expect(service.listGroups()).toEqual([])
    expect(service.listSessions()).toEqual([])
    expect(store.state.output).toEqual([])
    expect(() => service.getSession({ sessionId: session.id }))
      .toThrow("Terminal session not found")
  })

  it("throws when deleting a missing group", async () => {
    const service = await createStartedService(createMemoryStore())

    await expect(withGroupActions(service).deleteGroup({ groupId: "missing" }))
      .rejects.toThrow("Terminal group not found")
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

  it("stopSession marks killed and lets MCP stop sessions without session-level agent control", async () => {
    const store = createMemoryStore()
    const pty = new FakePty()
    const service = await createStartedService(store, { ptys: [pty] })
    const session = await service.createSession({})

    await service.stopSession({ sessionId: session.id })

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

    await expect(service.stopSession({ sessionId: session.id }))
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
    expect(() => service.writeSession({ sessionId: session.id, data: "x" }))
      .toThrow("Terminal session is not running")
  })

  it("onExit keeps killed status when a killed session exits", async () => {
    const pty = new FakePty()
    const service = await createStartedService(createMemoryStore(), { ptys: [pty] })
    const session = await service.createSession({})

    await service.stopSession({ sessionId: session.id })
    pty.emitExit({ exitCode: 1 })
    await service.flushPersistQueue()

    expect(service.getSession({ sessionId: session.id })).toMatchObject({
      status: "killed",
      exitCode: 1,
    })
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
    expect(() => service.writeSession({ sessionId: session.id, data: "x" }))
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

function withSessionActions(service: TerminalService): TerminalService & {
  renameSession(input: { sessionId: string; title: string }): Promise<TerminalSession>
  deleteSession(input: { sessionId: string }): Promise<void>
} {
  return service as TerminalService & {
    renameSession(input: { sessionId: string; title: string }): Promise<TerminalSession>
    deleteSession(input: { sessionId: string }): Promise<void>
  }
}

function withGroupActions(service: TerminalService): TerminalService & {
  renameGroup(input: { groupId: string; name: string }): Promise<TerminalGroup>
  deleteGroup(input: { groupId: string }): Promise<void>
} {
  return service as TerminalService & {
    renameGroup(input: { groupId: string; name: string }): Promise<TerminalGroup>
    deleteGroup(input: { groupId: string }): Promise<void>
  }
}
