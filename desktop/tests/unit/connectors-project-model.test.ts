import { describe, expect, it } from "vitest"
import { applySynapseConfigPatch, createDefaultConfig } from "../../src/lib/config"
import {
  addInlineProviderToProject,
  bindGlobalProviderToProject,
  createCcConnectProjectDraft,
  createProjectPlatformConnectionFromConnector,
  listLinkableGlobalProviders,
  parseDisabledCommands,
  removeProviderFromProject,
  resolveProjectProvidersForSession,
  sanitizeCcProjectName,
  setActiveProviderForProject,
  summarizeCcConnectProjects,
  unbindGlobalProviderFromProject,
  updateCcConnectProjectSettings,
} from "../../src/modules/connectors/project-model"
import { createProviderDraft } from "../../src/lib/provider-model"

describe("connectors project model", () => {
  it("sanitizes project names like the old CC Connect project wizard", () => {
    expect(sanitizeCcProjectName("my project/测试_01")).toBe("myproject_01")
  })

  it("creates a persisted CC Connect project draft with agent and workdir", () => {
    const project = createCcConnectProjectDraft({
      id: "project-1",
      name: "synapse",
      workDir: "/Users/liyang/Synapse",
      agentType: "codex",
    })

    expect(project).toMatchObject({
      id: "project-1",
      name: "synapse",
      path: "/Users/liyang/Synapse",
      workDir: "/Users/liyang/Synapse",
      agentType: "codex",
      mode: "single",
      permissionMode: "default",
      providerRefs: [],
      source: "cc-connect",
      platformConnections: [],
    })
  })

  it("summarizes project cards from real config data", () => {
    const summaries = summarizeCcConnectProjects([
      {
        id: "project-1",
        name: "synapse",
        path: "/repo/synapse",
        agentType: "codex",
        permissionMode: "acceptEdits",
        language: "zh",
        adminFrom: "u1",
        disabledCommands: ["restart"],
        providerRefs: ["openai"],
        activeProvider: "openai",
        platformConnections: [
          {
            id: "conn-1",
            type: "telegram",
            name: "Telegram",
            status: "configured",
            enabled: true,
            allowFrom: "u1",
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:00:00.000Z",
          },
        ],
      },
    ])

    expect(summaries).toEqual([
      {
        id: "project-1",
        name: "synapse",
        workDir: "/repo/synapse",
        agentType: "codex",
        permissionMode: "acceptEdits",
        language: "zh",
        adminFrom: "u1",
        disabledCommands: ["restart"],
        providerRefs: ["openai"],
        activeProvider: "openai",
        heartbeatEnabled: false,
        platformCount: 1,
        platforms: [
          {
            id: "conn-1",
            type: "telegram",
            name: "Telegram",
            status: "configured",
            enabled: true,
            allowFrom: "u1",
          },
        ],
        sessionCount: null,
      },
    ])
  })

  it("updates project settings without losing project identity", () => {
    const updated = updateCcConnectProjectSettings(
      {
        id: "project-1",
        name: "synapse",
        path: "/repo/old",
      },
      {
        adminFrom: "u1,u2",
        agentType: "codex",
        disabledCommands: "restart, upgrade",
        language: "zh",
        permissionMode: "acceptEdits",
        workDir: "/repo/new",
      },
    )

    expect(updated).toMatchObject({
      id: "project-1",
      name: "synapse",
      path: "/repo/new",
      workDir: "/repo/new",
      agentType: "codex",
      permissionMode: "acceptEdits",
      language: "zh",
      adminFrom: "u1,u2",
      disabledCommands: ["restart", "upgrade"],
    })
  })

  it("parses disabled commands from a comma separated field", () => {
    expect(parseDisabledCommands(" restart, ,upgrade ")).toEqual(["restart", "upgrade"])
  })

  it("binds and unbinds global providers on project refs", () => {
    const project = createCcConnectProjectDraft({
      id: "project-1",
      name: "synapse",
      workDir: "/repo/synapse",
      agentType: "codex",
    })

    const bound = bindGlobalProviderToProject(project, "OpenAI")
    expect(bound.providerRefs).toEqual(["openai"])

    const active = setActiveProviderForProject(bound, "openai")
    expect(active.activeProvider).toBe("openai")

    const unbound = unbindGlobalProviderFromProject(active, "openai")
    expect(unbound.providerRefs).toEqual([])
    expect(unbound.activeProvider).toBeNull()
  })

  it("filters linkable global providers by refs, inline names, and agent type", () => {
    const project = {
      id: "project-1",
      name: "synapse",
      path: "/repo/synapse",
      agentType: "codex",
      providerRefs: ["global-a"],
      providers: [
        createProviderDraft({
          name: "inline-b",
          scope: "project",
          projectId: "project-1",
        }).provider,
      ],
    }
    const globals = [
      createProviderDraft({ name: "global-a", agentTypes: ["codex"] }).provider,
      createProviderDraft({ name: "inline-b", agentTypes: ["codex"] }).provider,
      createProviderDraft({ name: "claude-only", agentTypes: ["claudecode"] }).provider,
      createProviderDraft({ name: "codex-ok", agentTypes: ["codex"] }).provider,
    ]

    expect(listLinkableGlobalProviders(project, globals).map((provider) => provider.name)).toEqual(["codex-ok"])
  })

  it("adds custom project providers with secret refs only", () => {
    const project = createCcConnectProjectDraft({
      id: "project-1",
      name: "synapse",
      workDir: "/repo/synapse",
      agentType: "codex",
    })
    const draft = createProviderDraft({
      name: "Project Relay",
      scope: "project",
      projectId: project.id,
      apiKey: "sk-project",
      baseUrl: "https://relay.example.com",
      model: "gpt-5.3-codex",
    })
    const nextProject = addInlineProviderToProject(project, draft.provider)

    expect(nextProject.providers?.[0]).toMatchObject({
      name: "project-relay",
      scope: "project",
      projectId: "project-1",
      secretRef: "provider:project-project-1:project-relay:api-key",
    })
    expect(JSON.stringify(nextProject.providers)).not.toContain("sk-project")
    expect(() => addInlineProviderToProject(nextProject, draft.provider)).toThrow("already exists")
  })

  it("resolves session providers with inline override before global refs", () => {
    const global = createProviderDraft({
      name: "shared",
      baseUrl: "https://global.example.com",
      agentTypes: ["codex"],
    }).provider
    const inline = createProviderDraft({
      name: "shared",
      scope: "project",
      projectId: "project-1",
      baseUrl: "https://inline.example.com",
      agentTypes: ["codex"],
    }).provider
    const project = {
      id: "project-1",
      name: "synapse",
      path: "/repo/synapse",
      agentType: "codex",
      providerRefs: ["shared"],
      providers: [inline],
    }

    const resolved = resolveProjectProvidersForSession(project, [global])

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.baseUrl).toBe("https://inline.example.com")
  })

  it("removes custom providers and clears active provider", () => {
    const provider = createProviderDraft({
      name: "relay",
      scope: "project",
      projectId: "project-1",
    }).provider
    const project = {
      id: "project-1",
      name: "synapse",
      path: "/repo/synapse",
      providers: [provider],
      activeProvider: "relay",
    }

    const nextProject = removeProviderFromProject(project, "relay")

    expect(nextProject.providers).toEqual([])
    expect(nextProject.activeProvider).toBeNull()
  })

  it("stores manual token platforms through secret refs only", () => {
    const connection = createProjectPlatformConnectionFromConnector(
      {
        id: "connector:telegram:synapse",
        schemaVersion: 1,
        type: "telegram",
        name: "synapse-telegram",
        enabled: true,
        status: "configured",
        options: {
          allow_from: "u1",
          group_reply_all: true,
          share_session_in_channel: true,
        },
        secretRefs: {
          token: "connector:telegram:synapse:token",
        },
        capabilities: ["text.in"],
        allowFrom: "u1",
      },
      "2026-04-26T00:00:00.000Z",
    )

    expect(connection).toMatchObject({
      id: "connector:telegram:synapse",
      type: "telegram",
      name: "synapse-telegram",
      status: "configured",
      enabled: true,
      allowFrom: "u1",
      groupReplyAll: true,
      shareSessionInChannel: true,
      secretRefs: {
        token: "connector:telegram:synapse:token",
      },
    })
    expect(JSON.stringify(connection)).not.toContain("plain-token")
  })

  it("stores QR platform completion through configured secret refs", () => {
    const connection = createProjectPlatformConnectionFromConnector(
      {
        id: "connector:weixin:synapse",
        schemaVersion: 1,
        type: "weixin",
        name: "synapse-weixin",
        enabled: true,
        status: "configured",
        options: {
          base_url: "https://ilink.example.test",
          account_id: "bot-id",
        },
        secretRefs: {
          token: "connector:weixin:synapse:token",
        },
        capabilities: ["text.in"],
      },
      "2026-04-26T00:00:00.000Z",
    )

    expect(connection).toMatchObject({
      id: "connector:weixin:synapse",
      type: "weixin",
      name: "synapse-weixin",
      status: "configured",
      enabled: true,
      options: {
        base_url: "https://ilink.example.test",
        account_id: "bot-id",
      },
      secretRefs: {
        token: "connector:weixin:synapse:token",
      },
    })
  })

  it("keeps saved platform connections through config persistence", () => {
    const project = createCcConnectProjectDraft({
      id: "project-1",
      name: "synapse",
      workDir: "/repo/synapse",
      agentType: "codex",
    })
    const manualConnection = createProjectPlatformConnectionFromConnector(
      {
        id: "connector:telegram:synapse",
        schemaVersion: 1,
        type: "telegram",
        name: "synapse-telegram",
        enabled: true,
        status: "configured",
        options: {
          allow_from: "u1",
          group_reply_all: true,
          share_session_in_channel: true,
        },
        secretRefs: {
          token: "connector:telegram:synapse:token",
        },
        capabilities: ["text.in"],
        allowFrom: "u1",
      },
      "2026-04-26T00:00:00.000Z",
    )
    const qrConnection = createProjectPlatformConnectionFromConnector(
      {
        id: "connector:feishu:synapse",
        schemaVersion: 1,
        type: "feishu",
        name: "synapse-feishu",
        enabled: true,
        status: "configured",
        options: {
          app_id: "cli_123",
        },
        secretRefs: {
          app_secret: "connector:feishu:synapse:app-secret",
        },
        capabilities: ["text.in"],
      },
      "2026-04-26T00:01:00.000Z",
    )

    const config = applySynapseConfigPatch(createDefaultConfig(), {
      global: {
        projects: [{
          ...project,
          permissionMode: "acceptEdits",
          language: "zh",
          adminFrom: "u1",
          disabledCommands: ["restart"],
          platformConnections: [manualConnection, qrConnection],
        }],
      },
    })

    expect(config.global.projects[0]).toMatchObject({
      agentType: "codex",
      permissionMode: "acceptEdits",
      language: "zh",
      adminFrom: "u1",
      disabledCommands: ["restart"],
      platformConnections: [
        {
          id: "connector:telegram:synapse",
          type: "telegram",
          status: "configured",
          enabled: true,
          secretRefs: {
            token: "connector:telegram:synapse:token",
          },
        },
        {
          id: "connector:feishu:synapse",
          type: "feishu",
          status: "configured",
          enabled: true,
        },
      ],
    })
    expect(JSON.stringify(config.global.projects[0]?.platformConnections)).not.toContain("plain-token")
    expect(summarizeCcConnectProjects(config.global.projects)[0]?.platformCount).toBe(2)
  })
})
