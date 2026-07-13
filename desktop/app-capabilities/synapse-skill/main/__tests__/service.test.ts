import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SECRETS_MCP_TOOL_NAMES } from "../../../secrets/shared/capability"
import { SYNAPSE_SKILL_SOURCE_IDENTITY } from "../../shared/capability"
import { createSynapseSkillService } from "../service"
import { buildDriveTools } from "../../../../synapse-capabilities/shared/drive-domain"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}))

const roots: string[] = []
const systemPackageRoot = path.join(process.cwd(), "app-capabilities", "synapse-skill", "skill-package")

async function createPackageRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-package-"))
  roots.push(root)
  await mkdir(path.join(root, "database"), { recursive: true })
  await writeFile(
    path.join(root, "SKILL.md"),
    "---\nname: synapse-skill\ndescription: Test\n---\n# Synapse Skill\n",
    "utf8",
  )
  await writeFile(path.join(root, "database", "index.md"), "# Database\n", "utf8")
  await writeFile(path.join(root, ".env.example"), "TOKEN=default\n", "utf8")
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("SynapseSkillService", () => {
  it("prepares a stable system installer source", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })

    const source = await service.prepareInstallSource()

    expect(source).toMatchObject({
      kind: "skill",
      origin: "prepared",
      sourceIdentity: SYNAPSE_SKILL_SOURCE_IDENTITY,
      name: "synapse-skill",
      title: "Synapse Skill",
    })
    expect(source.preparedSourceId).toMatch(/^synapse-skill:/)
    expect(source.mainContent).toContain("# Synapse Skill")
    expect(source.sourceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it("reads prepared skill detail with nested attachments", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })
    const source = await service.prepareInstallSource()

    const detail = await service.readPreparedSkill(source.preparedSourceId, source.sourceIdentity)

    expect(detail.id).toBe("synapse-skill")
    expect(detail.name).toBe("synapse-skill")
    expect(detail.content).toBe("# Synapse Skill")
    expect((detail as typeof detail & { sourceFingerprint?: string }).sourceFingerprint)
      .toBe(source.sourceFingerprint)
    expect(detail.attachments.map((item) => item.originalName)).toContain("database/index.md")
  })

  it("copies prepared skill attachments", async () => {
    const packageRoot = await createPackageRoot()
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-output-"))
    roots.push(outputRoot)
    const service = createSynapseSkillService({ packageRoot })
    const source = await service.prepareInstallSource()
    const targetPath = path.join(outputRoot, "database", "index.md")

    await service.copyPreparedSkillAttachment(
      source.preparedSourceId,
      source.sourceIdentity,
      "database/index.md",
      targetPath,
    )

    await expect(readFile(targetPath, "utf8")).resolves.toBe("# Database\n")
  })

  it("reads prepared text attachments with null semantics", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })
    const source = await service.prepareInstallSource()

    await expect(service.readPreparedSkillAttachmentText(
      source.preparedSourceId,
      source.sourceIdentity,
      ".env.example",
    )).resolves.toBe("TOKEN=default\n")
    await expect(service.readPreparedSkillAttachmentText(
      source.preparedSourceId,
      source.sourceIdentity,
      "../.env.example",
    )).resolves.toBeNull()
  })

  it("ships the current system Synapse Skill package", async () => {
    const service = createSynapseSkillService({ packageRoot: systemPackageRoot })
    const source = await service.prepareInstallSource()
    const detail = await service.readPreparedSkill(source.preparedSourceId, source.sourceIdentity)
    const attachmentNames = detail.attachments
      .map((attachment) => attachment.originalName)
      .sort((left, right) => left.localeCompare(right))

    expect(detail).toMatchObject({
      id: "synapse-skill",
      name: "synapse-skill",
      title: "Synapse Skill",
      category: "system",
    })
    expect(detail.content).toContain("database/index.md")
    expect(detail.content).toContain("workflow/index.md")
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
      "secrets/api-reference.md",
      "secrets/index.md",
      "skill-repository/api-reference.md",
      "skill-repository/index.md",
      "workflow/api-reference.md",
      "workflow/index.md",
    ])
  })

  it("keeps system Synapse Skill domain guidance aligned with MCP tools", async () => {
    const readPackageText = (name: string) => readFile(path.join(systemPackageRoot, name), "utf8")
    const [
      driveIndex,
      driveApiText,
      automationIndex,
      automationApiText,
      contentIndex,
      contentApiText,
      modelPriceIndex,
      modelPriceApiText,
      skillRepositoryIndex,
      skillRepositoryApiText,
    ] = await Promise.all([
      readPackageText("drive/index.md"),
      readPackageText("drive/api-reference.md"),
      readPackageText("automation/index.md"),
      readPackageText("automation/api-reference.md"),
      readPackageText("content/index.md"),
      readPackageText("content/api-reference.md"),
      readPackageText("model-price/index.md"),
      readPackageText("model-price/api-reference.md"),
      readPackageText("skill-repository/index.md"),
      readPackageText("skill-repository/api-reference.md"),
    ])
    const missingDriveTools = buildDriveTools()
      .map((tool) => tool.name)
      .filter((toolName) => toolName.startsWith("app_drive_"))
      .filter((toolName) => !driveApiText.includes(`\`${toolName}\``))

    expect(driveIndex).not.toContain("不处理密码分享")
    expect(driveIndex).toContain("passwordEnabled")
    expect(driveIndex).toContain("expiresIn")
    expect(missingDriveTools).toEqual([])
    expect(automationIndex).toContain("builtin.workflow")
    expect(automationIndex).toContain("workflowId")
    expect(automationIndex).toContain("paramTemplates")
    expect(automationApiText).toContain("automation_executor_type_list")
    expect(automationApiText).toContain("defaultConfig")
    expect(automationApiText).toContain("paramTemplates")
    expect(automationApiText).not.toContain("\"shell\": \"posix\"")
    expect(contentIndex).toContain("prefer `sourceDirectoryPath`")
    expect(contentIndex).toContain("claim a remote push only after its status is verified")
    expect(contentApiText).toContain("remote synchronization is still pending")
    expect(contentApiText).toContain("excluded runtime env files are never read")
    expect(skillRepositoryIndex).toContain(".synapse.repository.json")
    expect(skillRepositoryApiText).toContain("identityMigrated")
    expect(modelPriceIndex).toContain("model_price_used_model_list")
    expect(modelPriceIndex).toContain("ruleId")
    expect(modelPriceIndex).toContain("RMB per 1M tokens")
    expect(modelPriceIndex).toContain("Usage Analysis refresh")
    expect(modelPriceIndex).toContain("price-rule hash changes")
    expect(modelPriceApiText).toContain("model_price_rule_update")
    expect(modelPriceApiText).toContain("ruleId")
    expect(modelPriceApiText).toContain("already indexed usage totals")
  })

  it("documents the immutable secret name and desktop-only Skill ENV update boundary", async () => {
    const [secretsIndex, secretsApiReference] = await Promise.all([
      readFile(path.join(systemPackageRoot, "secrets/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "secrets/api-reference.md"), "utf8"),
    ])
    const secretsDocs = `${secretsIndex}\n${secretsApiReference}`
    const documentedTools = [...secretsApiReference.matchAll(/^### (app_secrets_[a-z_]+)$/gm)]
      .map((match) => match[1])
      .sort()
    const registeredTools = [...Object.values(SECRETS_MCP_TOOL_NAMES)].sort()

    expect(documentedTools).toEqual(registeredTools)
    expect(secretsIndex).toContain("Names are immutable after creation.")
    expect(secretsIndex).toContain("never scan or write installed Skill files")
    expect(secretsIndex).toContain("in-memory serial queue")
    expect(secretsApiReference).toContain("Names are immutable after creation.")
    expect(secretsApiReference).toContain("not MCP actions or tools")
    expect(secretsApiReference).toContain("never scan or write installed Skill files")
    expect(secretsIndex).toContain("1 MiB")
    expect(secretsIndex).toContain("Windows")
    expect(secretsApiReference).toContain("1 MiB")
    expect(secretsApiReference).toContain("Windows")
    expect(secretsDocs).not.toMatch(/existing secrets or renames|supports renames/i)
    expect(secretsDocs).not.toMatch(/\bapp_secrets_[a-z0-9_]*(?:scan|queue)[a-z0-9_]*\b/i)
    expect(secretsDocs).not.toMatch(/\bapp\.secrets\.[a-z0-9_.]*(?:scan|queue)[a-z0-9_.]*\b/i)
    expect(secretsDocs).not.toContain("newName")
  })
})
