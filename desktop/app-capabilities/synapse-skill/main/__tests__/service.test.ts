import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SECRETS_MCP_TOOL_NAMES } from "../../../secrets/shared/capability"
import { SYNAPSE_SKILL_SOURCE_IDENTITY } from "../../shared/capability"
import { createSynapseSkillService } from "../service"
import { buildDriveTools } from "../../../../synapse-capabilities/shared/drive-domain"
import { buildAllMcpTools } from "../../../../synapse-capabilities/shared/registry"

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

  it("changes the package fingerprint when an attachment changes", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })
    const before = await service.prepareInstallSource()

    await writeFile(path.join(packageRoot, "database", "index.md"), "# Updated Database\n", "utf8")
    const after = await service.prepareInstallSource()

    expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint)
  })

  it("releases an idle prepared source", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })
    const source = await service.prepareInstallSource()

    await service.releaseInstallSource(source.preparedSourceId)

    expect(service.hasPreparedSource(source.preparedSourceId, source.sourceIdentity)).toBe(false)
    await expect(service.readPreparedSkill(source.preparedSourceId, source.sourceIdentity))
      .rejects.toThrow("安装源不可用")
  })

  it("expires idle prepared sources when the renderer does not release them", async () => {
    const packageRoot = await createPackageRoot()
    let now = 100
    const service = createSynapseSkillService({
      now: () => now,
      packageRoot,
      preparedSourceTtlMs: 500,
    })
    const source = await service.prepareInstallSource()

    now = 600

    expect(service.hasPreparedSource(source.preparedSourceId, source.sourceIdentity)).toBe(false)
  })

  it("does not expire a prepared source while it is installing", async () => {
    const packageRoot = await createPackageRoot()
    let now = 100
    const service = createSynapseSkillService({
      now: () => now,
      packageRoot,
      preparedSourceTtlMs: 500,
    })
    const source = await service.prepareInstallSource()
    await service.beginPreparedInstall(source.preparedSourceId, source.sourceIdentity)

    now = 600

    expect(service.hasPreparedSource(source.preparedSourceId, source.sourceIdentity)).toBe(true)
  })

  it("keeps a prepared source protected until every concurrent install ends", async () => {
    const packageRoot = await createPackageRoot()
    let now = 100
    const service = createSynapseSkillService({
      now: () => now,
      packageRoot,
      preparedSourceTtlMs: 500,
    })
    const source = await service.prepareInstallSource()
    await service.beginPreparedInstall(source.preparedSourceId, source.sourceIdentity)
    await service.beginPreparedInstall(source.preparedSourceId, source.sourceIdentity)
    await service.endPreparedInstall(source.preparedSourceId, source.sourceIdentity)

    now = 600

    expect(service.hasPreparedSource(source.preparedSourceId, source.sourceIdentity)).toBe(true)
  })

  it("evicts the least recently used idle source when the cache reaches its limit", async () => {
    const packageRoot = await createPackageRoot()
    const ids = ["first", "second", "third"]
    const service = createSynapseSkillService({
      createId: () => ids.shift()!,
      maxPreparedSources: 2,
      packageRoot,
    })
    const first = await service.prepareInstallSource()
    const second = await service.prepareInstallSource()
    expect(service.hasPreparedSource(first.preparedSourceId, first.sourceIdentity)).toBe(true)

    const third = await service.prepareInstallSource()

    expect(service.hasPreparedSource(first.preparedSourceId, first.sourceIdentity)).toBe(true)
    expect(service.hasPreparedSource(second.preparedSourceId, second.sourceIdentity)).toBe(false)
    expect(service.hasPreparedSource(third.preparedSourceId, third.sourceIdentity)).toBe(true)
  })

  it("defers release across adjacent installs in a batch", async () => {
    vi.useFakeTimers()
    try {
      const packageRoot = await createPackageRoot()
      const service = createSynapseSkillService({ packageRoot })
      const source = await service.prepareInstallSource()

      await service.beginPreparedInstall(source.preparedSourceId, source.sourceIdentity)
      await service.releaseInstallSource(source.preparedSourceId)
      await service.endPreparedInstall(source.preparedSourceId, source.sourceIdentity)
      await service.beginPreparedInstall(source.preparedSourceId, source.sourceIdentity)
      await vi.runAllTimersAsync()
      expect(service.hasPreparedSource(source.preparedSourceId, source.sourceIdentity)).toBe(true)

      await service.endPreparedInstall(source.preparedSourceId, source.sourceIdentity)
      await vi.runAllTimersAsync()
      expect(service.hasPreparedSource(source.preparedSourceId, source.sourceIdentity)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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
      description: source.description,
    })
    expect(source.description.trim()).not.toBe("")
    expect(source.mainContent).toMatch(/^---\nname: synapse-skill\ndescription: .+\n---\n/)
    expect(detail.content).not.toContain("name: synapse-skill")
    expect(detail.content).toContain("database/index.md")
    expect(detail.content).toContain("workflow/index.md")
    expect(detail.content).toContain("static site publishing or republishing")
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
      "skill-authoring/index.md",
      "skill-repository/api-reference.md",
      "skill-repository/index.md",
      "terminal/api-reference.md",
      "terminal/examples.md",
      "terminal/index.md",
      "workflow/api-reference.md",
      "workflow/index.md",
    ])
  })

  it("documents local Skill authoring without taking over Synapse publishing", async () => {
    const [skillRoot, authoringGuide] = await Promise.all([
      readFile(path.join(systemPackageRoot, "SKILL.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "skill-authoring/index.md"), "utf8"),
    ])

    expect(skillRoot).toContain("开发 Skill")
    expect(skillRoot).toContain("修改现有 Skill")
    expect(skillRoot).toContain("`skill-authoring/index.md`")
    expect(skillRoot).toContain("not local Skill file authoring")
    expect(skillRoot).toContain("A request only to publish or manage an existing Skill in Synapse is a Content operation")
    expect(authoringGuide).toContain("Inspect and edit the actual files")
    expect(authoringGuide).toContain("Limit YAML frontmatter to `name` and `description`")
    expect(authoringGuide).toContain("Use progressive disclosure")
    expect(authoringGuide).toContain("[A-Za-z_][A-Za-z0-9_]*")
    expect(authoringGuide).toContain("Redacting logs afterward does not remove secrets")
    expect(authoringGuide).toContain("Do not let dry runs")
    expect(authoringGuide).toContain("Keep the Skill directory name and `name` unchanged")
    expect(authoringGuide).toContain("summarizes every actual file change")
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
    expect(driveIndex).toContain("final publishable artifact and the user's explicit intent")
    expect(driveIndex).toContain("A folder containing only one `index.html` file is a valid site source")
    expect(driveIndex).toContain("Merely naming a Drive destination folder")
    expect(driveIndex).toContain("`app_drive_file_upload`, then `app_drive_share_create`")
    expect(driveIndex).toContain("`app_drive_folder_upload`, then `app_drive_site_create`")
    expect(driveIndex).toContain("Do not call `app_drive_share_create` again for a normal update")
    expect(driveIndex).toContain("ask whether to republish the public site")
    expect(driveIndex).toContain("call `app_drive_site_republish` with the existing `siteId` without asking again")
    expect(driveIndex).toContain("Never call `app_drive_site_create` for an ordinary update")
    expect(driveIndex).toContain("may remain cached for up to five minutes")
    expect(driveApiText).toContain("Use a share by default for a standalone HTML file")
    expect(driveApiText).toContain("A folder containing only `index.html` is valid")
    expect(driveApiText).toContain("republishing preserves the public site URL")
    expect(missingDriveTools).toEqual([])
    expect(automationIndex).toContain("builtin.workflow")
    expect(automationIndex).toContain("workflowId")
    expect(automationIndex).toContain("paramTemplates")
    expect(automationApiText).toContain("app_automation_executor_type_list")
    expect(automationApiText).toContain("defaultConfig")
    expect(automationApiText).toContain("paramTemplates")
    expect(automationApiText).not.toContain("\"shell\": \"posix\"")
    expect(contentIndex).toContain("prefer `sourceDirectoryPath`")
    expect(contentIndex).toContain("claim a remote push only after its status is verified")
    expect(contentApiText).toContain("remote synchronization is still pending")
    expect(contentApiText).toContain("exact lowercase root filename `.env.example`")
    expect(contentApiText).toContain("case variants such as `.ENV.EXAMPLE`, are never read")
    expect(`${contentIndex}\n${contentApiText}`).not.toContain("High-confidence secrets")
    expect(skillRepositoryIndex).toContain(".synapse.repository.json")
    expect(skillRepositoryApiText).toContain("identityMigrated")
    expect(`${skillRepositoryIndex}\n${skillRepositoryApiText}`).not.toContain("high-confidence secrets")
    expect(modelPriceIndex).toContain("app_model_price_used_model_list")
    expect(modelPriceIndex).toContain("ruleId")
    expect(modelPriceIndex).toContain("RMB per 1M tokens")
    expect(modelPriceIndex).toContain("Usage Analysis refresh")
    expect(modelPriceIndex).toContain("price-rule hash changes")
    expect(modelPriceApiText).toContain("app_model_price_rule_update")
    expect(modelPriceApiText).toContain("ruleId")
    expect(modelPriceApiText).toContain("already indexed usage totals")
  })

  it("documents grouped upload destinations and local Markdown publishing", async () => {
    const [skillRoot, driveIndex, driveApiText] = await Promise.all([
      readFile(path.join(systemPackageRoot, "SKILL.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "drive/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "drive/api-reference.md"), "utf8"),
    ])

    expect(skillRoot).toContain("local Markdown document upload or sharing with linked images and HTML")
    expect(skillRoot).toContain("local Markdown document publishing with linked images or HTML")
    expect(driveIndex).toContain("## Upload Destination Selection")
    expect(driveIndex).toContain("For one local file with no requested destination")
    expect(driveIndex).toContain("use the local folder basename as the Drive folder name")
    expect(driveIndex).toContain("Use the primary Markdown basename without its extension")
    expect(driveIndex).toContain("use the common local parent folder basename")
    expect(driveIndex).toContain("recreate required subdirectories instead of flattening relative paths")
    expect(driveIndex).toContain("keep supported local image references unchanged")
    expect(driveIndex).toContain("## Local Markdown Publishing Flow")
    expect(driveIndex).toContain("Treat explicitly selected inputs and the Markdown's referenced local assets as one publishing transaction")
    expect(driveIndex).toContain("upload every supported referenced local image as an ordinary Drive file")
    expect(driveIndex).toContain("Do not create public assets")
    expect(driveIndex).toContain("use `app_drive_item_preview_get` to confirm each supported relative image has a non-null `resolvedUrl`")
    expect(driveIndex).toContain("A referenced HTML target must receive its own share or site URL")
    expect(driveIndex).toContain("do not share that HTML merely because it is next to the Markdown")
    expect(driveIndex).toContain("inserting `_final` before the source extension")
    expect(driveIndex).toContain("passing the original Markdown basename as `name`")
    expect(driveIndex).toContain("Do not create a folder share as a shortcut")
    expect(driveIndex).toContain("omit `passwordEnabled`, `expiresIn`, `accessMode`, and `editorEmails`")
    expect(driveIndex).toContain("Do not hardcode those defaults in this skill")
    expect(driveIndex).not.toContain("for a new share, omitting it uses `3d`")
    expect(driveApiText).toContain("use the current Synapse version's default for a new share")
    expect(driveApiText).not.toContain("New shares default to password required")
    expect(driveApiText).not.toContain("New shares default to `3d`")
    expect(driveIndex).toContain("Do not upload the Markdown when a required dependency upload")
    expect(driveApiText).toContain("`preview.relativeImages`")
    expect(driveApiText).toContain("without rewriting the Markdown or converting images to public assets")
  })

  it("documents persistent local Drive sync without confusing it with upload or site republish", async () => {
    const [skillRoot, driveIndex, driveApiText] = await Promise.all([
      readFile(path.join(systemPackageRoot, "SKILL.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "drive/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "drive/api-reference.md"), "utf8"),
    ])

    expect(skillRoot).toContain("persistent local file or folder sync")
    expect(skillRoot).toContain("备份、镜像、挂载、绑定到云盘、持续同步")
    expect(driveIndex).toContain("## One-Time Upload Versus Persistent Sync")
    expect(driveIndex).toContain("These tools never create a sync binding")
    expect(driveIndex).toContain("Never bind a temporary upload or Agent cache")
    expect(driveIndex).toContain("process each path independently and sequentially")
    expect(driveIndex).toContain("It is not a local filesystem sync request")
    expect(driveIndex).toContain("Never guess a conflict resolution")
    expect(driveIndex).toContain("只上传这一次，还是以后本地变化也持续同步")
    expect(driveIndex).toContain("Use `app_drive_item_tree_list` with pagination")
    expect(driveIndex).toContain("summarize `initialTransfer` before high-risk creation")
    expect(driveIndex).toContain("Act directly only on one unambiguous match")
    expect(driveIndex).toContain("apply the existing single-item tools sequentially")
    expect(driveIndex).toContain("There is no in-place MCP operation")
    expect(driveIndex).toContain("`confirm_delete` propagates the deletion")
    expect(driveApiText).toContain("Always call this before creation")
    expect(driveApiText).toContain("same-name Drive content is never overwritten or merged")
    expect(driveApiText).toContain("Stops and removes the binding without deleting local or Drive content")
    expect(driveApiText).toContain("must be an explicit user choice")
    expect(driveApiText).toContain("`totalEntries`, `fileCount`, `folderCount`")
    expect(driveApiText).toContain("only the first 200 records")
  })

  it("routes current domains through installed Synapse Skill paths", async () => {
    const [
      skillRoot,
      automationIndex,
      contentIndex,
      databaseIndex,
      terminalIndex,
      terminalExamples,
      workflowIndex,
    ] = await Promise.all([
      readFile(path.join(systemPackageRoot, "SKILL.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "automation/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "content/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "database/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "terminal/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "terminal/examples.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "workflow/index.md"), "utf8"),
    ])
    const domainGuides = [automationIndex, contentIndex, databaseIndex, terminalIndex, workflowIndex].join("\n")

    expect(skillRoot).toContain("Terminal")
    expect(skillRoot).toContain("Sound Notifier")
    expect(skillRoot).toContain("Terminal sessions")
    expect(domainGuides).not.toContain("synapse-skill/content.md")
    expect(domainGuides).not.toContain("files/<domain>/index.md")
    expect(domainGuides).toContain("`SKILL.md`")
    expect(domainGuides).toContain("`<domain>/index.md`")
    expect(databaseIndex).toContain("retired `database_*` names are not compatibility aliases")
    expect(terminalIndex).toContain("On `permission_denied`")
    expect(terminalIndex).toContain("development server or other long-running process")
    expect(terminalIndex).toContain("Use the fewest calls that provide new evidence")
    expect(terminalIndex).toContain("do not immediately read its state or screen")
    expect(terminalIndex).toContain("make at most two consecutive observe calls")
    expect(terminalIndex).toContain("Do not add ceremonial final reads")
    expect(terminalIndex).toContain("For Claude Code, use Escape at most once")
    expect(terminalIndex).toContain("Do not summarize away repeated control actions")
    expect(terminalIndex).toContain("Do not run helper code, invoke another tool")
    expect(terminalIndex).toContain("Build the final action sequence from the completed tool trace")
    expect(terminalIndex).toContain("Do not send `pwd`, `echo`, `printf`, or another probe command")
    expect(terminalIndex).toContain("there is no per-client running-session cap")
    expect(terminalIndex).toContain("Treat lease freshness as unknown after an observe-and-reasoning boundary")
    expect(terminalIndex).toContain("keep a lease-critical chain inside that call")
    expect(terminalIndex).toContain("make at most one bounded read-only recovery probe")
    expect(terminalIndex).toContain("prompt cleared")
    expect(terminalIndex).toContain("send exactly one Enter key")
    expect(terminalIndex).toContain("Do not resend the instruction text")
    expect(terminalExamples).toContain("app_terminal_session_input_command")
    expect(terminalExamples).toContain("do not replay the instruction")
    expect(terminalExamples).toContain("prompt has cleared")
    expect(terminalExamples).toContain("send exactly one Enter key")
    expect(terminalExamples).toContain("do not resend the instruction text")
    expect(terminalExamples).toContain("Exit an interactive program but keep the terminal")
    expect(terminalExamples).toContain("normal exit from its input prompt uses `/exit`")
    expect(terminalExamples).toContain("Do not send additional Ctrl+D at the shell prompt")
    expect(terminalExamples).toContain("Do not send any input after a failed acquire or renew")
    expect(terminalExamples).toContain("do not run helper code merely to generate the key")
    expect(terminalExamples).toContain("Running sessions have no per-client count cap")
  })

  it("documents every canonical MCP tool in the installed package", async () => {
    const service = createSynapseSkillService({ packageRoot: systemPackageRoot })
    const source = await service.prepareInstallSource()
    const detail = await service.readPreparedSkill(source.preparedSourceId, source.sourceIdentity)
    const packageText = (await Promise.all([
      readFile(path.join(systemPackageRoot, "SKILL.md"), "utf8"),
      ...detail.attachments
        .filter((attachment) => attachment.originalName.endsWith(".md"))
        .map((attachment) => readFile(path.join(systemPackageRoot, attachment.originalName), "utf8")),
    ])).join("\n")
    const missingTools = buildAllMcpTools()
      .map((tool) => tool.name)
      .filter((toolName) => toolName.startsWith("app_"))
      .filter((toolName) => !packageText.includes(toolName))

    expect(missingTools).toEqual([])
  })

  it("documents current Workflow and Resource Repository contracts", async () => {
    const [workflowIndex, workflowApiText, contentIndex, contentApiText] = await Promise.all([
      readFile(path.join(systemPackageRoot, "workflow/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "workflow/api-reference.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "content/index.md"), "utf8"),
      readFile(path.join(systemPackageRoot, "content/api-reference.md"), "utf8"),
    ])
    const workflowDocs = `${workflowIndex}\n${workflowApiText}`
    const contentDocs = `${contentIndex}\n${contentApiText}`

    expect(workflowDocs).toContain("document_template_docx_generate")
    expect(workflowIndex).toContain("`completed`, `failed`, or `cancelled`")
    expect(contentDocs).toContain("`usage`")

    const canonicalTools = buildAllMcpTools()
    for (const toolName of [
      "app_resource_repository_rule_create",
      "app_resource_repository_skill_create",
      "app_resource_repository_prompt_create",
    ]) {
      expect(canonicalTools.find((tool) => tool.name === toolName)?.inputSchema.properties)
        .toHaveProperty("usage")
    }
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
