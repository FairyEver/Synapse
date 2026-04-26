import { describe, expect, it } from "vitest"
import {
  createCcConnectProjectDraft,
  createProjectPlatformConnectionFromConnector,
  createQrProjectPlatformDraft,
  parseDisabledCommands,
  sanitizeCcProjectName,
  summarizeCcConnectProjects,
  updateCcConnectProjectSettings,
} from "../../src/modules/connectors/project-model"

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

  it("creates disabled QR platform drafts without credentials", () => {
    const connection = createQrProjectPlatformDraft({
      id: "connector:weixin:qr-1",
      type: "weixin",
      now: "2026-04-26T00:00:00.000Z",
    })

    expect(connection).toMatchObject({
      id: "connector:weixin:qr-1",
      type: "weixin",
      name: "Weixin",
      status: "draft",
      enabled: false,
      options: {
        setup_mode: "qr",
      },
      secretRefs: {},
    })
  })
})
