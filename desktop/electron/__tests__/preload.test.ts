import { readFile } from "node:fs/promises"
import path from "node:path"
import { build } from "esbuild"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseBridge } from "../../src/types/bridge"
import { channelForDomain } from "../runtime/event-bus"

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

  it("bundles preload into a single script for Electron sandbox loading", async () => {
    const result = await build({
      entryPoints: [path.resolve(__dirname, "..", "preload.ts")],
      bundle: true,
      platform: "node",
      target: "es2022",
      format: "cjs",
      external: ["electron"],
      write: false,
      logLevel: "silent",
    })
    const output = result.outputFiles[0]?.text ?? ""

    expect(output).toContain('require("electron")')
    expect(output).not.toMatch(/require\(["']\.{1,2}\//)
  })

  it("subscribes repository listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.settings.repository.onProgress(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:app:events:operation:repository")

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

    bridge.database.operation.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:app:events:operation:database")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, {
      domain: "database",
      type: "database.changed",
      payload: { table: "notes" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith({ table: "notes" })
  })

  it("maps the MCP bridge to dedicated channels without database aliases", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.mcp.server.get()
    await bridge.mcp.registration.list()
    await bridge.mcp.registration.openSettings("codex")
    await bridge.mcp.registration.register("codex")

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:mcp:server:get",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:mcp:registration:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:app:mcp:registration:open_settings",
      "codex",
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:app:mcp:registration:register",
      "codex",
    )
    expect(bridge.database).not.toHaveProperty("mcp")
    expect(bridge.database).not.toHaveProperty("mcpHttpStatus")
    expect(bridge.database).not.toHaveProperty("mcpServers")
    expect(bridge.database).not.toHaveProperty("mcpSettings")
  })

  it("subscribes automation change listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.automation.item.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:app:events:operation:automation")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, {
      domain: "automation",
      type: "automation.itemChanged",
      payload: { automationId: "automation-1", reason: "run-finished" },
      timestamp: "2026-06-03T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith({ automationId: "automation-1", reason: "run-finished" })
  })

  it("subscribes Agent listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()
    const event = {
      domain: "agent" as const,
      type: "phase.update" as const,
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        conversationId: "conversation-1",
        runId: "run-1",
        phase: "completed" as const,
        status: "done" as const,
      },
      timestamp: "2026-07-21T00:00:00.000Z",
    }

    bridge.agent.onEvent(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe(channelForDomain("agent"))

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it("subscribes Workflow listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.workflow.operation.onEvent(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe(channelForDomain("workflow"))
  })

  it("maps automation bridge methods to automation IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.automation.editor.openCreate()
    await bridge.automation.editor.openEdit("automation:1")
    await bridge.automation.item.list()
    await bridge.automation.item.get("automation:1")
    await bridge.automation.item.create({
      name: "Daily report",
      scope: { type: "global" },
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 10, activeDays: [0, 1, 2, 3, 4, 5, 6] },
      },
      executor: { type: "builtin.command", config: { command: "echo ok" } },
    })
    await bridge.automation.item.update({ id: "automation:1", patch: { enabled: false } })
    await bridge.automation.item.setEnabled({ id: "automation:1", enabled: true })
    await bridge.automation.run.execute("automation:1")
    await bridge.automation.run.disable("automation-run:1")
    await bridge.automation.run.list("automation:1", { limit: 20 })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:editor:open_create",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:editor:open_edit",
      { automationId: "automation:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:item:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:item:get",
      { automationId: "automation:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:item:update",
      { id: "automation:1", patch: { enabled: false } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:item:set_enabled",
      { automationId: "automation:1", enabled: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:run:execute",
      { automationId: "automation:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:run:disable",
      { runId: "automation-run:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:automation:run:list",
      { automationId: "automation:1", limit: 20 },
    )
  })

  it("maps skill uninstaller methods to IPC channels", async () => {
    const bridge = await loadPreloadBridge()
    await bridge.skillUninstaller.scan({ scanId: "scan-1", query: { name: "jenkins" } })
    await bridge.skillUninstaller.scanNames({ scanId: "names-1" })
    await bridge.skillUninstaller.cancelScan({ scanId: "scan-1" })
    await bridge.skillUninstaller.cancelUninstall({ operationId: "uninstall-1" })
    await bridge.skillUninstaller.uninstall({
      operationId: "uninstall-1",
      targets: [{ query: { name: "jenkins" }, path: "/tmp/jenkins" }],
    })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:skill_uninstaller:operation:scan",
      { scanId: "scan-1", query: { name: "jenkins" } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:skill_uninstaller:names:scan",
      { scanId: "names-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:skill_uninstaller:scan:cancel",
      { scanId: "scan-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:skill_uninstaller:uninstall:cancel",
      { operationId: "uninstall-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:skill_uninstaller:operation:uninstall",
      { operationId: "uninstall-1", targets: [{ query: { name: "jenkins" }, path: "/tmp/jenkins" }] },
    )
  })

  it("maps quick input bridge methods to quick input IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.quickInput.item.list()
    await bridge.quickInput.item.create({ content: "新的快捷输入" })
    await bridge.quickInput.item.update({ id: "quick-1", content: "更新快捷输入" })
    await bridge.quickInput.item.delete({ id: "quick-1" })
    bridge.quickInput.item.onChanged(vi.fn())

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:quick_input:item:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:quick_input:item:create",
      { content: "新的快捷输入" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:app:quick_input:item:update",
      { id: "quick-1", content: "更新快捷输入" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:app:quick_input:item:delete",
      { id: "quick-1" },
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      "synapse:app:quick_input:item:changed",
      expect.any(Function),
    )
  })

  it("maps text extractor methods and status events to canonical IPC channels", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    await bridge.textExtractor.document.choose()
    await bridge.textExtractor.document.extract({
      operationId: "run-1",
      filePath: "/tmp/report.pdf",
    })
    await bridge.textExtractor.document.cancel({ operationId: "run-1" })
    await bridge.textExtractor.output.choose({ defaultPath: "report.txt" })
    await bridge.textExtractor.text.save({
      outputPath: "/tmp/report.txt",
      text: "正文",
    })
    bridge.textExtractor.operation.onStatus(listener)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:text_extractor:document:choose",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:text_extractor:document:extract",
      { operationId: "run-1", filePath: "/tmp/report.pdf" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:app:text_extractor:operation:cancel",
      { operationId: "run-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:app:text_extractor:output:choose",
      { defaultPath: "report.txt" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      5,
      "synapse:app:text_extractor:text:save",
      { outputPath: "/tmp/report.txt", text: "正文" },
    )
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe(
      "synapse:app:text_extractor:operation:status",
    )

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, { operationId: "run-1", status: "running" })
    expect(listener).toHaveBeenCalledWith({ operationId: "run-1", status: "running" })
  })

  it("maps agent persona bridge methods to agent persona IPC channels", async () => {
    const bridge = await loadPreloadBridge()
    const input = {
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
    }

    await bridge.agentPersonas.list()
    await bridge.agentPersonas.create(input)
    await bridge.agentPersonas.update({ id: "persona-1", ...input })
    await bridge.agentPersonas.updateBuiltinModel({
      id: "builtin-zh-en-translator",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })
    await bridge.agentPersonas.delete({ id: "persona-1" })
    bridge.agentPersonas.onChanged(vi.fn())

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:agent_personas:operation:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:agent_personas:operation:create",
      input,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:app:agent_personas:operation:update",
      { id: "persona-1", ...input },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:app:agent_personas:builtin_model:update",
      {
        id: "builtin-zh-en-translator",
        providerModel: { providerId: "claude", modelTier: "sonnet" },
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      5,
      "synapse:app:agent_personas:operation:delete",
      { id: "persona-1" },
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      "synapse:app:agent_personas:operation:changed",
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
        directoryName: "docs",
        parentDirectory: "/work",
        remoteUrl: "https://github.com/acme/docs.git",
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
      "synapse:app:account:webhooks:list",
      undefined,
    )
  })

  it("maps account login cancellation to its dedicated IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.account.cancelLogin()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:account:operation:cancel_login",
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
      "synapse:app:agent:operation:replace_conversation_window_target",
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

  it("maps Agent reference actions to two narrow IPC channels", async () => {
    const bridge = await loadPreloadBridge()
    const request = {
      projectId: "project-1",
      reference: "/tmp/report.json:12:3",
    }

    await bridge.agent.openReferenceDefault(request)
    await bridge.agent.showReferenceInFolder(request)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:agent:reference:open_default",
      request,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:agent:reference:show_in_folder",
      request,
    )
  })

  it("maps installer preparation methods to narrow IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.installers.inspectGlobalSkillInstallations({
      kind: "skill",
      origin: "prepared",
      sourceIdentity: "synapse-skill",
      preparedSourceId: "synapse-skill:test",
      name: "synapse-skill",
      sourceFingerprint: "sha256:test",
    })
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
    await bridge.installers.installSourceToEditorTargets({
      mode: "install",
      source: {
        kind: "skill",
        origin: "prepared",
        sourceIdentity: "synapse-skill",
        name: "synapse-skill",
        title: "Synapse Skill",
        description: "Synapse MCP 使用指南",
        preparedSourceId: "synapse-skill:test",
        mainContent: "# Synapse Skill",
        sourceFingerprint: "sha256:test",
      },
      targets: [{ editorId: "codex" as never, scope: "global" }],
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:installers:operation:inspect_global_skill_installations",
      {
        kind: "skill",
        origin: "prepared",
        sourceIdentity: "synapse-skill",
        preparedSourceId: "synapse-skill:test",
        name: "synapse-skill",
        sourceFingerprint: "sha256:test",
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:installers:operation:prepare_local_skill_source",
      { sourceDirectoryPath: "/tmp/skill" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:installers:operation:prepare_inline_rule_source",
      { name: "team.rule", body: "# Rule" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:installers:operation:install_source_to_editor",
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
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:installers:operation:install_source_to_editor_targets",
      {
        mode: "install",
        source: {
          kind: "skill",
          origin: "prepared",
          sourceIdentity: "synapse-skill",
          name: "synapse-skill",
          title: "Synapse Skill",
          description: "Synapse MCP 使用指南",
          preparedSourceId: "synapse-skill:test",
          mainContent: "# Synapse Skill",
          sourceFingerprint: "sha256:test",
        },
        targets: [{ editorId: "codex", scope: "global" }],
      },
    )
  })

  it("maps editor scan Skill Repository upload to the narrow IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.editorScan.uploadSkillToSkillRepository({
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project",
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:editor_scan:operation:upload_skill_to_skill_repository",
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

  it("maps cancellable editor scans to their narrow IPC channels", async () => {
    const bridge = await loadPreloadBridge()
    const request = { requestId: "4ca12db4-dcf0-4bfd-905a-4bf65f63204f" }

    await bridge.editorScan.scanAll(request)
    await bridge.editorScan.cancelScan(request)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:editor_scan:operation:scan_all",
      request,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:editor_scan:operation:cancel_scan",
      request,
    )
  })

  it("maps Skill Repository identity retry to the local-only IPC channel", async () => {
    const bridge = await loadPreloadBridge()
    const request = {
      itemType: "skill" as const,
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code" as const,
      scope: "project" as const,
      projectPath: "/tmp/project",
      repositoryId: "repo-1",
      name: "review",
      owner: "alice",
      expectedSourceFingerprint: "sha256:source",
      expectedIdentityId: null,
    }

    await bridge.editorScan.retrySkillRepositoryIdentity(request)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:editor_scan:operation:retry_skill_repository_identity",
      request,
    )
  })

  it("maps checked Skill publish finalization to the narrow IPC channel", async () => {
    const bridge = await loadPreloadBridge()
    const request = {
      contentId: "skill-1",
      mode: "overwrite" as const,
      repositoryVersion: "20260713010101",
      sessionId: "c5e23732-3f58-40c2-9d71-7ce5d0df07be",
    }

    await bridge.editorScan.finalizeQuickPublish(request)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:editor_scan:operation:finalize_quick_publish",
      request,
    )
  })

  it("maps account drive methods to account IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.drive.item.list({ parentId: null })
    await bridge.drive.upload.prepare({ parentId: null, name: "brief.txt", size: "11", mimeType: "text/plain" })
    await bridge.drive.upload.complete({ sessionId: "session-1" })
    await bridge.drive.upload.put({
      body: new ArrayBuffer(11),
      headers: { "Content-Type": "text/plain" },
      method: "PUT",
      url: "https://upload.example.test/object",
    })
    await bridge.drive.upload.localItems({
      parentId: null,
      items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" }],
    })
    const droppedFile = new File(["report"], "report.txt", { type: "text/plain" })
    expect(bridge.drive.localFile.pathForDroppedFile(droppedFile)).toBe("/tmp/report.txt")
    expect(bridge.shell.filePathForDroppedFile(droppedFile)).toBe("/tmp/report.txt")
    await bridge.drive.folder.create({ parentId: null, name: "交接材料" })
    await bridge.drive.item.delete({ itemId: "item-1" })
    await bridge.drive.fileVersion.list({ itemId: "item-1", limit: 20 })
    await bridge.drive.fileVersionDownload.create({ itemId: "item-1", versionId: "version-1", outputPath: "/tmp/report-v1.txt" })
    await bridge.drive.fileVersion.restore({ itemId: "item-1", versionId: "version-1" })
    await bridge.drive.fileVersion.delete({ itemId: "item-1", versionId: "version-1" })
    await bridge.drive.fileVersionPin.update({ itemId: "item-1", versionId: "version-1", isPinned: true })
    await bridge.drive.share.create({ itemId: "item-1", passwordEnabled: true, expiresIn: "7d", accessMode: "link_edit" })
    await bridge.drive.share.list()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:item:list",
      { parentId: null },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:upload:prepare",
      { parentId: null, name: "brief.txt", size: "11", mimeType: "text/plain" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:upload:complete",
      { sessionId: "session-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:upload:put",
      {
        body: expect.any(ArrayBuffer),
        headers: { "Content-Type": "text/plain" },
        method: "PUT",
        url: "https://upload.example.test/object",
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:upload:local_items",
      {
        parentId: null,
        items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" }],
      },
    )
    expect(electronMock.webUtils.getPathForFile).toHaveBeenCalledWith(droppedFile)
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:folder:create",
      { parentId: null, name: "交接材料" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:item:delete",
      { itemId: "item-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:file_version:list",
      { itemId: "item-1", limit: 20 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:file_version_download:create",
      { itemId: "item-1", versionId: "version-1", outputPath: "/tmp/report-v1.txt" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:file_version:restore",
      { itemId: "item-1", versionId: "version-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:file_version:delete",
      { itemId: "item-1", versionId: "version-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:file_version_pin:update",
      { itemId: "item-1", versionId: "version-1", isPinned: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:share:create",
      { itemId: "item-1", passwordEnabled: true, expiresIn: "7d", accessMode: "link_edit" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive:share:list",
      undefined,
    )
  })

  it("maps drive sync methods to drive sync IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    expect(bridge.driveSync).not.toHaveProperty("createBinding")
    await bridge.driveSync.getSnapshot()
    await bridge.driveSync.previewBinding({
      driveItemId: "drive-item-1",
      driveItemName: "spec.md",
      kind: "file",
      localPath: "/tmp/spec.md",
      remoteExists: true,
    })
    await bridge.driveSync.createSafeBinding({
      driveItemId: "drive-item-1",
      driveItemName: "spec.md",
      kind: "file",
      localPath: "/tmp/spec.md",
      direction: "remote_to_local",
    })
    await bridge.driveSync.pauseBinding({ id: "binding-1" })
    await bridge.driveSync.resumeBinding({ id: "binding-1" })
    await bridge.driveSync.updateExcludeRules({
      id: "binding-1",
      defaults: ["node_modules/"],
      importedGitignore: ["dist/"],
      user: ["private/"],
    })
    await bridge.driveSync.rescanBinding({ id: "binding-1" })
    await bridge.driveSync.pollRemoteChanges({ id: "binding-1" })
    await bridge.driveSync.resolveConflict({ conflictId: "conflict-1", action: "keep_local" })
    await bridge.driveSync.chooseLocalPath({ kind: "folder" })
    await bridge.driveSync.removeBinding({ id: "binding-1" })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:snapshot:get", undefined)
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive_sync:bindings:preview",
      expect.objectContaining({ driveItemId: "drive-item-1" }),
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:drive_sync:bindings:safe_create",
      expect.objectContaining({ direction: "remote_to_local" }),
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:bindings:pause", { id: "binding-1" })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:bindings:resume", { id: "binding-1" })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:bindings:exclude_rules:update", {
      id: "binding-1",
      defaults: ["node_modules/"],
      importedGitignore: ["dist/"],
      user: ["private/"],
    })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:bindings:rescan", { id: "binding-1" })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:remote:poll", { id: "binding-1" })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:conflicts:resolve", { conflictId: "conflict-1", action: "keep_local" })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:local_path:choose", { kind: "folder" })
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:app:drive_sync:bindings:remove", { id: "binding-1" })
  })

  it("subscribes content change listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.resourceRepository.item.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:app:events:operation:content")

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

    await bridge.database.table.update({
      table: "customer_orders",
      description: "客户订单",
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:database:table:update",
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
      "synapse:app:knowledge_base:operation:upload_raw_items",
      {
        projectId: "kb-1",
        targetDirectoryPath: "client-a",
        itemPaths: ["/tmp/folder"],
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:knowledge_base:operation:select_and_upload_raw_directory",
      {
        projectId: "kb-1",
        targetDirectoryPath: "client-a",
      },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:knowledge_base:operation:export_raw_entries",
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
      "synapse:app:knowledge_base:operation:get_storage_status",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:knowledge_base:operation:get_storage_migration_state",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:knowledge_base:operation:start_storage_migration",
      { target: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:knowledge_base:operation:cancel_storage_migration",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:knowledge_base:operation:recheck_storage",
      undefined,
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      "synapse:app:events:operation:knowledge_base",
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
      "synapse:app:usage_analysis:cc:records:list",
      { preset: "all", limit: 50 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:usage_analysis:cc:record_details:list",
      { sessionId: "session-1", limit: 200 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:usage_analysis:cc:conversations:list",
      { preset: "all", limit: 5 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:usage_analysis:cc:conversation:get",
      { sessionId: "session-1", focus: { eventId: "event-1" } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:usage_analysis:cc:conversation:chunk:get",
      { sessionId: "session-1", cursor: "128:1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:usage_analysis:cc:records:search_text",
      { preset: "all", query: "登录", rawText: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:usage_analysis:cc:conversation:search_text",
      { preset: "all", query: "登录", rawText: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:usage_analysis:cc:conversation_window:open",
      { sessionId: "session-1", title: "对话" },
    )
  })

  it("maps model price methods to first-class IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.modelPrice.usedModel.list({ source: "all", range: "30d", limit: 100 })
    await bridge.modelPrice.rule.list()
    await bridge.modelPrice.preset.list()
    await bridge.modelPrice.preset.import("deepseek-official")
    await bridge.modelPrice.preset.import(["deepseek-official", "aliyun-bailian"])
    await bridge.modelPrice.rule.save([{ modelPattern: "local-model", inputPer1M: 1 }])
    await bridge.modelPrice.rule.clear()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:model_price:used_model:list",
      { source: "all", range: "30d", limit: 100 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:model_price:rule:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:model_price:preset:list",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:model_price:preset:import",
      "deepseek-official",
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:model_price:preset:import",
      ["deepseek-official", "aliyun-bailian"],
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:model_price:rule:save",
      [{ modelPattern: "local-model", inputPer1M: 1 }],
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:model_price:rule:clear",
      undefined,
    )
  })

  it("maps workflow active runs to the workflow IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.workflow.run.listActive()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:workflow:run:list_active",
      undefined,
    )
  })

  it("maps workflow parameter preset methods to workflow IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.workflow.paramPreset.list("workflow-1")
    await bridge.workflow.paramPreset.resolveResourceEntryTypes("preset-1")
    await bridge.workflow.paramPreset.save({ workflowId: "workflow-1", name: "A", values: { topic: "secret" } })
    await bridge.workflow.paramPreset.delete("preset-1")

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:workflow:param_preset:list",
      { workflowId: "workflow-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:workflow:param_preset:resolve_resource_entry_types",
      { id: "preset-1" },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:workflow:param_preset:save",
      { workflowId: "workflow-1", name: "A", values: { topic: "secret" } },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:workflow:param_preset:delete",
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
      "synapse:app:agent:operation:export_conversation_bundle",
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
      if (channel === "synapse:app:config:operation:get") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.config.get()).rejects.toThrow("main failed")

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:log:entry:write",
      expect.objectContaining({
        level: "error",
        category: "renderer.ipc",
        message: "IPC invoke failed.",
        details: expect.objectContaining({
          operationId: "app.config.operation.get",
          error: "main failed",
        }),
      }),
    )
  })

  it("sanitizes renderer IPC failure log errors", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("token=sk-secret Bearer abc.def at /Users/liyang/private/file.ts")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:app:config:operation:get") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.config.get()).rejects.toThrow("token=sk-secret")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:app:log:entry:write")
    expect(logCall?.[1]).toEqual(expect.objectContaining({
      level: "error",
      category: "renderer.ipc",
      message: "IPC invoke failed.",
      details: expect.objectContaining({
        operationId: "app.config.operation.get",
        error: expect.any(String),
      }),
    }))

    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).not.toContain("sk-secret")
    expect(serializedLog).not.toContain("abc.def")
    expect(serializedLog).not.toContain("/Users/liyang/private")
  })

  it("does not log secret mutation fields when Secrets IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("secret storage unavailable")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if ([
        "synapse:app:secrets:item:create",
        "synapse:app:secrets:item:update",
        "synapse:app:secrets:item:upsert",
      ].includes(channel)) {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })
    const input = {
      name: "PRIVATE_SECRET_NAME",
      value: "PRIVATE_SECRET_VALUE",
      description: "PRIVATE_SECRET_DESCRIPTION",
    }

    await expect(bridge.secrets.item.create(input)).rejects.toThrow("secret storage unavailable")
    await expect(bridge.secrets.item.update(input)).rejects.toThrow("secret storage unavailable")
    await expect(bridge.secrets.item.upsert(input)).rejects.toThrow("secret storage unavailable")

    const logCalls = electronMock.ipcRenderer.invoke.mock.calls.filter(([channel]) =>
      channel === "synapse:app:log:entry:write")
    expect(logCalls).toHaveLength(3)
    for (const logCall of logCalls) {
      expect(logCall[1]).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          request: {
            nameProvided: true,
            valueProvided: true,
            descriptionProvided: true,
          },
        }),
      }))
    }
    const serializedLogs = JSON.stringify(logCalls)
    expect(serializedLogs).not.toContain("PRIVATE_SECRET_NAME")
    expect(serializedLogs).not.toContain("PRIVATE_SECRET_VALUE")
    expect(serializedLogs).not.toContain("PRIVATE_SECRET_DESCRIPTION")
  })

  it("does not log installer secret map values when install IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel.startsWith("synapse:app:installers:operation:install_source_to_editor")) {
        return Promise.reject(new Error("install unavailable"))
      }
      return Promise.resolve(undefined)
    })
    const source = {
      kind: "skill" as const,
      origin: "prepared" as const,
      sourceIdentity: "synapse-skill",
      preparedSourceId: "synapse-skill:test",
      name: "synapse-skill",
    }
    const secretMaps = {
      skillEnvReplacementValues: { TOKEN: "RAW_REPLACEMENT_SECRET" },
      skillEnvValues: { BAILIAN: "RAW_ENV_SECRET" },
      skillEnvSecretNames: { REGION: "prod-bailian-main" },
      variableSubstitutions: { SERVICE: "RAW_VARIABLE_SECRET" },
      variableSecretNames: { TENANT: "aliyun-primary" },
    }

    await expect(bridge.installers.installSourceToEditor({
      editorId: "codex" as never,
      scope: "global",
      source,
      ...secretMaps,
    })).rejects.toThrow("install unavailable")
    await expect(bridge.installers.installSourceToEditorTargets({
      mode: "install",
      source,
      targets: [{ editorId: "codex" as never, scope: "global" }],
      ...secretMaps,
    })).rejects.toThrow("install unavailable")

    const logCalls = electronMock.ipcRenderer.invoke.mock.calls.filter(([channel]) =>
      channel === "synapse:app:log:entry:write")
    expect(logCalls).toHaveLength(2)
    for (const logCall of logCalls) {
      expect(logCall[1]).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          request: expect.objectContaining({
            skillEnvReplacementValues: { type: "sensitive-map", keyCount: 1 },
            skillEnvValues: { type: "sensitive-map", keyCount: 1 },
            skillEnvSecretNames: { type: "sensitive-map", keyCount: 1 },
            variableSubstitutions: { type: "sensitive-map", keyCount: 1 },
            variableSecretNames: { type: "sensitive-map", keyCount: 1 },
          }),
        }),
      }))
    }
    const serializedLogs = JSON.stringify(logCalls)
    expect(serializedLogs).not.toContain("RAW_ENV_SECRET")
    expect(serializedLogs).not.toContain("RAW_REPLACEMENT_SECRET")
    expect(serializedLogs).not.toContain("RAW_VARIABLE_SECRET")
    expect(serializedLogs).not.toContain("prod-bailian-main")
    expect(serializedLogs).not.toContain("aliyun-primary")
    expect(serializedLogs).not.toContain("BAILIAN")
    expect(serializedLogs).not.toContain("REGION")
    expect(serializedLogs).not.toContain("SERVICE")
    expect(serializedLogs).not.toContain("TENANT")
  })

  it("does not log local file paths when local drive upload IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("upload unavailable")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:app:drive:upload:local_items") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.drive.upload.localItems({
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
      channel === "synapse:app:log:entry:write")
    expect(logCall?.[1]).toEqual(expect.objectContaining({
      level: "error",
      category: "renderer.ipc",
      message: "IPC invoke failed.",
      details: expect.objectContaining({
        operationId: "app.drive.upload.local_items",
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
      if (channel === "synapse:app:git:repositories:clone") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.git.cloneRepository({
      directoryName: "docs",
      parentDirectory: "/work",
      remoteUrl: "https://writer:raw-password@git.example.com/team/docs.git?token=raw-token",
    })).rejects.toThrow("clone unavailable")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:app:log:entry:write")
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
      if (channel === "synapse:app:agent:operation:send") {
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
      channel === "synapse:app:log:entry:write")
    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).toContain("app.agent.operation.send")
    expect(serializedLog).not.toContain("客户资料")
    expect(serializedLog).not.toContain("agent-content-secret")
  })

  it("redacts workflow definition and params content when runDefinition IPC fails", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("workflow unavailable")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:app:workflow:operation:run_definition") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.workflow.operation.runDefinition({
      id: "workflow-1",
      name: "Workflow",
      version: "1",
      createdAt: 0,
      updatedAt: 0,
      layoutDirection: "horizontal" as const,
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
      channel === "synapse:app:log:entry:write")
    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).toContain("app.workflow.operation.run_definition")
    expect(serializedLog).not.toContain("内部合同")
    expect(serializedLog).not.toContain("workflow-prompt-secret")
    expect(serializedLog).not.toContain("客户输入")
    expect(serializedLog).not.toContain("workflow-param-secret")
  })

  it("forwards script confirmation tokens for workflow reruns", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.workflow.operation.rerun(
      "previous-run",
      { topic: "release" },
      true,
      "workflow-1",
      "sha256:review-token",
    )

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:workflow:operation:rerun",
      {
        previousRunId: "previous-run",
        params: { topic: "release" },
        force: true,
        workflowId: "workflow-1",
        scriptConfirmationToken: "sha256:review-token",
      },
    )
  })

  it("passes direct update event payloads through", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.updater.onStateChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:app:update:operation:state_changed")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, { status: "downloaded" })

    expect(listener).toHaveBeenCalledWith({ status: "downloaded" })
  })

  it("maps reliable update-open delivery through the updater bridge", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    await bridge.updater.getPendingOpenRequest()
    await bridge.updater.acknowledgeOpenRequest(7)
    bridge.updater.onOpenRequest(listener)

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:update:operation:get_pending_open_request",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:update:operation:acknowledge_open_request",
      { id: 7 },
    )
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe(
      "synapse:app:update:operation:open_request",
    )

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, { id: 7, automatic: true })

    expect(listener).toHaveBeenCalledWith({ id: 7, automatic: true })
  })

  it("maps Sound Notifier bridge methods to sound notifier IPC channels", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.soundNotifier.settings.get()
    await bridge.soundNotifier.settings.update({})
    await bridge.soundNotifier.sound.play({ presetId: "done", repeatCount: 3 })
    await bridge.soundNotifier.sound.preview({ eventType: "input-required", intervalMs: 1500 })
    bridge.soundNotifier.operation.onChanged(vi.fn())
    bridge.soundNotifier.operation.onPlayRequested(vi.fn())

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:sound_notifier:settings:get",
      undefined,
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:sound_notifier:settings:update",
      {},
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:app:sound_notifier:sound:play",
      { presetId: "done", repeatCount: 3 },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      "synapse:app:sound_notifier:sound:preview",
      { eventType: "input-required", intervalMs: 1500 },
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenNthCalledWith(
      1,
      "synapse:app:sound_notifier:operation:changed",
      expect.any(Function),
    )
    expect(electronMock.ipcRenderer.on).toHaveBeenNthCalledWith(
      2,
      "synapse:app:sound_notifier:operation:play_requested",
      expect.any(Function),
    )
  })

  it("maps the three System Notifier bridge methods without exposing events or an arbitrary trigger", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.systemNotifier.settings.get()
    await bridge.systemNotifier.settings.update({ enabled: false, silent: true })
    await bridge.systemNotifier.notification.test()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      "synapse:app:system_notifier:settings:get",
      {},
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      "synapse:app:system_notifier:settings:update",
      { enabled: false, silent: true },
    )
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      "synapse:app:system_notifier:notification:test",
      {},
    )
    expect(Object.keys(bridge.systemNotifier)).toEqual(["settings", "notification"])
    expect(Object.keys(bridge.systemNotifier.notification)).toEqual(["test"])
  })

  it("maps the single JSON Repair bridge method without events", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.jsonRepair.text.repair({ text: "{ok:true}" })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:app:json_repair:text:repair",
      { text: "{ok:true}" },
    )
    expect(Object.keys(bridge.jsonRepair)).toEqual(["text"])
    expect(Object.keys(bridge.jsonRepair.text)).toEqual(["repair"])
  })

})
