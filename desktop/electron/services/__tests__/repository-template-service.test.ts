import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}))

import { readRepositorySeedContents } from "../repository-template-service"
import { buildDriveTools } from "../../../synapse-capabilities/shared/drive-domain"

type RepositorySeed = Awaited<ReturnType<typeof readRepositorySeedContents>>[number]

function readAttachmentText(
  seed: RepositorySeed | undefined,
  originalName: string,
): string {
  const attachment = seed?.attachments
    ?.find((candidate) => candidate.originalName === originalName)

  return attachment ? Buffer.from(attachment.bytes).toString("utf8") : ""
}

describe("RepositoryTemplateService", () => {
  it("ships one consolidated Synapse Skill template", async () => {
    const seeds = await readRepositorySeedContents()
    const skillIds = seeds
      .filter((seed) => seed.type === "skill")
      .map((seed) => seed.id)
      .sort((left, right) => left.localeCompare(right))
    const skillNames = seeds
      .filter((seed) => seed.type === "skill")
      .map((seed) => seed.name)
      .filter((name): name is string => Boolean(name))
      .sort((left, right) => left.localeCompare(right))

    expect(skillIds).toContain("synapse-skill")
    expect(skillIds).toContain("test-skill")
    expect(skillNames).toContain("synapse-test-skill")
    expect(skillIds).toContain("bark-notification")
    expect(skillIds).not.toContain("synapse-automation-mcp")
    expect(skillIds).not.toContain("synapse-content-mcp")
    expect(skillIds).not.toContain("synapse-database-mcp")
    expect(skillIds).not.toContain("synapse-drive-mcp")
    expect(skillIds).not.toContain("synapse-model-price-mcp")
    expect(skillIds).not.toContain("synapse-repository-mcp")
    expect(skillIds).not.toContain("synapse-variable-mcp")
    expect(skillIds).not.toContain("synapse-workflow-mcp")
  })

  it("keeps the consolidated Synapse Skill metadata stable", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")

    expect(synapseSkill).toMatchObject({
      id: "synapse-skill",
      name: "synapse-skill",
      title: "Synapse Skill",
      category: "automation",
      icon: "workflow",
      iconBg: "teal",
    })
    expect(synapseSkill?.description).toContain("Database")
    expect(synapseSkill?.description).toContain("Drive")
    expect(synapseSkill?.description).toContain("Workflow")
    expect(synapseSkill?.content).toContain("database/index.md")
    expect(synapseSkill?.content).toContain("workflow/index.md")
  })

  it("ships every Synapse Skill domain folder attachment", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const attachmentNames = synapseSkill?.attachments
      ?.map((attachment) => attachment.originalName)
      .sort((left, right) => left.localeCompare(right))

    expect(attachmentNames).toEqual([
      "app/api-reference.md",
      "app/index.md",
      "automation/api-reference.md",
      "automation/index.md",
      "content/api-reference.md",
      "content/index.md",
      "database/api-reference.md",
      "database/index.md",
      "drive/api-reference.md",
      "drive/index.md",
      "model-price/api-reference.md",
      "model-price/index.md",
      "repository/api-reference.md",
      "repository/index.md",
      "variable/api-reference.md",
      "variable/index.md",
      "workflow/api-reference.md",
      "workflow/index.md",
    ])
  })

  it("documents Drive share access settings in the consolidated Synapse Skill", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const driveIndex = readAttachmentText(synapseSkill, "drive/index.md")

    expect(driveIndex).not.toContain("不处理密码分享")
    expect(driveIndex).toContain("passwordEnabled")
    expect(driveIndex).toContain("expiresIn")
  })

  it("documents every Drive MCP tool in the consolidated API reference", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const apiText = readAttachmentText(synapseSkill, "drive/api-reference.md")

    const missingTools = buildDriveTools()
      .map((tool) => tool.name)
      .filter((toolName) => toolName.startsWith("app_drive_"))
      .filter((toolName) => !apiText.includes(`\`${toolName}\``))

    expect(missingTools).toEqual([])
  })

  it("documents Workflow executors in the consolidated Automation domain", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const automationIndex = readAttachmentText(synapseSkill, "automation/index.md")
    const apiText = readAttachmentText(synapseSkill, "automation/api-reference.md")

    expect(automationIndex).toContain("builtin.workflow")
    expect(automationIndex).toContain("workflowId")
    expect(automationIndex).toContain("paramTemplates")
    expect(apiText).toContain("builtin.workflow")
    expect(apiText).toContain("paramTemplates")
  })

  it("does not force a POSIX shell in consolidated Automation examples", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const apiText = readAttachmentText(synapseSkill, "automation/api-reference.md")

    expect(apiText).toContain("automation_executor_type_list")
    expect(apiText).toContain("defaultConfig")
    expect(apiText).not.toContain("\"shell\": \"posix\"")
  })

  it("documents safe Model Price MCP rule operations in the consolidated skill", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const modelPriceIndex = readAttachmentText(synapseSkill, "model-price/index.md")
    const apiText = readAttachmentText(synapseSkill, "model-price/api-reference.md")

    expect(modelPriceIndex).toContain("model_price_used_model_list")
    expect(modelPriceIndex).toContain("ruleId")
    expect(modelPriceIndex).toContain("RMB per 1M tokens")
    expect(modelPriceIndex).toContain("Usage Analysis refresh")
    expect(modelPriceIndex).toContain("price-rule hash changes")
    expect(apiText).toContain("model_price_rule_update")
    expect(apiText).toContain("ruleId")
    expect(apiText).toContain("already indexed usage totals")
  })
})
