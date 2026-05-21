import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}))

import { readRepositorySeedContents } from "../repository-template-service"

describe("RepositoryTemplateService", () => {
  it("keeps Synapse MCP skill template icons consistent", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseMcpSkills = seeds
      .filter((seed) => seed.type === "skill" && /^synapse-.*-mcp$/.test(seed.id))
      .sort((left, right) => left.id.localeCompare(right.id))

    expect(synapseMcpSkills.map((seed) => ({
      icon: seed.icon,
      iconBg: seed.iconBg,
      id: seed.id,
    }))).toEqual([
      { id: "synapse-content-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-database-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-scheduler-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-workflow-mcp", icon: "terminal", iconBg: "teal" },
    ])
  })
})
