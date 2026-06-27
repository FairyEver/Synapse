import { readFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseBridge } from "../../src/types/bridge"

const electronMock = vi.hoisted(() => {
  const state: { exposedBridge: SynapseBridge | null } = { exposedBridge: null }

  return {
    state,
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, bridge: unknown) => {
        if (key === "synapse") {
          state.exposedBridge = bridge as SynapseBridge
        }
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    webUtils: {
      getPathForFile: vi.fn(() => "/tmp/report.txt"),
    },
  }
})

vi.mock("electron", () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
  webUtils: electronMock.webUtils,
}))

async function loadPreloadBridge(): Promise<SynapseBridge> {
  vi.resetModules()
  electronMock.state.exposedBridge = null
  electronMock.contextBridge.exposeInMainWorld.mockClear()
  electronMock.ipcRenderer.invoke.mockClear()
  electronMock.ipcRenderer.on.mockClear()
  electronMock.ipcRenderer.removeListener.mockClear()
  electronMock.webUtils.getPathForFile.mockClear()

  await import("../preload")

  if (!electronMock.state.exposedBridge) {
    throw new Error("preload did not expose the synapse bridge")
  }

  return electronMock.state.exposedBridge
}

describe("preload bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps preload free of local runtime imports for Electron sandbox loading", async () => {
    const source = await readFile(path.resolve(__dirname, "..", "preload.ts"), "utf8")
    const imports = source.match(/import[\s\S]*?from\s+["'][^"']+["']/g) ?? []
    const localRuntimeImports = imports.filter((statement) => {
      const moduleMatch = statement.match(/from\s+["']([^"']+)["']/)
      const modulePath = moduleMatch?.[1] ?? ""
      return !/^import\s+type\b/.test(statement.trim()) && modulePath.startsWith(".")
    })

    expect(localRuntimeImports).toEqual([])
  })

  it("subscribes repository listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.repository.onProgress(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:events:repository")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    expect(typeof wrapped).toBe("function")

    wrapped?.({}, {
      domain: "repository",
      type: "repository.updated",
      payload: { repositoryUuid: "wrong-type" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })
    wrapped?.({}, {
      domain: "repository",
      type: "repository.progress",
      payload: { repositoryUuid: "repo-1" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ repositoryUuid: "repo-1" })
  })

  it("subscribes database change listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.database.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:events:database")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, {
      domain: "database",
      type: "database.changed",
      payload: { table: "notes" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith({ table: "notes" })
  })

  it("subscribes automation change listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.automation.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:events:automation")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, {
      domain: "automation",
      type: "automation.itemChanged",
      payload: { automationId: "automation-1", reason: "run-finished" },
      timestamp: "2026-06-03T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith({ automationId: "automation-1", reason: "run-finished" })
  })

  it("maps automation bridge methods to automation IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.automation.openCreateEditorWindow()
    await bridge.automation.openEditorWindow("automation:1")
    await bridge.automation.listItems()
    await bridge.automation.getItem("automation:1")
    await bridge.automation.createItem({
      name: "Daily report",
      scope: { type: "global" },
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 10, activeDays: [0, 1, 2, 3, 4, 5, 6] },
      },
      executor: { type: "builtin.command", config: { command: "echo ok" } },
    })
    await bridge.automation.updateItem({ id: "automation:1", patch: { enabled: false } })
    await bridge.automation.setItemEnabled({ id: "automation:1", enabled: true })
    await bridge.automation.runItem("automation:1")
    await bridge.automation.stopRun("automation-run:1")
    await bridge.automation.listRuns("automation:1", { limit: 20 })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:editor:open-create",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:editor:open-edit",
      { automationId: "automation:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:items:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:items:get",
      { automationId: "automation:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:items:update",
      { id: "automation:1", patch: { enabled: false } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:items:set-enabled",
      { automationId: "automation:1", enabled: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:items:run",
      { automationId: "automation:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:runs:stop",
      { runId: "automation-run:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:automation:runs:list",
      { automationId: "automation:1", limit: 20 },
    )
  })

  it("maps screenshot bridge methods to screenshot IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.screenshot.capture({ mode: "fullscreen" })
    const artifact = {
      id: "shot-1",
      mimeType: "image/png" as const,
      bytes: new Uint8Array([1, 2, 3]),
      size: 3,
      width: 1,
      height: 1,
      tempPath: "/tmp/shot-1.png",
      capture: {
        mode: "fullscreen" as const,
        coordinateSpace: "screen" as const,
        capturedAt: "2026-06-24T08:00:00.000Z",
      },
    }
    await bridge.screenshot.startInteractiveCapture({ hideCurrentWindow: true })
    await bridge.screenshot.completeInteractiveCapture({ x: 1, y: 2, width: 3, height: 4 })
    await bridge.screenshot.cancelInteractiveCapture()
    await bridge.screenshot.captureToFile({
      capture: { mode: "region", region: { x: 1, y: 2, width: 3, height: 4 } },
      outputPath: "/tmp/screen.png",
    })
    await bridge.screenshot.copyToClipboard({ mode: "fullscreen" })
    await bridge.screenshot.copyArtifactToClipboard(artifact)
    await bridge.screenshot.saveArtifact({ artifact, outputPath: "/tmp/screen.png" })
    await bridge.screenshot.chooseOutputFile({ defaultPath: "screen.png" })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:screenshot:capture",
      { mode: "fullscreen" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:screenshot:interactive:start",
      { hideCurrentWindow: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:screenshot:interactive:complete",
      { x: 1, y: 2, width: 3, height: 4 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:screenshot:interactive:cancel",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      5,
      "synapse:screenshot:file:capture",
      {
        capture: { mode: "region", region: { x: 1, y: 2, width: 3, height: 4 } },
        outputPath: "/tmp/screen.png",
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      6,
      "synapse:screenshot:clipboard:copy",
      { mode: "fullscreen" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      7,
      "synapse:screenshot:clipboard:copy-artifact",
      artifact,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      8,
      "synapse:screenshot:file:save-artifact",
      { artifact, outputPath: "/tmp/screen.png" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      9,
      "synapse:screenshot:output:choose",
      { defaultPath: "screen.png" },
    )
  })

  it("maps quick input bridge methods to quick input IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.quickInput.list()
    await bridge.quickInput.create({ content: "新的快捷输入" })
    await bridge.quickInput.update({ id: "quick-1", content: "更新快捷输入" })
    await bridge.quickInput.delete({ id: "quick-1" })
    bridge.quickInput.onChanged(vi.fn())

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:quick-input:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:quick-input:create",
      { content: "新的快捷输入" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:quick-input:update",
      { id: "quick-1", content: "更新快捷输入" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:quick-input:delete",
      { id: "quick-1" },
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      "synapse:quick-input:changed",
      expect.any(Function),
    )
  })

  it("rethrows structured IPC error envelopes with user-facing failure", async () => {
    const bridge = await loadPreloadBridge()
    electronMock.ipcRenderer.invoke.mockResolvedValue(undefined)
    electronMock.ipcRenderer.invoke.mockResolvedValueOnce({
      __synapseIpcError: true,
      message: [
        "Authentication failed for https://github.com/acme/docs.git?token=[redacted]",
        "Authorization: Basic [redacted]",
        "Authorization=Basic [redacted]",
        "Authorization: Bearer [redacted]",
        "Authorization=Bearer [redacted]",
        "Cookie: [redacted]",
        "Cookie=[redacted]",
        "cwd: /Users/alice/work/docs",
      ].join("\n"),
      name: "Error",
      userFacingFailure: {
        category: "github-auth",
        detail: "Authentication failed. Authorization=Basic [redacted]\nCookie: [redacted]\ncwd: /Users/alice/work/docs",
        host: "github.com",
        message: "请处理 GitHub 访问 token=[redacted]",
        primaryAction: "handle-github-auth",
        protocol: "https",
        title: "GitHub 需要登录 Authorization: Bearer [redacted]",
      },
    })

    let caught: unknown
    try {
      await bridge.git.cloneRepository({
        name: "docs",
        remoteUrl: "https://github.com/acme/docs.git",
        targetPath: "/work/docs",
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught).toMatchObject({
      userFacingFailure: {
        category: "github-auth",
        host: "github.com",
        primaryAction: "handle-github-auth",
      },
    })
    const message = caught instanceof Error ? caught.message : ""
    expect(message).toContain("https://github.com/acme/docs.git?token=[redacted]")
    expect(message).toContain("Authorization: Basic [redacted]")
    expect(message).toContain("Authorization=Basic [redacted]")
    expect(message).toContain("Authorization: Bearer [redacted]")
    expect(message).toContain("Authorization=Bearer [redacted]")
    expect(message).toContain("Cookie: [redacted]")
    expect(message).toContain("Cookie=[redacted]")
    expect(message).toContain("/Users/alice/work/docs")
    expect(message).not.toContain("token:secret")
    expect(message).not.toContain("raw-token")
    expect(message).not.toContain("dXNlcjpzZWNyZXQ=")
    expect(message).not.toContain("raw.bearer.payload")
    expect(JSON.stringify(caught)).not.toContain("raw-cookie")
  })

  it("maps account webhook list to the account IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.account.listWebhooks()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:webhooks:list",
      undefined,
    )
  })

  it("maps agent conversation window replacement to the agent IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.agent.replaceConversationWindowTarget({
      from: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
      },
      to: {
        projectId: "project-1",
        conversationId: "conversation-2",
        sessionKey: "local:renderer",
        title: "新会话",
      },
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:agent:replace-conversation-window-target",
      {
        from: {
          projectId: "project-1",
          conversationId: "conversation-1",
          sessionKey: "local:renderer",
        },
        to: {
          projectId: "project-1",
          conversationId: "conversation-2",
          sessionKey: "local:renderer",
          title: "新会话",
        },
      },
    )
  })

  it("maps content store install methods to narrow IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.contentStoreInstall.resolve("session-1")
    await bridge.contentStoreInstall.prepare("session-1")
    await bridge.contentStoreInstall.recordComplete("session-1")

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:content-store-install:resolve",
      { sessionId: "session-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:content-store-install:prepare",
      { sessionId: "session-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:content-store-install:record-complete",
      { sessionId: "session-1" },
    )
  })

  it("maps installer preparation methods to narrow IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.installers.prepareLocalSkillSource({ sourceDirectoryPath: "/tmp/skill" })
    await bridge.installers.prepareInlineRuleSource({ name: "team.rule", body: "# Rule" })
    await bridge.installers.installSourceToEditor({
      editorId: "codex" as never,
      scope: "global",
      source: {
        kind: "rule",
        origin: "inline",
        sourceIdentity: "inline-rule:abc",
        inlineSourceId: "source-1",
        name: "team.rule",
        body: "# Rule",
      },
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:installers:prepare-local-skill-source",
      { sourceDirectoryPath: "/tmp/skill" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:installers:prepare-inline-rule-source",
      { name: "team.rule", body: "# Rule" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:installers:install-source-to-editor",
      {
        editorId: "codex",
        scope: "global",
        source: {
          kind: "rule",
          origin: "inline",
          sourceIdentity: "inline-rule:abc",
          inlineSourceId: "source-1",
          name: "team.rule",
          body: "# Rule",
        },
      },
    )
  })

  it("maps editor scan content store upload to the narrow IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.editorScan.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project",
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:editor-scan:upload-skill-draft-to-content-store",
      {
        itemType: "skill",
        itemPath: "/tmp/skills/review",
        itemName: "review",
        editorId: "claude-code",
        scope: "project",
        projectPath: "/tmp/project",
      },
    )
  })

  it("maps account drive methods to account IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.account.listDriveItems({ parentId: null })
    await bridge.account.prepareDriveUpload({ parentId: null, name: "brief.txt", size: "11", mimeType: "text/plain" })
    await bridge.account.completeDriveUpload({ sessionId: "session-1" })
    await bridge.account.uploadDrivePreparedFile({
      body: new ArrayBuffer(11),
      headers: { "Content-Type": "text/plain" },
      method: "PUT",
      url: "https://upload.example.test/object",
    })
    await bridge.account.uploadDriveLocalItems({
      parentId: null,
      items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" }],
    })
    const droppedFile = new File(["report"], "report.txt", { type: "text/plain" })
    expect(bridge.account.filePathForDroppedFile(droppedFile)).toBe("/tmp/report.txt")
    expect(bridge.shell.filePathForDroppedFile(droppedFile)).toBe("/tmp/report.txt")
    await bridge.account.createDriveFolder({ parentId: null, name: "交接材料" })
    await bridge.account.deleteDriveItem({ itemId: "item-1" })
    await bridge.account.listDriveFileVersions({ itemId: "item-1", limit: 20 })
    await bridge.account.downloadDriveFileVersion({ itemId: "item-1", versionId: "version-1", outputPath: "/tmp/report-v1.txt" })
    await bridge.account.restoreDriveFileVersion({ itemId: "item-1", versionId: "version-1" })
    await bridge.account.deleteDriveFileVersion({ itemId: "item-1", versionId: "version-1" })
    await bridge.account.updateDriveFileVersionPin({ itemId: "item-1", versionId: "version-1", isPinned: true })
    await bridge.account.shareDriveItem({ itemId: "item-1", passwordEnabled: true, expiresIn: "7d", accessMode: "link_edit" })
    await bridge.account.listDriveShares()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:items:list",
      { parentId: null },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:uploads:prepare",
      { parentId: null, name: "brief.txt", size: "11", mimeType: "text/plain" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:uploads:complete",
      { sessionId: "session-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:uploads:put",
      {
        body: expect.any(ArrayBuffer),
        headers: { "Content-Type": "text/plain" },
        method: "PUT",
        url: "https://upload.example.test/object",
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:uploads:local-items",
      {
        parentId: null,
        items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" }],
      },
    )
    expect(electronMock.webUtils.getPathForFile).toHaveBeenCalledWith(droppedFile)
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:folders:create",
      { parentId: null, name: "交接材料" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:items:delete",
      { itemId: "item-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:file-versions:list",
      { itemId: "item-1", limit: 20 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:file-versions:download",
      { itemId: "item-1", versionId: "version-1", outputPath: "/tmp/report-v1.txt" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:file-versions:restore",
      { itemId: "item-1", versionId: "version-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:file-versions:delete",
      { itemId: "item-1", versionId: "version-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:file-versions:pin",
      { itemId: "item-1", versionId: "version-1", isPinned: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:items:share",
      { itemId: "item-1", passwordEnabled: true, expiresIn: "7d", accessMode: "link_edit" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:account:drive:shares:list",
      undefined,
    )
  })

  it("subscribes content change listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.content.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:events:content")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, {
      domain: "content",
      type: "content.changed",
      payload: { contentType: "prompt", contentId: "prompt-1", operation: "update" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith({ contentType: "prompt", contentId: "prompt-1", operation: "update" })
  })

  it("maps table description updates to the database IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.database.databaseTableUpdate({
      table: "customer_orders",
      description: "客户订单",
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:database:table:update",
      {
        table: "customer_orders",
        description: "客户订单",
      },
    )
  })

  it("maps Knowledge Base raw import and export methods to IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.knowledgeBase.uploadRawItems({
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      itemPaths: ["/tmp/folder"],
    })
    await bridge.knowledgeBase.selectAndUploadRawDirectory({
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
    })
    await bridge.knowledgeBase.exportRawEntries({
      projectId: "kb-1",
      relativePaths: ["brief.md"],
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:upload-raw-items",
      {
        projectId: "kb-1",
        targetDirectoryPath: "client-a",
        itemPaths: ["/tmp/folder"],
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:select-and-upload-raw-directory",
      {
        projectId: "kb-1",
        targetDirectoryPath: "client-a",
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:export-raw-entries",
      {
        projectId: "kb-1",
        relativePaths: ["brief.md"],
      },
    )
  })

  it("maps Knowledge Base storage migration methods and progress events", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    await bridge.knowledgeBase.getStorageStatus()
    await bridge.knowledgeBase.getStorageMigrationState()
    await bridge.knowledgeBase.startStorageMigration({
      target: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" },
    })
    await bridge.knowledgeBase.cancelStorageMigration()
    await bridge.knowledgeBase.recheckStorage()
    bridge.knowledgeBase.onStorageMigrationChanged(listener)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:get-storage-status",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:get-storage-migration-state",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:start-storage-migration",
      { target: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:cancel-storage-migration",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:knowledge-base:recheck-storage",
      undefined,
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      "synapse:events:knowledge-base",
      expect.any(Function),
    )

    const wrapped = electronMock.ipcRenderer.on.mock.calls.at(-1)?.[1]
    wrapped?.({}, {
      domain: "knowledge-base",
      type: "knowledge-base.storageMigrationChanged",
      payload: {
        active: true,
        phase: "copying",
        cancellable: true,
        copiedBytes: 12,
        totalBytes: 24,
        message: "正在复制知识库",
      },
      timestamp: "2026-06-10T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      phase: "copying",
      copiedBytes: 12,
    }))
  })

  it("maps Claude Code conversation and record methods to usage analysis IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.usageAnalysis.cc.listRecords({ preset: "all", limit: 50 })
    await bridge.usageAnalysis.cc.listRecordDetails({ sessionId: "session-1", limit: 200 })
    await bridge.usageAnalysis.cc.listConversations({ preset: "all", limit: 5 })
    await bridge.usageAnalysis.cc.getConversation("session-1", { eventId: "event-1" })
    await bridge.usageAnalysis.cc.getConversationChunk({ sessionId: "session-1", cursor: "128:1" })
    await bridge.usageAnalysis.cc.searchRecordsText({ preset: "all", query: "登录", rawText: true })
    await bridge.usageAnalysis.cc.searchConversationText({ preset: "all", query: "登录", rawText: true })
    await bridge.usageAnalysis.cc.openConversationWindow({ sessionId: "session-1", title: "对话" })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:records:list",
      { preset: "all", limit: 50 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:record-details:list",
      { sessionId: "session-1", limit: 200 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:conversations:list",
      { preset: "all", limit: 5 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:conversation:get",
      { sessionId: "session-1", focus: { eventId: "event-1" } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:conversation:chunk:get",
      { sessionId: "session-1", cursor: "128:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:records:search-text",
      { preset: "all", query: "登录", rawText: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:conversation:search-text",
      { preset: "all", query: "登录", rawText: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:usage-analysis:cc:conversation-window:open",
      { sessionId: "session-1", title: "对话" },
    )
  })

  it("maps model price methods to first-class IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.modelPrice.listCoverage({ source: "all", range: "30d", limit: 100 })
    await bridge.modelPrice.getRules()
    await bridge.modelPrice.listPresets()
    await bridge.modelPrice.importPreset("deepseek-official")
    await bridge.modelPrice.importPresets(["deepseek-official", "aliyun-bailian"])
    await bridge.modelPrice.saveRules([{ modelPattern: "local-model", inputPer1M: 1 }])
    await bridge.modelPrice.clearRules()
    await bridge.modelPrice.resetRules()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:coverage:list",
      { source: "all", range: "30d", limit: 100 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:rules:get",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:presets:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:presets:import",
      "deepseek-official",
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:presets:import",
      ["deepseek-official", "aliyun-bailian"],
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:rules:save",
      [{ modelPattern: "local-model", inputPer1M: 1 }],
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:rules:clear",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:model-price:rules:reset",
      undefined,
    )
  })

  it("maps workflow active runs to the workflow IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.workflow.activeRuns()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:workflow:active-runs",
      undefined,
    )
  })

  it("maps workflow parameter preset methods to workflow IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.workflowParamPresets.list("workflow-1")
    await bridge.workflowParamPresets.save({ workflowId: "workflow-1", name: "A", values: { topic: "secret" } })
    await bridge.workflowParamPresets.delete("preset-1")

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:workflow:param-presets:list",
      { workflowId: "workflow-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:workflow:param-presets:save",
      { workflowId: "workflow-1", name: "A", values: { topic: "secret" } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:workflow:param-presets:delete",
      { id: "preset-1" },
    )
  })

  it("maps Agent conversation bundle export to the Agent IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.agent.exportConversationBundle({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:agent:export-conversation-bundle",
      {
        projectId: "project-1",
        sessionKey: "local:renderer",
        conversationId: "conversation-1",
      },
    )
  })

  it("writes a renderer IPC failure log when bridge invoke rejects", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("main failed")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:config:get") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.config.get()).rejects.toThrow("main failed")

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:log:write",
      expect.objectContaining({
        level: "error",
        category: "renderer.ipc",
        message: "IPC invoke failed.",
        details: expect.objectContaining({
          channel: "synapse:config:get",
          error: "main failed",
        }),
      }),
    )
  })

  it("sanitizes renderer IPC failure log errors", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("token=sk-secret Bearer abc.def at /Users/liyang/private/file.ts")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:config:get") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.config.get()).rejects.toThrow("token=sk-secret")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:log:write")
    expect(logCall?.[1]).toEqual(expect.objectContaining({
      level: "error",
      category: "renderer.ipc",
      message: "IPC invoke failed.",
      details: expect.objectContaining({
        channel: "synapse:config:get",
        error: expect.any(String),
      }),
    }))

    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).not.toContain("sk-secret")
    expect(serializedLog).not.toContain("abc.def")
    expect(serializedLog).not.toContain("/Users/liyang/private")
  })

  it("does not log local file paths when local drive upload IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("upload unavailable")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:account:drive:uploads:local-items") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.account.uploadDriveLocalItems({
      parentId: "folder-1",
      items: [
        {
          kind: "file",
          path: "/Users/liyang/LocalUploadCanary/root.txt",
          name: "root.txt",
          mimeType: "text/plain",
        },
        {
          kind: "folder",
          folderName: "LocalUploadCanary",
          files: [
            {
              path: "/Users/liyang/LocalUploadCanary/a.md",
              relativePath: "a.md",
              mimeType: "text/markdown",
            },
            {
              path: "/Users/liyang/LocalUploadCanary/docs/b.md",
              relativePath: "docs/b.md",
              mimeType: null,
            },
          ],
        },
      ],
    })).rejects.toThrow("upload unavailable")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:log:write")
    expect(logCall?.[1]).toEqual(expect.objectContaining({
      level: "error",
      category: "renderer.ipc",
      message: "IPC invoke failed.",
      details: expect.objectContaining({
        channel: "synapse:account:drive:uploads:local-items",
        request: expect.objectContaining({
          itemCount: 2,
          fileCount: 3,
        }),
      }),
    }))

    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).not.toContain("/Users/liyang/LocalUploadCanary")
    expect(serializedLog).not.toContain("docs/b.md")
    expect(serializedLog).not.toContain("root.txt")
  })

  it("redacts Git remote URL credentials when clone IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("clone unavailable")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:git:repositories:clone") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.git.cloneRepository({
      name: "docs",
      remoteUrl: "https://writer:raw-password@git.example.com/team/docs.git?token=raw-token",
      targetPath: "/work/docs",
    })).rejects.toThrow("clone unavailable")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:log:write")
    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).toContain("git.example.com")
    expect(serializedLog).not.toContain("writer:raw-password")
    expect(serializedLog).not.toContain("raw-password")
    expect(serializedLog).not.toContain("raw-token")
  })

  it("redacts Agent message content when send IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("send unavailable")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:agent:send") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.agent.send({
      projectId: "project-1",
      sessionKey: "local:renderer",
      content: "请分析客户资料 token=agent-content-secret",
    })).rejects.toThrow("send unavailable")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:log:write")
    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).toContain("synapse:agent:send")
    expect(serializedLog).not.toContain("客户资料")
    expect(serializedLog).not.toContain("agent-content-secret")
  })

  it("redacts workflow definition and params content when runDefinition IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("workflow unavailable")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:workflow:run-definition") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.workflow.runDefinition({
      id: "workflow-1",
      name: "Workflow",
      version: "1",
      createdAt: 0,
      updatedAt: 0,
      params: [],
      nodes: [{
        id: "node-1",
        name: "Prompt",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { prompt: "总结内部合同 workflow-prompt-secret" },
      }],
      edges: [],
    }, {
      body: "客户输入 workflow-param-secret",
    })).rejects.toThrow("workflow unavailable")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:log:write")
    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).toContain("synapse:workflow:run-definition")
    expect(serializedLog).not.toContain("内部合同")
    expect(serializedLog).not.toContain("workflow-prompt-secret")
    expect(serializedLog).not.toContain("客户输入")
    expect(serializedLog).not.toContain("workflow-param-secret")
  })

  it("passes direct update event payloads through", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.updater.onStateChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:update:state-changed")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, { status: "downloaded" })

    expect(listener).toHaveBeenCalledWith({ status: "downloaded" })
  })

  it("maps Sound Notifier bridge methods to sound notifier IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.soundNotifier.getSettings()
    await bridge.soundNotifier.updateSettings({ selectedPresetId: "done", volume: 40 })
    await bridge.soundNotifier.play({ presetId: "done" })
    await bridge.soundNotifier.preview({ presetId: "attention", volume: 50 })
    bridge.soundNotifier.onChanged(vi.fn())
    bridge.soundNotifier.onPlayRequested(vi.fn())

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:sound-notifier:settings:get",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:sound-notifier:settings:update",
      { selectedPresetId: "done", volume: 40 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:sound-notifier:play",
      { presetId: "done" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:sound-notifier:preview",
      { presetId: "attention", volume: 50 },
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenNthCalledWith(
      1,
      "synapse:sound-notifier:changed",
      expect.any(Function),
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenNthCalledWith(
      2,
      "synapse:sound-notifier:play-requested",
      expect.any(Function),
    )
  })
})
