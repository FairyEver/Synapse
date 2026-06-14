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
      { id: "synapse-automation-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-content-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-database-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-drive-mcp", icon: "folder-tree", iconBg: "teal" },
      { id: "synapse-model-price-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-repository-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-scheduler-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-variable-mcp", icon: "terminal", iconBg: "teal" },
      { id: "synapse-workflow-mcp", icon: "terminal", iconBg: "teal" },
    ])
  })

  it("documents Drive share access settings in the built-in MCP skill", async () => {
    const seeds = await readRepositorySeedContents()
    const driveSkill = seeds.find((seed) => seed.id === "synapse-drive-mcp")

    expect(driveSkill?.usage).not.toContain("不处理密码分享")
    expect(driveSkill?.usage).toContain("设置分享密码和有效期")
    expect(driveSkill?.content).toContain("passwordEnabled")
    expect(driveSkill?.content).toContain("expiresIn")
  })

  it("documents Workflow executors in the built-in Automation MCP skill", async () => {
    const seeds = await readRepositorySeedContents()
    const automationSkill = seeds.find((seed) => seed.id === "synapse-automation-mcp")
    const apiReference = automationSkill?.attachments
      ?.find((attachment) => attachment.originalName === "api-reference.md")

    expect(automationSkill?.content).toContain("builtin.workflow")
    expect(automationSkill?.content).toContain("workflowId")
    expect(automationSkill?.content).toContain("paramTemplates")
    expect(apiReference ? Buffer.from(apiReference.bytes).toString("utf8") : "").toContain("builtin.workflow")
    expect(apiReference ? Buffer.from(apiReference.bytes).toString("utf8") : "").toContain("paramTemplates")
  })

  it("documents Workflow actions in the built-in Scheduler MCP skill", async () => {
    const seeds = await readRepositorySeedContents()
    const schedulerSkill = seeds.find((seed) => seed.id === "synapse-scheduler-mcp")
    const apiReference = schedulerSkill?.attachments
      ?.find((attachment) => attachment.originalName === "api-reference.md")

    expect(schedulerSkill?.content).toContain("builtin.workflow")
    expect(schedulerSkill?.content).toContain("workflowId")
    expect(schedulerSkill?.content).toContain("paramTemplates")
    expect(apiReference ? Buffer.from(apiReference.bytes).toString("utf8") : "").toContain("builtin.workflow")
    expect(apiReference ? Buffer.from(apiReference.bytes).toString("utf8") : "").toContain("paramTemplates")
  })
})
