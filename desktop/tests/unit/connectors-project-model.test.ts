import { describe, expect, it } from "vitest"
import {
  createCcConnectProjectDraft,
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
})
