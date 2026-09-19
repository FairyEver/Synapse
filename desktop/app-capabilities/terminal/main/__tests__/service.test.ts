import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { createTerminalService, ensureExecutableIfPresent, type PtyLike } from "../service"
import type { TerminalStore, TerminalStoreState } from "../store"
import { collectTerminalPaneLeaves } from "../../shared/workspace"

const controllerA = { clientId: "client-a", controllerInstanceId: "task-a", actorKind: "connector" as const }
const controllerB = { clientId: "client-a", controllerInstanceId: "task-b", actorKind: "connector" as const }

describe("TerminalService core", () => {
  it("persists custom toolbar actions independently from built-in actions", async () => {
    const store = memoryStore()
    const service = createTerminalService({
      store,
      spawnPty: () => fakePty(),
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await service.start()

    const created = await service.createCustomToolbarAction({
      label: "  检查状态  ",
      content: "  git status  ",
      pressEnter: false,
    })
    expect(created).toMatchObject({ label: "检查状态", content: "git status", pressEnter: false, actionRevision: 1 })
    expect(service.listCustomToolbarActions()).toEqual([created])
    expect(store.state.toolbarActions).toEqual([created])

    const updated = await service.updateCustomToolbarAction({
      id: created.id,
      label: "检查分支",
      content: "git branch",
      pressEnter: true,
    })
    expect(updated).toMatchObject({ label: "检查分支", content: "git branch", pressEnter: true, actionRevision: 2 })

    await service.deleteCustomToolbarAction({ id: created.id })
    expect(service.listCustomToolbarActions()).toEqual([])
    expect(store.state.toolbarActions).toEqual([])
  })

  it("marks a present node-pty spawn helper as executable", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-helper-"))
    const filePath = path.join(root, "spawn-helper")
    writeFileSync(filePath, "helper")
    chmodSync(filePath, 0o644)
    ensureExecutableIfPresent(filePath)
    expect(statSync(filePath).mode & 0o111).not.toBe(0)
  })

  it("records PTY startup failures with session context", async () => {
    const logger = { warn: vi.fn() }
    const launchError = new Error("posix_spawnp failed")
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty: () => { throw launchError },
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
      logger,
    })
    await service.start()

    const session = await service.createSession({})

    expect(session.status).toBe("failed")
    expect(service.listSessions()).toEqual([])
    expect(service.listWorkspaces()).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      "Terminal PTY process failed to start.",
      { sessionId: session.id, error: launchError },
    )
  })

  it("creates one UI/MCP-visible session, records real output, and invalidates attention evidence", async () => {
    const harness = await startedHarness()
    const session = await harness.service.createSession({ title: "Shell" })
    harness.pty.emitData("hello\r\n")
    await harness.service.flushPersistQueue()
    const read = harness.service.readSession({ sessionId: session.id })
    expect(read.chunks.map((chunk) => chunk.data)).toEqual(["hello\r\n"])
    expect(read.session.attention).toMatchObject({ state: "unknown", reason: "output_changed", throughOutputSeq: 1 })
    expect(harness.service.listSessions().map((item) => item.id)).toContain(session.id)
  })

  it("records hook-driven waiting attention without repeating identical evidence", async () => {
    const harness = await startedHarness()
    const session = await harness.service.createSession({ title: "Claude Code" })
    const changeTypes: string[] = []
    harness.service.events.on("stateChanged", (payload: { changeTypes: string[] }) => {
      changeTypes.push(...payload.changeTypes)
    })

    harness.service.applyAgentAttention({
      sessionId: session.id,
      state: "waiting",
      kind: "approval",
      reason: "agent_permission_request",
    })

    const waiting = harness.service.getSessionState(session.id)
    expect(waiting.attention).toMatchObject({
      state: "waiting",
      kind: "approval",
      reason: "agent_permission_request",
      confidence: 1,
      detectorId: "agent-hook-v1",
      throughOutputSeq: session.lastOutputSeq,
    })
    expect(waiting.stateRevision).toBe(session.stateRevision + 1)
    expect(changeTypes).toEqual(["attention.waiting"])

    harness.service.applyAgentAttention({
      sessionId: session.id,
      state: "waiting",
      kind: "approval",
      reason: "agent_permission_request",
    })
    expect(harness.service.getSessionState(session.id).stateRevision).toBe(waiting.stateRevision)

    harness.pty.emitData("still waiting\r\n")
    await harness.service.flushPersistQueue()
    const afterOutput = harness.service.getSessionState(session.id)
    expect(afterOutput.attention).toMatchObject({
      state: "waiting",
      kind: "approval",
      detectorId: "agent-hook-v1",
    })
    expect(afterOutput.stateRevision).toBeGreaterThan(waiting.stateRevision)

    harness.service.applyAgentAttention({
      sessionId: session.id,
      state: "not_waiting",
      kind: "unknown",
      reason: "user_input",
    })
    expect(harness.service.getSessionState(session.id).attention).toMatchObject({
      state: "not_waiting",
      detectorId: "agent-hook-v1",
    })
    expect(changeTypes.filter((type) => type.startsWith("attention."))).toEqual([
      "attention.waiting",
      "attention.cleared",
    ])

    expect(() => harness.service.applyAgentAttention({
      sessionId: "00000000-0000-4000-8000-000000000000",
      state: "waiting",
      kind: "approval",
      reason: "agent_permission_request",
    })).not.toThrow()
  })

  it("uses the OSC 7 working directory and falls back to the launch cwd", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    expect(service.getCurrentWorkingDirectory(session.id)).toBe(session.cwd)
    const changed = new Promise<{ sessionId: string }>((resolve) => {
      service.events.once("workingDirectoryChanged", resolve)
    })

    pty.emitData("\u001b]7;file:///tmp\u0007")

    await expect(changed).resolves.toEqual({ sessionId: session.id })
    expect(service.getCurrentWorkingDirectory(session.id)).toBe("/tmp")
  })

  it("batches PTY output into one incremental runtime save", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"))
    try {
      const pty = fakePty()
      const store = memoryStore()
      const fullSave = vi.spyOn(store, "saveState")
      const runtimeSave = vi.fn(async () => undefined)
      store.saveRuntimeState = runtimeSave
      const service = createTerminalService({
        store,
        spawnPty: () => pty,
        resolveDefaultShell: () => "/bin/zsh",
        resolveDefaultCwd: () => os.tmpdir(),
      })
      await service.start()
      await service.createSession({})
      fullSave.mockClear()

      for (let index = 0; index < 100; index += 1) pty.emitData(`line-${index}\n`)
      expect(runtimeSave).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(250)
      await service.flushPersistQueue()

      expect(fullSave).not.toHaveBeenCalled()
      expect(runtimeSave).toHaveBeenCalledTimes(1)
      expect(runtimeSave.mock.calls[0]?.[0].sessions).toHaveLength(1)
      expect(runtimeSave.mock.calls[0]?.[0].sessions[0]?.output).toHaveLength(100)
      expect(runtimeSave.mock.calls[0]?.[0].sessions[0]?.checkpoint).toBeUndefined()

      await vi.advanceTimersByTimeAsync(5_000)
      pty.emitData("checkpoint\n")
      await vi.advanceTimersByTimeAsync(250)
      await service.flushPersistQueue()

      expect(runtimeSave).toHaveBeenCalledTimes(2)
      expect(runtimeSave.mock.calls[1]?.[0].sessions[0]?.output).toHaveLength(1)
      expect(runtimeSave.mock.calls[1]?.[0].sessions[0]?.checkpoint).toMatchObject({ throughOutputSeq: 101 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("creates one sidebar workspace and recursively splits its focused pane", async () => {
    const ptys = [fakePty(), fakePty(), fakePty()]
    let spawnIndex = 0
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty: () => ptys[spawnIndex++]!,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await service.start()
    const rootSession = await service.createSession({ title: "Workspace" })
    const workspace = service.getWorkspaceForSession({ sessionId: rootSession.id })
    const rootPane = workspace.layout.type === "leaf" ? workspace.layout : null
    expect(rootPane).not.toBeNull()

    const right = await service.splitPane({
      workspaceId: workspace.id,
      paneId: rootPane!.paneId,
      direction: "right",
      expectedLayoutRevision: workspace.layoutRevision,
    })
    const down = await service.splitPane({
      workspaceId: workspace.id,
      paneId: right.paneId,
      direction: "down",
      expectedLayoutRevision: right.workspace.layoutRevision,
    })

    expect(service.listWorkspaces()).toHaveLength(1)
    expect(collectPaneSessionIds(down.workspace.layout)).toHaveLength(3)
    expect(down.workspace.layout).toMatchObject({
      type: "split",
      direction: "horizontal",
      second: { type: "split", direction: "vertical" },
    })
  })

  it("reorders existing panes without creating or stopping terminal sessions", async () => {
    const ptys = [fakePty(), fakePty(), fakePty()]
    let spawnIndex = 0
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty: () => ptys[spawnIndex++]!,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await service.start()
    const rootSession = await service.createSession({ title: "Workspace" })
    const initial = service.getWorkspaceForSession({ sessionId: rootSession.id })
    const rootPaneId = initial.layout.type === "leaf" ? initial.layout.paneId : ""
    const right = await service.splitPane({
      workspaceId: initial.id,
      paneId: rootPaneId,
      direction: "right",
      expectedLayoutRevision: initial.layoutRevision,
    })
    const down = await service.splitPane({
      workspaceId: initial.id,
      paneId: right.paneId,
      direction: "down",
      expectedLayoutRevision: right.workspace.layoutRevision,
    })

    const moved = await service.movePane({
      workspaceId: initial.id,
      sourcePaneId: down.paneId,
      targetPaneId: rootPaneId,
      edge: "bottom",
      expectedLayoutRevision: down.workspace.layoutRevision,
    })

    expect(moved.layoutRevision).toBe(down.workspace.layoutRevision + 1)
    expect(collectPaneSessionIds(moved.layout)).toEqual(expect.arrayContaining(
      collectPaneSessionIds(down.workspace.layout),
    ))
    expect(collectPaneSessionIds(moved.layout)).toHaveLength(3)
    expect(moved.layout).toMatchObject({
      type: "split",
      direction: "horizontal",
      first: {
        type: "split",
        direction: "vertical",
        first: { paneId: rootPaneId },
        second: { paneId: down.paneId },
      },
      second: { paneId: right.paneId },
    })
    expect(spawnIndex).toBe(3)
    expect(ptys.every((pty) => pty.kill.mock.calls.length === 0)).toBe(true)
  })

  it("persists a pane group equalization as one layout revision", async () => {
    const ptys = [fakePty(), fakePty(), fakePty()]
    let spawnIndex = 0
    const store = memoryStore()
    const service = createTerminalService({
      store,
      spawnPty: () => ptys[spawnIndex++]!,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await service.start()
    const rootSession = await service.createSession({ title: "Workspace" })
    const initial = service.getWorkspaceForSession({ sessionId: rootSession.id })
    const rootPaneId = initial.layout.type === "leaf" ? initial.layout.paneId : ""
    const second = await service.splitPane({
      workspaceId: initial.id,
      paneId: rootPaneId,
      direction: "right",
      expectedLayoutRevision: initial.layoutRevision,
    })
    const third = await service.splitPane({
      workspaceId: initial.id,
      paneId: second.paneId,
      direction: "right",
      expectedLayoutRevision: second.workspace.layoutRevision,
    })

    const equalized = await service.equalizePane({
      workspaceId: initial.id,
      paneId: third.paneId,
      expectedLayoutRevision: third.workspace.layoutRevision,
    })

    expect(equalized.layoutRevision).toBe(third.workspace.layoutRevision + 1)
    expect(equalized.layout).toMatchObject({
      type: "split",
      ratio: 1 / 3,
      second: { type: "split", ratio: 0.5 },
    })
    expect(store.state.workspaces).toContainEqual(equalized)
  })

  it("closes one pane after its PTY exits and deletes the whole workspace from the sidebar", async () => {
    const ptys = [fakePty(), fakePty()]
    let spawnIndex = 0
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty: () => ptys[spawnIndex++]!,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await service.start()
    const root = await service.createSession({ title: "Workspace" })
    const initial = service.getWorkspaceForSession({ sessionId: root.id })
    const rootPaneId = initial.layout.type === "leaf" ? initial.layout.paneId : ""
    const split = await service.splitPane({
      workspaceId: initial.id,
      paneId: rootPaneId,
      direction: "right",
      expectedLayoutRevision: initial.layoutRevision,
    })

    const closingPane = await service.closePane({
      workspaceId: split.workspace.id,
      paneId: split.paneId,
      expectedLayoutRevision: split.workspace.layoutRevision,
    })
    expect(closingPane.state).toBe("closing")
    ptys[1]!.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()
    const collapsed = service.getWorkspace({ workspaceId: initial.id })
    expect(collapsed.layout).toMatchObject({ type: "leaf", sessionId: root.id })

    const closingWorkspace = await service.closeWorkspace({
      workspaceId: collapsed.id,
      expectedLayoutRevision: collapsed.layoutRevision,
    })
    expect(closingWorkspace.state).toBe("closing")
    ptys[0]!.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()
    expect(service.listWorkspaces()).toEqual([])
    expect(service.listSessions()).toEqual([])
  })

  it("removes every persisted session and workspace after restart", async () => {
    const store = memoryStore()
    const ptys = [fakePty(), fakePty()]
    let spawnIndex = 0
    const service = createTerminalService({
      store,
      spawnPty: () => ptys[spawnIndex++]!,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await service.start()
    const root = await service.createSession({ title: "Workspace" })
    const initial = service.getWorkspaceForSession({ sessionId: root.id })
    const split = await service.splitPane({
      workspaceId: initial.id,
      paneId: initial.layout.type === "leaf" ? initial.layout.paneId : "",
      direction: "right",
      expectedLayoutRevision: initial.layoutRevision,
    })
    await service.closePane({
      workspaceId: initial.id,
      paneId: split.paneId,
      expectedLayoutRevision: split.workspace.layoutRevision,
    })

    const recovered = createTerminalService({
      store,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await recovered.start()

    expect(recovered.listWorkspaces()).toEqual([])
    expect(recovered.listSessions()).toEqual([])
    expect(store.state.workspaces).toEqual([])
    expect(store.state.sessions).toEqual([])
    expect(store.state.output).toEqual([])
    expect(store.state.checkpoints).toEqual([])
  })

  it("purges legacy ended, failed, and lost sessions during startup", async () => {
    const store = memoryStore()
    const ptys = [fakePty(), fakePty(), fakePty()]
    let spawnIndex = 0
    const first = createTerminalService({
      store,
      spawnPty: () => ptys[spawnIndex++]!,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await first.start()
    await first.createSession({ title: "Ended" })
    await first.createSession({ title: "Failed" })
    await first.createSession({ title: "Lost" })
    await first.flushPersistQueue()
    const terminalStatuses = ["ended", "failed", "lost"] as const
    store.state.sessions = store.state.sessions.map((session, index) => ({
      ...session,
      status: terminalStatuses[index]!,
      endCause: "legacy_terminal_record",
      endedAt: "2026-09-07T00:00:00.000Z",
    }))

    const recovered = createTerminalService({
      store,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await recovered.start()

    expect(recovered.listSessions()).toEqual([])
    expect(recovered.listWorkspaces()).toEqual([])
    expect(store.state.sessions).toEqual([])
    expect(store.state.workspaces).toEqual([])
  })

  it("destroys all terminal sessions while stopping the application service", async () => {
    const store = memoryStore()
    const ptys = [fakePty(), fakePty()]
    let spawnIndex = 0
    const service = createTerminalService({
      store,
      spawnPty: () => ptys[spawnIndex++]!,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
    })
    await service.start()
    await service.createSession({ title: "First" })
    await service.createSession({ title: "Second" })
    ptys[0]!.emitData("first output")
    ptys[1]!.emitData("second output")

    await service.stop()

    expect(ptys.every((pty) => pty.kill.mock.calls.length === 1)).toBe(true)
    expect(service.listSessions()).toEqual([])
    expect(service.listWorkspaces()).toEqual([])
    expect(store.state.sessions).toEqual([])
    expect(store.state.workspaces).toEqual([])
    expect(store.state.output).toEqual([])
    expect(store.state.operations).toEqual([])
    expect(store.state.idempotency).toEqual([])
    expect(store.state.checkpoints).toEqual([])
  })

  it("creates an ungrouped UI session in the first terminal group", async () => {
    const harness = await startedHarness()
    const firstGroup = harness.service.listGroups()[0]!
    await harness.service.createGroup({ name: "Second" })

    const session = await harness.service.createSession({})

    expect(session.groupId).toBe(firstGroup.id)
  })

  it("recreates the default group when an ungrouped UI session has no group", async () => {
    const harness = await startedHarness()
    const originalGroup = harness.service.listGroups()[0]!
    await harness.service.deleteGroup({ groupId: originalGroup.id })

    const session = await harness.service.createSession({})

    expect(harness.service.getGroup(session.groupId).name).toBe("默认")
  })

  it("reorders terminal groups and persists the new order", async () => {
    const store = memoryStore()
    const harness = await startedHarness(store)
    const firstGroup = harness.service.listGroups()[0]!
    const secondGroup = await harness.service.createGroup({ name: "Second" })
    const thirdGroup = await harness.service.createGroup({ name: "Third" })
    const reorderedEvents: Array<{ eventType: string; objectId: string }> = []
    harness.service.events.on("domainChanged", (event: { eventType: string; objectId: string }) => {
      if (event.eventType === "group.reordered") reorderedEvents.push(event)
    })

    const reordered = await harness.service.reorderGroups({
      groupIds: [thirdGroup.id, firstGroup.id, secondGroup.id],
    })

    expect(reordered.map((group) => group.id)).toEqual([thirdGroup.id, firstGroup.id, secondGroup.id])
    expect(reordered.map((group) => group.sortOrder)).toEqual([0, 1, 2])
    expect([...store.state.groups]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((group) => [group.id, group.sortOrder]))
      .toEqual([[thirdGroup.id, 0], [firstGroup.id, 1], [secondGroup.id, 2]])
    expect(harness.service.getGroup(thirdGroup.id).groupRevision).toBe(2)
    expect(harness.service.getGroup(secondGroup.id).groupRevision).toBe(2)
    expect(reorderedEvents.map((event) => event.objectId))
      .toEqual([thirdGroup.id, firstGroup.id, secondGroup.id])
  })

  it("rejects a terminal group order that is not a full permutation", async () => {
    const store = memoryStore()
    const harness = await startedHarness(store)
    const firstGroup = harness.service.listGroups()[0]!
    const secondGroup = await harness.service.createGroup({ name: "Second" })
    const storedOrder = store.state.groups.map((group) => [group.id, group.sortOrder])

    await expect(harness.service.reorderGroups({ groupIds: [] })).rejects.toMatchObject({
      payload: { code: "invalid_argument" },
    })
    await expect(harness.service.reorderGroups({ groupIds: [firstGroup.id] })).rejects.toMatchObject({
      payload: { code: "invalid_argument" },
    })
    await expect(harness.service.reorderGroups({
      groupIds: [secondGroup.id, firstGroup.id, secondGroup.id],
    })).rejects.toMatchObject({ payload: { code: "invalid_argument" } })
    await expect(harness.service.reorderGroups({
      groupIds: [firstGroup.id, "019f8a39-0000-7000-8000-000000000999"],
    })).rejects.toMatchObject({ payload: { code: "invalid_argument" } })

    expect(harness.service.listGroups().map((group) => group.id))
      .toEqual([firstGroup.id, secondGroup.id])
    expect(store.state.groups.map((group) => [group.id, group.sortOrder])).toEqual(storedOrder)
  })

  it("skips persistence when the terminal group order is unchanged", async () => {
    const store = memoryStore()
    let saveCount = 0
    const countingStore: TerminalStore = {
      ...store,
      async saveState(state) {
        saveCount += 1
        await store.saveState(state)
      },
    }
    const harness = await startedHarness(countingStore)
    const firstGroup = harness.service.listGroups()[0]!
    const secondGroup = await harness.service.createGroup({ name: "Second" })
    const reorderedEvents: string[] = []
    harness.service.events.on("domainChanged", (event: { eventType: string }) => {
      if (event.eventType === "group.reordered") reorderedEvents.push(event.eventType)
    })
    const savesBefore = saveCount

    const reordered = await harness.service.reorderGroups({
      groupIds: [firstGroup.id, secondGroup.id],
    })

    expect(reordered.map((group) => group.id)).toEqual([firstGroup.id, secondGroup.id])
    expect(saveCount).toBe(savesBefore)
    expect(reorderedEvents).toEqual([])
  })

  it("records explicit launch overrides as redacted facts", async () => {
    const harness = await startedHarness()
    const cwd = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-override-"))
    const session = await harness.service.createSessionOverride({
      title: "Override",
      overrides: { cwd, cols: 100 },
      idempotencyKey: "019f8a39-0000-7000-8000-000000000000",
    }, "client-a")
    expect(session.launchFacts).toMatchObject({
      cwdKind: "override",
      overriddenFields: ["cwd", "cols"],
      cols: 100,
      legacyUnversioned: false,
    })
  })

  it("launches an embedded agent CLI with a caller-owned environment that is never persisted", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-ephemeral-"))
    const pty = fakePty()
    const spawnPty = vi.fn(() => pty)
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => cwd,
      resolveEffectivePath: () => "/usr/bin:/bin",
      appVersion: "9.8.7",
    })
    await service.start()

    const onEnded = vi.fn()
    const session = await service.createSessionWithEphemeralEnvironment({
      title: "Claude Code",
      cwd,
      shell: "/bin/zsh",
      args: ["--settings", "/tmp/claude-code-settings.json"],
      environment: { ANTHROPIC_AUTH_TOKEN: "secret-token", DISABLE_AUTOUPDATER: "1" },
      onEnded,
    })

    expect(session.launchEnvironment).toBeUndefined()
    expect(session.launchFacts?.environmentKeys).toEqual(["ANTHROPIC_AUTH_TOKEN", "DISABLE_AUTOUPDATER"])
    expect(JSON.stringify(session)).not.toContain("secret-token")
    expect(spawnPty).toHaveBeenCalledWith(expect.objectContaining({
      shellArgs: ["--settings", "/tmp/claude-code-settings.json"],
      env: expect.objectContaining({ ANTHROPIC_AUTH_TOKEN: "secret-token", DISABLE_AUTOUPDATER: "1" }),
    }))
    expect(onEnded).not.toHaveBeenCalled()
    pty.emitExit({ exitCode: 0 })
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it("births an embedded agent CLI at the requested grid, in the PTY and in the record", async () => {
    // The CLI paints its banner at whatever width the PTY has, and those lines stay in
    // scrollback at that width forever — so the size has to be part of the spawn, not a
    // resize afterwards (ADR 0063). Asserted on the spawn call itself because a session
    // record that merely *says* the right size would still have launched at the default.
    const cwd = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-ephemeral-grid-"))
    const spawnPty = vi.fn(() => fakePty())
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => cwd,
      resolveEffectivePath: () => "/usr/bin:/bin",
    })
    await service.start()

    const session = await service.createSessionWithEphemeralEnvironment({
      title: "Claude Code · Synapse",
      cwd,
      shell: "/bin/zsh",
      environment: { ANTHROPIC_AUTH_TOKEN: "secret-token" },
      cols: 54,
      rows: 37,
    })

    expect(spawnPty).toHaveBeenCalledWith(expect.objectContaining({ cols: 54, rows: 37 }))
    expect(session).toMatchObject({ cols: 54, rows: 37 })
    // Recorded as an override so the group's own default shape cannot be read back over it.
    expect(session.launchFacts?.overriddenFields).toEqual(["cwd", "shell", "environment", "cols", "rows"])

    // Omitted, the session keeps taking the default shape; the pair stays optional.
    const unsized = await service.createSessionWithEphemeralEnvironment({
      title: "Claude Code · Synapse",
      cwd,
      shell: "/bin/zsh",
      environment: { ANTHROPIC_AUTH_TOKEN: "secret-token" },
    })
    expect(unsized.launchFacts?.overriddenFields).toEqual(["cwd", "shell", "environment"])
    expect(spawnPty).toHaveBeenLastCalledWith(expect.objectContaining({
      cols: unsized.cols,
      rows: unsized.rows,
    }))
  })

  it("applies global, group, and command launch settings to new PTYs only", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-layers-"))
    const spawnPty = vi.fn(() => fakePty())
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => cwd,
      resolveEffectivePath: () => "/usr/bin:/bin",
      appVersion: "9.8.7",
    })
    await service.start()
    const before = await service.createSession({ title: "Before" })
    await service.updateGlobalLaunchSettings({
      expectedRevision: 1,
      settings: { environment: { GROK_SCROLL_MODE: "wheel", GROK_SCROLL_LINES: "9", EMPTY: "" } },
    })
    const group = await service.createGroup({ name: "Grok" })
    await service.updateGroupSettings({
      groupId: group.id,
      name: group.name,
      settings: { environment: { GROK_SCROLL_LINES: "12", GROUP_ONLY: "yes" } },
    })
    const command = await service.createGroupCommand({
      groupId: group.id,
      name: "Resume",
      command: "grok --resume",
      launch: { environment: { GROUP_ONLY: null, COMMAND_ONLY: "yes" } },
    })
    const launched = await service.launchGroupCommand({ groupId: group.id, commandId: command.id })

    expect(before.launchEnvironment).toBeUndefined()
    expect(before.globalLaunchRevisionApplied).toBe(1)
    expect(launched.launchEnvironment).toEqual({
      GROK_SCROLL_MODE: "wheel",
      GROK_SCROLL_LINES: "12",
      EMPTY: "",
      COMMAND_ONLY: "yes",
    })
    expect(launched.globalLaunchRevisionApplied).toBe(2)
    expect(spawnPty).toHaveBeenLastCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        GROK_SCROLL_MODE: "wheel",
        GROK_SCROLL_LINES: "12",
        EMPTY: "",
        COMMAND_ONLY: "yes",
        TERM_PROGRAM: "Synapse",
        TERM_PROGRAM_VERSION: "9.8.7",
      }),
    }))
    expect(spawnPty.mock.lastCall?.[0].env).not.toHaveProperty("GROUP_ONLY")
  })

  it("tells a PTY which session and workspace it is, without writing the identity down", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-identity-"))
    const store = memoryStore()
    const spawnPty = vi.fn(() => fakePty())
    const service = createTerminalService({
      store,
      spawnPty,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => cwd,
      resolveEffectivePath: () => "/usr/bin:/bin",
      appVersion: "9.8.7",
    })
    await service.start()

    const session = await service.createSession({ title: "Identity" })
    const workspace = service.getWorkspaceForSession({ sessionId: session.id })
    expect(spawnPty).toHaveBeenLastCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        SYNAPSE_SESSION_ID: session.id,
        SYNAPSE_WORKSPACE_ID: workspace.id,
      }),
    }))

    // 身份是运行期的，不是配置：它只活在这一颗进程的环境里，落盘的会话记录里一个字都不该有，
    // 否则它会跟着普通备份和加密 body 一起走。
    expect(store.state.sessions.some((entry) =>
      JSON.stringify(entry).includes("SYNAPSE_SESSION_ID"))).toBe(false)

    // 分屏出来的 pane 在它自己的进程启动之后才被挂进 workspace，所以那一颗 PTY 只拿得到
    // 会话身份。这是一条有意的边界，不是漏注入——用断言把它钉住，免得以后有人「顺手」
    // 让它变一致却对不上真实时序。
    const rootPane = workspace.layout.type === "leaf" ? workspace.layout : null
    const split = await service.splitPane({
      workspaceId: workspace.id,
      paneId: rootPane!.paneId,
      direction: "right",
      expectedLayoutRevision: workspace.layoutRevision,
    })
    const splitEnv = spawnPty.mock.lastCall?.[0].env
    expect(splitEnv).toMatchObject({ SYNAPSE_SESSION_ID: split.sessionId })
    expect(splitEnv).not.toHaveProperty("SYNAPSE_WORKSPACE_ID")
  })

  it("allows one MCP client to keep more than eight sessions running", async () => {
    const { service } = await startedHarness()
    for (let index = 0; index < 9; index += 1) {
      await service.createMcpSession({
        title: `Session ${index + 1}`,
        idempotencyKey: `terminal-client-session-${index + 1}`,
      }, "client-a")
    }
    expect(service.listSessions().filter((session) => session.status === "running")).toHaveLength(9)
  })

  it("allows only one controller instance to hold the automation write lease", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000001",
    }, controllerA)
    expect(lease.leaseId).toBeTruthy()
    expect(lease.inputRevision).toBe(0)
    expect(() => service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000002",
    }, controllerB)).toThrow("control_busy")
    expect(service.getSessionState(session.id, controllerB).lease).toMatchObject({ occupied: true, own: false })
  })

  it("invalidates leases and bounded observes when unified authorization is revoked", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({})
    service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000003",
    }, controllerA)
    const observation = service.observe({
      sessionId: session.id,
      afterStateRevision: service.getSession({ sessionId: session.id }).stateRevision,
      afterOutputSeq: 0, maxWaitMs: 10_000,
    }, false, controllerA.clientId)
    service.revokeClientAccess(controllerA.clientId, `terminal:session:${session.id}`)
    expect(service.getSessionState(session.id, controllerA).lease).toMatchObject({ occupied: false })
    await expect(observation).resolves.toMatchObject({ cancelled: true })
  })

  it("orders semantic input by expectedInputRevision and returns idempotent results", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000010",
    }, controllerA)
    const request = {
      sessionId: session.id,
      leaseId: lease.leaseId,
      expectedInputRevision: 0,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000011",
      actions: [{ type: "text" as const, text: "pwd" }, { type: "key" as const, key: "Enter" as const }],
    }
    const first = service.sendSemanticInput(request, controllerA)
    const retry = service.sendSemanticInput(request, controllerA)
    expect(retry).toEqual(first)
    const renewed = service.renewControl({
      sessionId: session.id,
      leaseId: lease.leaseId,
      requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000013",
    }, controllerA)
    expect(renewed.inputRevision).toBe(1)
    expect(pty.write).toHaveBeenCalledTimes(2)
    expect(service.getSession({ sessionId: session.id }).inputRevision).toBe(1)
    expect(() => service.sendSemanticInput({ ...request, idempotencyKey: "019f8a39-0000-7000-8000-000000000012" }, controllerA))
      .toThrow("revision_conflict")
  })

  it("submits short and long UTF-8 commands as ordered text and Enter PTY writes", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000020",
    }, controllerA)
    await expect(service.sendCommand({
      sessionId: session.id, leaseId: lease.leaseId,
      expectedInputRevision: 0, idempotencyKey: "019f8a39-0000-7000-8000-000000000021",
      text: "printf ok\nexit",
    }, controllerA)).rejects.toThrow("invalid_argument")
    const shortRequest = {
      sessionId: session.id, leaseId: lease.leaseId,
      expectedInputRevision: 0, idempotencyKey: "019f8a39-0000-7000-8000-000000000022",
      text: "printf ok",
    }
    const shortResult = await service.sendCommand(shortRequest, controllerA)
    const longText = "请在下载文件夹创建一个完整可用的番茄钟，并完成响应式、声音提醒和计时逻辑验证。".repeat(16)
    const longResult = await service.sendCommand({
      sessionId: session.id, leaseId: lease.leaseId,
      expectedInputRevision: 1, idempotencyKey: "019f8a39-0000-7000-8000-000000000023",
      text: longText,
    }, controllerA)
    const shortRetry = await service.sendCommand(shortRequest, controllerA)

    expect(pty.write.mock.calls).toEqual([
      ["printf ok"],
      ["\r"],
      [longText],
      ["\r"],
    ])
    expect(shortRetry).toEqual(shortResult)
    expect(shortResult).toMatchObject({
      outcome: "accepted",
      inputRevisionBefore: 0,
      inputRevisionAfter: 1,
      acceptedActionCount: 2,
      acceptedBytes: Buffer.byteLength("printf ok\r"),
    })
    expect(longResult).toMatchObject({
      outcome: "accepted",
      inputRevisionBefore: 1,
      inputRevisionAfter: 2,
      acceptedActionCount: 2,
      acceptedBytes: Buffer.byteLength(`${longText}\r`),
    })
  })

  it("reports an uncertain command boundary when Enter fails after text was accepted", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000024",
    }, controllerA)
    pty.write
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("enter write failed")
      })

    const result = await service.sendCommand({
      sessionId: session.id, leaseId: lease.leaseId,
      expectedInputRevision: 0, idempotencyKey: "019f8a39-0000-7000-8000-000000000025",
      text: "printf ok",
    }, controllerA)

    expect(pty.write.mock.calls).toEqual([["printf ok"], ["\r"]])
    expect(result).toMatchObject({
      outcome: "delivery_uncertain",
      inputRevisionBefore: 0,
      inputRevisionAfter: 1,
      acceptedActionCount: 1,
      acceptedBytes: Buffer.byteLength("printf ok"),
      failedActionIndex: 1,
    })
  })

  it("writes canonical Base64 raw bytes as Buffer without logging or re-encoding", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000030",
    }, controllerA)
    const bytes = Buffer.from([0, 1, 2, 127, 195, 169, 255])
    service.sendRaw({
      sessionId: session.id, leaseId: lease.leaseId,
      expectedInputRevision: 0, idempotencyKey: "019f8a39-0000-7000-8000-000000000031",
      dataBase64: bytes.toString("base64"),
    }, controllerA)
    expect(pty.write).toHaveBeenCalledWith(bytes)
  })

  it("uses bracketed paste only with fresh core emulator evidence", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000040",
    }, controllerA)
    const request = {
      sessionId: session.id, leaseId: lease.leaseId,
      expectedInputRevision: 0, expectedThroughOutputSeq: 0,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000041", text: "one\ntwo",
    }
    await expect(service.paste(request, controllerA)).rejects.toThrow("paste_mode_unavailable")
    pty.emitData("\x1b[?2004h")
    const result = await service.paste({ ...request, expectedThroughOutputSeq: 1 }, controllerA)
    expect(result.outcome).toBe("accepted")
    expect(pty.write).toHaveBeenLastCalledWith("\x1b[200~one\ntwo\x1b[201~")
  })

  it("UI input explicitly takes over and invalidates the automation lease", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000050",
    }, controllerA)
    service.writeSession({ sessionId: session.id, data: "a" })
    expect(service.getSessionState(session.id, controllerA).lease).toMatchObject({ occupied: false })
    expect(service.releaseControl({ sessionId: session.id, leaseId: lease.leaseId }, controllerA))
      .toMatchObject({ released: false, noOp: true })
  })

  it("coordinates resize with lease and sizeRevision without advancing inputRevision", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000060",
    }, controllerA)
    const result = await service.resizeControlledSession({
      sessionId: session.id, leaseId: lease.leaseId,
      expectedSizeRevision: 1, cols: 120, rows: 40,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000061",
    }, controllerA)
    expect(result).toMatchObject({ noOp: false, sizeRevision: 2 })
    expect(pty.resize).toHaveBeenCalledWith(120, 40)
    expect(service.getSession({ sessionId: session.id }).inputRevision).toBe(0)
  })

  it("debounces renderer resize persistence through the runtime store", async () => {
    vi.useFakeTimers()
    try {
      const store = memoryStore()
      const fullSave = vi.spyOn(store, "saveState")
      const runtimeSave = vi.fn(async () => undefined)
      store.saveRuntimeState = runtimeSave
      const { service } = await startedHarness(store)
      const session = await service.createSession({})
      await service.flushPersistQueue()
      fullSave.mockClear()

      await service.resizeSession({ sessionId: session.id, cols: 100, rows: 30 })
      await service.resizeSession({ sessionId: session.id, cols: 120, rows: 40 })
      expect(fullSave).not.toHaveBeenCalled()
      expect(runtimeSave).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(250)
      await service.flushPersistQueue()

      expect(fullSave).not.toHaveBeenCalled()
      expect(runtimeSave).toHaveBeenCalledTimes(1)
      expect(runtimeSave.mock.calls[0]?.[0].sessions[0]?.session).toMatchObject({ cols: 120, rows: 40 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("attaches the renderer to the authoritative emulator snapshot", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitData("\u001b[2J\u001b[Hauthoritative-screen")
    await new Promise((resolve) => setTimeout(resolve, 0))

    const snapshot = await service.attachSession({ sessionId: session.id })

    expect(snapshot).toMatchObject({
      degraded: false,
      cols: 80,
      rows: 24,
      throughOutputSeq: 1,
      sizeRevision: 1,
      emulatorId: "xterm-headless",
      emulatorVersion: "6.0.0",
    })
    expect(snapshot.serialized).toContain("authoritative-screen")
  })

  it("emits a resize barrier after all output accepted at the previous geometry", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitData("before-resize")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const resized = new Promise<Record<string, unknown>>((resolve) => {
      service.events.once("resized", resolve)
    })

    await service.resizeSession({ sessionId: session.id, cols: 120, rows: 40 })

    await expect(resized).resolves.toMatchObject({
      sessionId: session.id,
      cols: 120,
      rows: 40,
      sizeRevision: 2,
      throughOutputSeq: 1,
    })
  })

  it("records the phone that set the grid, and lets the desktop take it back", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})

    await service.resizeSessionFromDevice({
      sessionId: session.id,
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
      mobileClientInstanceId: "phone-1",
    })
    expect(service.getSession({ sessionId: session.id }).sizeOwner).toMatchObject({
      deviceLabel: "iPhone",
      cols: 54,
      rows: 37,
    })

    // Any resize that is not a phone's own releases the grid — this is the whole
    // mechanism by which ownership returns to the desktop, so it needs no separate
    // release call from the fit path.
    await service.resizeSession({ sessionId: session.id, cols: 100, rows: 30 })

    expect(service.getSession({ sessionId: session.id }).sizeOwner).toBeUndefined()
    expect(pty.resize).toHaveBeenLastCalledWith(100, 30)
  })

  it("announces a change of grid owner even when the grid itself is unchanged", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({})
    await service.resizeSession({ sessionId: session.id, cols: 54, rows: 37 })
    const before = service.getSession({ sessionId: session.id })
    const changed = new Promise<Record<string, unknown>>((resolve) => {
      service.events.once("sessionChanged", resolve as (value: unknown) => void)
    })

    // A phone adopting a terminal that already happens to be its shape. Nothing
    // moves, but the desktop has to hear about it or the badge never appears.
    await service.resizeSessionFromDevice({
      sessionId: session.id,
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
      mobileClientInstanceId: "phone-1",
    })

    await expect(changed).resolves.toMatchObject({ id: session.id })
    const after = service.getSession({ sessionId: session.id })
    expect(after.sizeOwner).toMatchObject({ deviceLabel: "iPhone" })
    // No dimension moved, so the size revision must not advance.
    expect(after.sizeRevision).toBe(before.sizeRevision)
  })

  /**
   * The renderer's fit is the only source that knows what shape the pane would
   * have, so it is the only one that records it — and that record is what lets a
   * phone's `releaseGrid` move the PTY on its own.
   *
   * It has to work with nobody at the desktop, which is the whole point: the fit
   * only runs while a pane is on screen, so waiting for it would leave the
   * terminal at the phone's grid for as long as the window stayed closed.
   */
  it("restores the grid the local layout asked for when a phone hands it back", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    await service.resizeSession({ sessionId: session.id, cols: 120, rows: 40 })
    await service.resizeSessionFromDevice({
      sessionId: session.id,
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
      mobileClientInstanceId: "phone-1",
    })
    expect(service.getSession({ sessionId: session.id }).sizeOwner).toBeDefined()

    await expect(service.restoreGridForDesktop(session.id)).resolves.toBe(true)

    expect(pty.resize).toHaveBeenLastCalledWith(120, 40)
    const restored = service.getSession({ sessionId: session.id })
    expect(restored).toMatchObject({ cols: 120, rows: 40 })
    expect(restored.sizeOwner).toBeUndefined()
  })

  /**
   * An automated resize picks dimensions for its own reasons and says nothing
   * about the local layout, so it must not become the shape a restore lands on.
   */
  it("does not mistake an automated resize for the local layout's grid", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    await service.resizeSession({ sessionId: session.id, cols: 120, rows: 40 })
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000070",
    }, controllerA)
    await service.resizeControlledSession({
      sessionId: session.id, leaseId: lease.leaseId,
      expectedSizeRevision: 2, cols: 200, rows: 60,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000071",
    }, controllerA)
    await service.resizeSessionFromDevice({
      sessionId: session.id,
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
      mobileClientInstanceId: "phone-1",
    })

    await expect(service.restoreGridForDesktop(session.id)).resolves.toBe(true)

    expect(pty.resize).toHaveBeenLastCalledWith(120, 40)
  })

  /**
   * The record is the last shape the layout asked for, not the last shape that
   * moved. A fit that lands on dimensions the PTY already has still changes the
   * layout's opinion, and the next restore has to use the new one.
   */
  it("records the layout's grid even when the PTY already has that size", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    await service.resizeSession({ sessionId: session.id, cols: 120, rows: 40 })
    const lease = service.acquireControl({
      sessionId: session.id, requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000072",
    }, controllerA)
    await service.resizeControlledSession({
      sessionId: session.id, leaseId: lease.leaseId,
      expectedSizeRevision: 2, cols: 100, rows: 30,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000073",
    }, controllerA)
    // The pane re-fits onto the shape it now has: no dimension moves, so nothing
    // is emitted, but (120, 40) is no longer what the layout wants.
    await service.resizeSession({ sessionId: session.id, cols: 100, rows: 30 })
    await service.resizeSessionFromDevice({
      sessionId: session.id,
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
      mobileClientInstanceId: "phone-1",
    })

    await expect(service.restoreGridForDesktop(session.id)).resolves.toBe(true)

    expect(pty.resize).toHaveBeenLastCalledWith(100, 30)
  })

  /**
   * A terminal the desktop has never displayed has no shape to go back to, and a
   * default would be a second wrong size to move away from. The claim still goes
   * back — it is the size that could not be restored — and the pane appearing
   * later fixes it on its own.
   */
  it("reports that it cannot restore a grid the desktop has never drawn", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    await service.resizeSessionFromDevice({
      sessionId: session.id,
      cols: 54,
      rows: 37,
      deviceLabel: "iPhone",
      mobileClientInstanceId: "phone-1",
    })
    pty.resize.mockClear()

    await expect(service.restoreGridForDesktop(session.id)).resolves.toBe(false)

    expect(pty.resize).not.toHaveBeenCalled()
    const after = service.getSession({ sessionId: session.id })
    expect(after).toMatchObject({ cols: 54, rows: 37 })
    expect(after.sizeOwner).toBeUndefined()
    // Nothing left to hand back. Retrying must not re-report a failure the reader
    // can do nothing about.
    await expect(service.restoreGridForDesktop(session.id)).resolves.toBe(true)
  })

  it("keeps normal stop asynchronous, reports the terminal transition, then destroys the session", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const operation = await service.stopControlledSession({
      sessionId: session.id,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000070",
    }, controllerA)
    expect(operation).toMatchObject({ status: "delivered", kind: "stop" })
    expect(service.getSession({ sessionId: session.id }).status).toBe("stopping")
    expect(pty.kill).toHaveBeenCalledWith(process.platform === "win32" ? undefined : "SIGHUP")
    const terminalState = service.observe({
      sessionId: session.id,
      afterStateRevision: service.getSession({ sessionId: session.id }).stateRevision,
      afterOutputSeq: 0,
      maxWaitMs: 1_000,
    }, false, controllerA.clientId)
    pty.emitExit({ exitCode: 2, signal: 1 })
    await expect(terminalState).resolves.toMatchObject({
      state: {
        lifecycle: "ended",
        endFacts: {
          cause: "normal_stop_confirmed",
          exitCode: 2,
          signal: 1,
        },
      },
    })
    await service.flushPersistQueue()
    expect(() => service.getSession({ sessionId: session.id })).toThrow("not_found")
    expect(() => service.getOperation((operation as { operationId: string }).operationId)).toThrow("not_found")
  })

  it("returns completed termination facts when PTY exit is delivered synchronously", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.kill.mockImplementationOnce(() => pty.emitExit({ exitCode: 0 }))

    const operation = await service.stopControlledSession({
      sessionId: session.id,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000075",
    }, controllerA)

    expect(operation).toMatchObject({
      status: "completed",
      finalLifecycle: "ended",
      finalCause: "normal_stop_confirmed",
    })
    expect(() => service.getSession({ sessionId: session.id })).toThrow("not_found")
  })

  it("removes a delivered stop after restart without respawning or replaying it", async () => {
    const first = await startedHarness()
    const session = await first.service.createSession({})
    const operation = await first.service.stopControlledSession({
      sessionId: session.id,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000071",
    }, controllerA)
    await first.service.flushPersistQueue()
    const recovered = createTerminalService({
      store: first.store,
      spawnPty: () => { throw new Error("recovery must not respawn or replay") },
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
      resolveEffectivePath: () => "/usr/bin:/bin",
    })
    await recovered.start()
    expect(() => recovered.getSession({ sessionId: session.id })).toThrow("not_found")
    expect(() => recovered.getOperation((operation as { operationId: string }).operationId)).toThrow("not_found")
    expect(first.store.state.sessions).toEqual([])
    expect(first.store.state.operations).toEqual([])
  })

  it("rejects delete for running/stopping sessions and never hides termination", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({})
    await expect(service.deleteSession({ sessionId: session.id })).rejects.toThrow("lifecycle_conflict")
    expect(service.getSession({ sessionId: session.id }).status).toBe("running")
  })

  it("removes session metadata, history, checkpoints, and operations when the PTY exits", async () => {
    const { service, pty, store } = await startedHarness()
    const session = await service.createSession({})
    pty.emitData("completed output\r\n")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const lease = service.acquireControl({
      sessionId: session.id,
      requestedLeaseMs: 10_000,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000073",
    }, controllerA)
    service.sendSemanticInput({
      sessionId: session.id,
      leaseId: lease.leaseId,
      expectedInputRevision: 0,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000074",
      actions: [{ type: "text", text: "exit" }, { type: "key", key: "Enter" }],
    }, controllerA)
    await service.stopControlledSession({
      sessionId: session.id,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000072",
    }, controllerA)
    pty.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()

    expect(() => service.getSession({ sessionId: session.id })).toThrow("not_found")
    expect(service.listWorkspaces()).toEqual([])
    expect(service.listSessions()).toEqual([])
    expect(service.getPersistDiagnostics()).toMatchObject({ pending: false, inFlight: false })
    expect(store.state.sessions).toEqual([])
    expect(store.state.workspaces).toEqual([])
    expect(store.state.output).toEqual([])
    expect(store.state.operations).toEqual([])
    expect(store.state.idempotency).toEqual([])
    expect(store.state.checkpoints).toEqual([])
  })

  it("makes a group empty when its final terminal exits", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()
    await service.deleteGroup({ groupId: session.groupId })
    expect(service.listGroups().some((group) => group.id === session.groupId)).toBe(false)
  })

  it("submits saved group commands as ordered text plus Enter and retains shell echo", async () => {
    const { service, pty } = await startedHarness()
    const group = service.listGroups()[0]!
    const command = await service.createGroupCommand({ groupId: group.id, name: "dev", command: "nvm use\npnpm dev" })
    const session = await service.launchGroupCommand({ groupId: group.id, commandId: command.id })
    expect(pty.write.mock.calls.slice(-4)).toEqual([["nvm use"], ["\r"], ["pnpm dev"], ["\r"]])
    pty.emitData("nvm use\r\n")
    expect(service.readSession({ sessionId: session.id }).chunks.map((chunk) => chunk.data)).toContain("nvm use\r\n")
  })

  it("renames a session without waiting for later terminal output to finish persisting", async () => {
    const store = controllableStore()
    const { service, pty } = await startedHarness(store)
    const session = await service.createSession({ title: "Before" })

    const renamed = await runMutationWhileOutputKeepsPersistBusy(service, pty, store, () =>
      service.renameSession({ sessionId: session.id, title: "After" }))

    expect(renamed.title).toBe("After")
  })

  it("renames the conversation a phone renames by renaming the conversation's only terminal", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({ title: "Before" })
    const conversation = service.getWorkspaceForSession({ sessionId: session.id })
    const renamedConversations: string[] = []
    service.events.on("domainChanged", (event: { eventType: string; objectId: string }) => {
      if (event.eventType === "workspace.renamed") renamedConversations.push(event.objectId)
    })

    await service.renameSession({ sessionId: session.id, title: "After" })

    expect(service.getWorkspace({ workspaceId: conversation.id }).title).toBe("After")
    // The desktop draws the conversation's name from the workspace, so its sidebar only
    // repaints because the rename is announced as a workspace change too.
    expect(renamedConversations).toEqual([conversation.id])
  })

  it("renames a conversation's only terminal by renaming the conversation", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({ title: "Before" })
    const conversation = service.getWorkspaceForSession({ sessionId: session.id })
    const renamedSessions: string[] = []
    service.events.on("sessionChanged", (payload: { id: string; title: string }) => {
      if (payload.id === session.id) renamedSessions.push(payload.title)
    })

    await service.renameWorkspace({
      workspaceId: conversation.id,
      title: "After",
      expectedLayoutRevision: conversation.layoutRevision,
    })

    expect(service.getSession({ sessionId: session.id }).title).toBe("After")
    // The phone lists terminals, so it learns the new name only from this announcement.
    expect(renamedSessions).toEqual(["After"])
  })

  it("pins a conversation and lists it before the unpinned ones in its group", async () => {
    const { service } = await startedHarness()
    await service.createSession({ title: "First" })
    await service.createSession({ title: "Second" })
    // 排最后的那一个来置顶：两个会话可能落在同一毫秒，谁在前由 id 决定，所以不假设创建顺序。
    const pinned = service.listWorkspaces().at(-1)!
    const other = service.listWorkspaces().find((workspace) => workspace.id !== pinned.id)!
    expect(pinned.pinned).toBe(false)

    const updated = await service.updateWorkspace({
      workspaceId: pinned.id,
      expectedLayoutRevision: pinned.layoutRevision,
      pinned: true,
    })

    expect(updated.pinned).toBe(true)
    expect(service.listWorkspaces()[0]?.id).toBe(pinned.id)
    expect(service.listWorkspaces().filter((workspace) => workspace.pinned).map((workspace) => workspace.id))
      .toEqual([pinned.id])
    expect(service.getWorkspace({ workspaceId: other.id }).pinned).toBe(false)
    expect(service.listWorkspaces().map((workspace) => workspace.id)).toEqual([pinned.id, other.id])
  })

  it("stores a trimmed description and clears it when saved empty", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({ title: "Conversation" })
    const workspace = service.getWorkspaceForSession({ sessionId: session.id })

    const described = await service.updateWorkspace({
      workspaceId: workspace.id,
      expectedLayoutRevision: workspace.layoutRevision,
      description: "  部署用的窗口  ",
    })
    expect(described.description).toBe("部署用的窗口")

    const cleared = await service.updateWorkspace({
      workspaceId: workspace.id,
      expectedLayoutRevision: described.layoutRevision,
      description: "   ",
    })
    expect(cleared.description).toBeUndefined()
    expect(Object.hasOwn(cleared, "description")).toBe(false)
  })

  it("rejects a workspace metadata update written against a stale revision", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({ title: "Conversation" })
    const workspace = service.getWorkspaceForSession({ sessionId: session.id })

    await service.updateWorkspace({
      workspaceId: workspace.id,
      expectedLayoutRevision: workspace.layoutRevision,
      pinned: true,
    })

    await expect(service.updateWorkspace({
      workspaceId: workspace.id,
      expectedLayoutRevision: workspace.layoutRevision,
      pinned: false,
    })).rejects.toThrow("revision_conflict")
  })

  it("announces a workspace metadata update so the sidebar repaints", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({ title: "Conversation" })
    const workspace = service.getWorkspaceForSession({ sessionId: session.id })
    const updated: string[] = []
    service.events.on("domainChanged", (event: { eventType: string; objectId: string }) => {
      if (event.eventType === "workspace.updated") updated.push(event.objectId)
    })

    await service.updateWorkspace({
      workspaceId: workspace.id,
      expectedLayoutRevision: workspace.layoutRevision,
      pinned: true,
    })

    expect(updated).toEqual([workspace.id])
  })

  it("keeps a split conversation's name and its terminals' names apart", async () => {
    const { service } = await startedHarness()
    const left = await service.createSession({ title: "Conversation" })
    const conversation = service.getWorkspaceForSession({ sessionId: left.id })
    const paneId = conversation.layout.type === "leaf" ? conversation.layout.paneId : ""
    const split = await service.splitPane({
      workspaceId: conversation.id,
      paneId,
      direction: "right",
      expectedLayoutRevision: conversation.layoutRevision,
    })

    await service.renameSession({ sessionId: left.id, title: "Left only" })
    expect(service.getWorkspace({ workspaceId: conversation.id }).title).toBe("Conversation")

    await service.renameWorkspace({
      workspaceId: conversation.id,
      title: "Both panes",
      expectedLayoutRevision: split.workspace.layoutRevision,
    })
    expect(service.getSession({ sessionId: left.id }).title).toBe("Left only")
  })

  it("creates a group command without waiting for later terminal output to finish persisting", async () => {
    const store = controllableStore()
    const { service, pty } = await startedHarness(store)
    const group = service.listGroups()[0]!
    await service.createSession({ groupId: group.id })

    const command = await runMutationWhileOutputKeepsPersistBusy(service, pty, store, () =>
      service.createGroupCommand({ groupId: group.id, name: "dev", command: "pnpm dev" }))

    expect(command).toMatchObject({ name: "dev", command: "pnpm dev" })
  })

  it("returns bounded observation watermarks without consuming shared output", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitData("one")
    const request = {
      sessionId: session.id,
      afterStateRevision: 1, afterOutputSeq: 0, maxWaitMs: 0,
    }
    const first = await service.observe(request, true)
    const second = await service.observe(request, true)
    expect(first.changed).toBe(true)
    expect(second.chunks).toEqual(first.chunks)
    expect(first.nextOutputSeq).toBe(1)
  })

  it("does not retain a rendered view after the process exits", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitData("checkpoint-view\r\n")
    await new Promise((resolve) => setTimeout(resolve, 0))
    pty.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()
    await expect(service.getView({ sessionId: session.id, kind: "screen", maxBytes: 64 * 1024 }))
      .rejects.toThrow("not_found")
  })
})

describe("TerminalService conversation naming", () => {
  it("names a new tab after its group and the conversation inside it with a running number", async () => {
    const { service } = await startedHarness()
    const group = await service.createGroup({ name: "Synapse" })

    const session = await service.createSession({ groupId: group.id })
    const workspace = service.getWorkspaceForSession({ sessionId: session.id })

    expect(session.title).toBe("Synapse #1")
    expect(workspace.title).toBe("Synapse")
  })

  it("numbers split panes and further tabs from one running sequence", async () => {
    const { service } = await startedHarness()
    const group = await service.createGroup({ name: "Synapse" })

    const first = await service.createSession({ groupId: group.id })
    const firstWorkspace = service.getWorkspaceForSession({ sessionId: first.id })
    const split = await service.splitPane({
      workspaceId: firstWorkspace.id,
      paneId: collectTerminalPaneLeaves(firstWorkspace.layout)[0]!.paneId,
      direction: "right",
      expectedLayoutRevision: firstWorkspace.layoutRevision,
    })
    const second = await service.getSession({ sessionId: split.sessionId })
    const nextTab = await service.createSession({ groupId: group.id })

    expect([first.title, second.title, nextTab.title]).toEqual(["Synapse #1", "Synapse #2", "Synapse #3"])
    expect(service.getWorkspaceForSession({ sessionId: nextTab.id }).title).toBe("Synapse")
  })

  it("keeps an independent sequence per group", async () => {
    const { service } = await startedHarness()
    const synapse = await service.createGroup({ name: "Synapse" })
    const mobile = await service.createGroup({ name: "Mobile" })

    const synapseFirst = await service.createSession({ groupId: synapse.id })
    const mobileFirst = await service.createSession({ groupId: mobile.id })
    const mobileSecond = await service.createSession({ groupId: mobile.id })

    expect([synapseFirst.title, mobileFirst.title, mobileSecond.title])
      .toEqual(["Synapse #1", "Mobile #1", "Mobile #2"])
  })

  it("does not recycle a number after the conversation is gone", async () => {
    const spawned: ReturnType<typeof fakePty>[] = []
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty: () => {
        const pty = fakePty()
        spawned.push(pty)
        return pty
      },
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-naming-")),
      resolveEffectivePath: () => "/usr/bin:/bin",
    })
    await service.start()
    const group = await service.createGroup({ name: "Synapse" })

    const first = await service.createSession({ groupId: group.id })
    await service.createSession({ groupId: group.id })
    spawned[0]!.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()
    expect(service.listSessions().map((item) => item.id)).not.toContain(first.id)

    const third = await service.createSession({ groupId: group.id })
    expect(third.title).toBe("Synapse #3")
  })

  it("numbers a command-launched conversation while naming its tab after the command", async () => {
    const { service } = await startedHarness()
    const group = await service.createGroup({ name: "Synapse" })
    await service.createSession({ groupId: group.id })
    const command = await service.createGroupCommand({ groupId: group.id, name: "dev", command: "pnpm dev" })

    const launched = await service.launchGroupCommand({ groupId: group.id, commandId: command.id })

    expect(launched.title).toBe("Synapse #2")
    expect(service.getWorkspaceForSession({ sessionId: launched.id }).title).toBe("Synapse dev")
  })

  it("keeps an explicit session title and leaves the sequence untouched", async () => {
    const { service } = await startedHarness()
    const group = await service.createGroup({ name: "Synapse" })

    const named = await service.createSession({ groupId: group.id, title: "Claude Code · Synapse" })
    const auto = await service.createSession({ groupId: group.id })

    expect(named.title).toBe("Claude Code · Synapse")
    expect(service.getWorkspaceForSession({ sessionId: named.id }).title).toBe("Claude Code · Synapse")
    expect(auto.title).toBe("Synapse #1")
  })

  it("restarts the sequence from #1 after the service restarts", async () => {
    const store = memoryStore()
    const first = await startedHarness(store)
    const group = await first.service.createGroup({ name: "Synapse" })
    expect((await first.service.createSession({ groupId: group.id })).title).toBe("Synapse #1")

    await first.service.stop()
    await first.service.start()
    const second = await first.service.createSession({ groupId: group.id })

    expect(second.title).toBe("Synapse #1")
  })
})

async function startedHarness(store = memoryStore()) {
  const pty = fakePty()
  const cwd = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-service-"))
  const service = createTerminalService({
    store,
    spawnPty: () => pty,
    resolveDefaultShell: () => "/bin/zsh",
    resolveDefaultCwd: () => cwd,
    resolveEffectivePath: () => "/usr/bin:/bin",
  })
  await service.start()
  return { service, pty, store }
}

async function runMutationWhileOutputKeepsPersistBusy<T>(
  service: ReturnType<typeof createTerminalService>,
  pty: ReturnType<typeof fakePty>,
  store: ReturnType<typeof controllableStore>,
  mutate: () => Promise<T>,
): Promise<T> {
  store.pauseWrites()
  pty.emitData("before")
  await store.waitForPendingSave()

  const mutation = mutate()
  store.releaseNextSave()
  await store.waitForPendingSave()

  pty.emitData("after")
  store.releaseNextSave()
  const result = await mutation

  await store.waitForPendingSave()
  expect(store.pendingSaveCount()).toBe(1)
  store.releaseNextSave()
  await service.flushPersistQueue()
  return result
}

function memoryStore(): TerminalStore & { state: TerminalStoreState } {
  const holder = {
    persistenceProtection: "available" as const,
    state: { groups: [], sessions: [], output: [], terminalDomainRevision: 0, operations: [], idempotency: [], checkpoints: [] } as TerminalStoreState,
    async loadState() { return structuredClone(holder.state) },
    async saveState(state: TerminalStoreState) { holder.state = structuredClone(state) },
  }
  return holder
}

function collectPaneSessionIds(layout: ReturnType<ReturnType<typeof createTerminalService>["getWorkspace"]>["layout"]): string[] {
  return layout.type === "leaf"
    ? [layout.sessionId]
    : [...collectPaneSessionIds(layout.first), ...collectPaneSessionIds(layout.second)]
}

function controllableStore() {
  const pendingSaves: Array<{ readonly state: TerminalStoreState; readonly resolve: () => void }> = []
  let pendingSaveWaiters: Array<() => void> = []
  let writesPaused = false
  const holder = {
    persistenceProtection: "available" as const,
    state: { groups: [], sessions: [], output: [], terminalDomainRevision: 0, operations: [], idempotency: [], checkpoints: [] } as TerminalStoreState,
    async loadState() { return structuredClone(holder.state) },
    async saveState(state: TerminalStoreState) {
      const snapshot = structuredClone(state)
      if (!writesPaused) {
        holder.state = snapshot
        return
      }
      await new Promise<void>((resolve) => {
        pendingSaves.push({ state: snapshot, resolve })
        const waiters = pendingSaveWaiters
        pendingSaveWaiters = []
        for (const waiter of waiters) waiter()
      })
    },
    pauseWrites() { writesPaused = true },
    pendingSaveCount() { return pendingSaves.length },
    async waitForPendingSave() {
      if (pendingSaves.length) return
      await new Promise<void>((resolve) => pendingSaveWaiters.push(resolve))
    },
    releaseNextSave() {
      const pending = pendingSaves.shift()
      if (!pending) throw new Error("No pending Terminal save to release")
      holder.state = pending.state
      pending.resolve()
    },
  }
  return holder
}

function fakePty(options: { readonly ptsName?: string } = {}) {
  let dataListener: ((data: string) => void) | undefined
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
  const instance = {
    ...(options.ptsName ? { ptsName: options.ptsName } : {}),
    onData: vi.fn((listener: (data: string) => void) => { dataListener = listener; return { dispose: vi.fn() } }),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => { exitListener = listener; return { dispose: vi.fn() } }),
    write: vi.fn((_data: string | Buffer) => undefined),
    resize: vi.fn(),
    kill: vi.fn((_signal?: string) => undefined),
    emitData: (data: string) => dataListener?.(data),
    emitExit: (event: { exitCode: number; signal?: number }) => exitListener?.(event),
  }
  return instance as typeof instance & PtyLike
}

describe("TerminalService session state: tty and agent block", () => {
  /** 一个只要被问就回答的 agent 通知依赖；档案本体不在这里，只有投影。 */
  function agentDeps(view: { state: string; version: number; agentKind?: string; lastActivityAt: string; stateChangedAt: string } | null) {
    return {
      prepareSession: () => null,
      renameSession: () => undefined,
      handleUserInput: () => undefined,
      unregisterSession: () => undefined,
      handleOscNotification: () => undefined,
      getAgentStateView: () => view,
    } as unknown as Parameters<typeof createTerminalService>[0]["agentNotifications"]
  }

  async function harnessWith(pty: PtyLike, view: Parameters<typeof agentDeps>[0]) {
    const service = createTerminalService({
      store: memoryStore(),
      spawnPty: () => pty,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => os.tmpdir(),
      agentNotifications: agentDeps(view),
    })
    await service.start()
    return service
  }

  it("reports the PTY device so a caller can find the process running inside it", async () => {
    const service = await harnessWith(fakePty({ ptsName: "/dev/ttys036" }), null)
    const session = await service.createSession({})
    // 这条是外部「拿着引用去认领会话」的接点：值是 PTY 设备名，调用方据此 `ps -t`。
    expect(service.getSessionState(session.id).tty).toBe("/dev/ttys036")
  })

  it("omits the device entirely when the platform has none", async () => {
    const service = await harnessWith(fakePty(), null)
    const session = await service.createSession({})
    expect(service.getSessionState(session.id)).not.toHaveProperty("tty")
  })

  it("carries the projected agent state and nothing from the archive behind it", async () => {
    const view = {
      state: "working",
      agentKind: "claude",
      version: 3,
      lastActivityAt: "2026-09-19T10:00:05.000Z",
      stateChangedAt: "2026-09-19T10:00:03.000Z",
    }
    const service = await harnessWith(fakePty(), view)
    const session = await service.createSession({})
    const state = service.getSessionState(session.id)
    expect(state.agent).toEqual(view)
    expect(Object.keys(state.agent!).sort()).toEqual([
      "agentKind", "lastActivityAt", "state", "stateChangedAt", "version",
    ])
  })

  it("leaves the agent block absent rather than null when there is no archive", async () => {
    const service = await harnessWith(fakePty(), null)
    const session = await service.createSession({})
    // 缺席是有语义的（这里从来没有 agent），写成 null 会让调用方把两件事混为一谈。
    expect(service.getSessionState(session.id)).not.toHaveProperty("agent")
  })
})
