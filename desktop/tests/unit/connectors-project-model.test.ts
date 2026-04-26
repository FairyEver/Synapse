import { describe, expect, it } from "vitest"
import {
  createCcConnectProjectDraft,
  sanitizeCcProjectName,
  summarizeCcConnectProjects,
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
        platformConnections: [
          {
            id: "conn-1",
            type: "telegram",
            name: "Telegram",
            status: "configured",
            enabled: true,
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
        platformCount: 1,
        sessionCount: null,
      },
    ])
  })
})
