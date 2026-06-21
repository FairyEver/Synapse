import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}))

import { readRepositorySeedContents } from "../repository-template-service"
import { buildDriveTools } from "../../../synapse-capabilities/shared/drive-domain"

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

  it("documents every Drive MCP tool in the built-in API reference", async () => {
    const seeds = await readRepositorySeedContents()
    const driveSkill = seeds.find((seed) => seed.id === "synapse-drive-mcp")
    const apiReference = driveSkill?.attachments
      ?.find((attachment) => attachment.originalName === "api-reference.md")
    const apiText = apiReference ? Buffer.from(apiReference.bytes).toString("utf8") : ""

    const missingTools = buildDriveTools()
      .map((tool) => tool.name)
      .filter((toolName) => !apiText.includes(`\`${toolName}\``))

    expect(missingTools).toEqual([])
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

  it("does not force a POSIX shell in Automation MCP create examples", async () => {
    const seeds = await readRepositorySeedContents()
    const automationSkill = seeds.find((seed) => seed.id === "synapse-automation-mcp")
    const apiReference = automationSkill?.attachments
      ?.find((attachment) => attachment.originalName === "api-reference.md")
    const apiText = apiReference ? Buffer.from(apiReference.bytes).toString("utf8") : ""

    expect(apiText).toContain("automation_executor_type_list")
    expect(apiText).toContain("defaultConfig")
    expect(apiText).not.toContain('"shell": "posix"')
  })

  it("documents safe Model Price MCP rule operations in the built-in skill", async () => {
    const seeds = await readRepositorySeedContents()
    const modelPriceSkill = seeds.find((seed) => seed.id === "synapse-model-price-mcp")
    const apiReference = modelPriceSkill?.attachments
      ?.find((attachment) => attachment.originalName === "api-reference.md")
    const apiText = apiReference ? Buffer.from(apiReference.bytes).toString("utf8") : ""

    expect(modelPriceSkill?.content).toContain("model_price_used_model_list")
    expect(modelPriceSkill?.content).toContain("ruleId")
    expect(modelPriceSkill?.content).toContain("RMB per 1M tokens")
    expect(modelPriceSkill?.content).toContain("Usage Analysis refresh")
    expect(modelPriceSkill?.content).toContain("price-rule hash changes")
    expect(apiText).toContain("model_price_rule_update")
    expect(apiText).toContain("ruleId")
    expect(apiText).toContain("already indexed usage totals")
  })

})
