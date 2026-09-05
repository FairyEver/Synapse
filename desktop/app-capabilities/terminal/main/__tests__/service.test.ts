import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { createTerminalService, ensureExecutableIfPresent, type PtyLike } from "../service"
import type { TerminalStore, TerminalStoreState } from "../store"

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

  it("finishes a persisted pane close after restart", async () => {
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

    expect(recovered.listWorkspaces()).toHaveLength(1)
    expect(recovered.listWorkspaces()[0]?.layout).toMatchObject({ type: "leaf", sessionId: root.id })
    expect(recovered.listSessions().map((session) => session.id)).toEqual([root.id])
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

  it("keeps normal stop asynchronous and marks ended only after the PTY exit event", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    const operation = await service.stopControlledSession({
      sessionId: session.id,
      idempotencyKey: "019f8a39-0000-7000-8000-000000000070",
    }, controllerA)
    expect(operation).toMatchObject({ status: "delivered", kind: "stop" })
    expect(service.getSession({ sessionId: session.id }).status).toBe("stopping")
    expect(pty.kill).toHaveBeenCalledWith(process.platform === "win32" ? undefined : "SIGHUP")
    pty.emitExit({ exitCode: 2, signal: 1 })
    expect(service.getSession({ sessionId: session.id })).toMatchObject({ status: "ended", endCause: "normal_stop_confirmed", exitCode: 2, signal: 1 })
    expect(service.getSessionState(session.id, controllerA).endFacts).toMatchObject({
      stopOperationId: (operation as { operationId: string }).operationId,
      requestedBy: "self",
    })
    expect(service.getOperation((operation as { operationId: string }).operationId)).toMatchObject({ status: "completed", finalLifecycle: "ended" })
  })

  it("recovers a delivered stop without replay and records the session as lost", async () => {
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
    expect(recovered.getSession({ sessionId: session.id })).toMatchObject({
      status: "lost",
      endCause: "runtime_unrecoverable_after_restart",
    })
    expect(recovered.getOperation((operation as { operationId: string }).operationId)).toMatchObject({
      status: "completed",
      finalLifecycle: "lost",
      finalCause: "runtime_unrecoverable_after_restart",
    })
  })

  it("rejects delete for running/stopping sessions and never hides termination", async () => {
    const { service } = await startedHarness()
    const session = await service.createSession({})
    await expect(service.deleteSession({ sessionId: session.id })).rejects.toThrow("lifecycle_conflict")
    expect(service.getSession({ sessionId: session.id }).status).toBe("running")
  })

  it("persists a bounded delete operation tombstone for a terminal session", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitExit({ exitCode: 0 })
    const result = await service.deleteTerminalSession(session.id, "client-a")
    expect(result.deleteOperationId).not.toBe(session.id)
    expect(service.getOperation(result.deleteOperationId)).toMatchObject({
      kind: "delete",
      status: "completed",
      finalLifecycle: "ended",
      finalCause: "session_deleted",
    })
    expect(() => service.getSession({ sessionId: session.id })).toThrow("not_found")
  })

  it("deletes a non-empty group only through an unchanged terminal-session plan", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitExit({ exitCode: 0 })
    const plan = service.previewGroupDelete(session.groupId)
    const result = await service.commitGroupDelete(plan.deletePlanId)
    expect(result.sessionCount).toBe(1)
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

  it("serves an ended session view from a bounded core checkpoint plus retained output", async () => {
    const { service, pty } = await startedHarness()
    const session = await service.createSession({})
    pty.emitData("checkpoint-view\r\n")
    await new Promise((resolve) => setTimeout(resolve, 0))
    pty.emitExit({ exitCode: 0 })
    const view = await service.getView({ sessionId: session.id, kind: "screen", maxBytes: 64 * 1024 })
    expect(view.degraded).toBe(false)
    expect(view.lines.join("\n")).toContain("checkpoint-view")
    expect(view.throughOutputSeq).toBe(1)
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

function fakePty() {
  let dataListener: ((data: string) => void) | undefined
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
  const instance = {
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
