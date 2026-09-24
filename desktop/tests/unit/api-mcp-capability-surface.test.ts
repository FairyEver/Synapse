import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import { createSynapseActionRouter } from "../../electron/capabilities/action-router"
import {
  CAPABILITY_DOMAINS,
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
} from "../../synapse-capabilities/shared/registry"
import { capabilityIdToMcpTool, type CapabilityId } from "../../synapse-capabilities/shared/naming"
import { APP_DOMAIN, buildAppTools } from "../../synapse-capabilities/shared/app-domain"
import { buildSynapseToolRouterTools } from "../../electron/services/agent-runtime/synapse-tool-router"
import {
  JAVASCRIPT_RUN_CAPABILITY_ID,
  NODEJS_RUN_CAPABILITY_ID,
} from "../../app-capabilities/script-runtime/shared/capability"
import {
  CLIPBOARD_TEXT_READ_CAPABILITY_ID,
  CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
} from "../../app-capabilities/clipboard/shared/capability"

const repoRoot = new URL("../../", import.meta.url)
const RETIRED_MCP_PREFIXES = [
  ["app_database_", "database_"],
  ["app_model_price_", "model_price_"],
  ["app_settings_repository_", "repository_"],
  ["app_automation_", "automation_"],
  ["app_workflow_", "workflow_"],
  ["app_resource_repository_", "content_"],
  ["app_drive_", "drive_"],
] as const
const CURRENT_ONLY_MCP_TOOL_NAMES = new Set([
  "app_drive_sync_snapshot_get",
  "app_drive_sync_binding_preview",
  "app_drive_sync_binding_create",
  "app_drive_sync_binding_pause",
  "app_drive_sync_binding_resume",
  "app_drive_sync_binding_remove",
  "app_drive_sync_binding_exclude_rules_update",
  "app_drive_sync_binding_rescan",
  "app_drive_sync_conflict_resolve",
])

function allCapabilityIds(): CapabilityId[] {
  return CAPABILITY_DOMAINS.flatMap((domain) => domain.capabilities.map((capability) => capability.id)).sort()
}

const NON_MCP_CAPABILITY_IDS = new Set<CapabilityId>([
  JAVASCRIPT_RUN_CAPABILITY_ID,
  NODEJS_RUN_CAPABILITY_ID,
  CLIPBOARD_TEXT_READ_CAPABILITY_ID,
  CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
])

function mcpCapabilityIds(): CapabilityId[] {
  return allCapabilityIds().filter((capabilityId) => !NON_MCP_CAPABILITY_IDS.has(capabilityId))
}

function conventionalPrimaryCapabilityIds(): CapabilityId[] {
  return CAPABILITY_DOMAINS
    .filter((domain) => domain.id !== "skill_repository")
    .flatMap((domain) => domain.capabilities.map((capability) => capability.id))
    .filter((capabilityId) => !NON_MCP_CAPABILITY_IDS.has(capabilityId))
    .sort()
}

function retiredMcpToolNamePairs(): Array<readonly [retiredName: string, currentName: string]> {
  return buildAllMcpTools().flatMap(({ name }) => {
    if (CURRENT_ONLY_MCP_TOOL_NAMES.has(name)) return []
    const prefixes = RETIRED_MCP_PREFIXES.find(([primaryPrefix]) => name.startsWith(primaryPrefix))
    return prefixes ? [[name.replace(prefixes[0], prefixes[1]), name] as const] : []
  })
}

function retiredMcpToolNames(): string[] {
  return retiredMcpToolNamePairs().map(([retiredName]) => retiredName)
}

function readRepoFile(path: string): string {
  return readFileSync(new URL(path, repoRoot), "utf-8")
}

function readMarkdownFiles(root: URL, prefix = ""): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = []
  for (const entry of readdirSync(root)) {
    const entryUrl = new URL(`${entry}${statSync(new URL(entry, root)).isDirectory() ? "/" : ""}`, root)
    const relativePath = prefix ? `${prefix}/${entry}` : entry
    if (statSync(entryUrl).isDirectory()) {
      files.push(...readMarkdownFiles(entryUrl, relativePath))
      continue
    }
    if (entry.endsWith(".md")) {
      files.push({ path: relativePath, content: readFileSync(entryUrl, "utf-8") })
    }
  }
  return files
}

describe("API and MCP capability surface", () => {
  it("keeps explicitly exposed capabilities mapped to only canonical MCP tool names", () => {
    const actionIds = mcpCapabilityIds()
    const toolNames = buildAllMcpTools().map((tool) => tool.name).sort()
    const mappedToolNames = Object.keys(MCP_TOOL_ACTIONS).sort()
    const mappedActionIds = [...new Set(Object.values(MCP_TOOL_ACTIONS))].sort()
    const expectedToolNames = conventionalPrimaryCapabilityIds()
      .map((action) => capabilityIdToMcpTool(action))
      .sort()
    const retiredToolNames = new Set(retiredMcpToolNames())

    expect(toolNames).toEqual(mappedToolNames)
    expect(toolNames).toEqual(expect.arrayContaining(expectedToolNames))
    expect(mappedActionIds).toEqual(actionIds)
    expect(allCapabilityIds()).toHaveLength(248)
    expect(APP_DOMAIN.capabilities).toHaveLength(83)
    expect(buildAppTools()).toHaveLength(79)
    expect(toolNames).toHaveLength(244)
    expect(toolNames.filter((toolName) => !toolName.startsWith("app_"))).toEqual(["extend_portal_headless_credential_get"])
    expect(toolNames.filter((toolName) => retiredToolNames.has(toolName))).toEqual([])
  })

  it("publishes the two router tools while keeping the full capability catalog intact", () => {
    const published = buildSynapseToolRouterTools()

    expect(published.map((tool) => tool.name).sort()).toEqual(["invoke", "search"])
    expect(published.some((tool) => tool.name.startsWith("app_"))).toBe(false)
    // The catalog is still the backing index for search/invoke; only the eager
    // tools/list payload shrank. Re-adding it here turns this assertion red.
    expect(buildAllMcpTools()).toHaveLength(244)
    expect(Object.keys(MCP_TOOL_ACTIONS)).toHaveLength(244)
  })

  it("documents model price rule IDs as opaque rule IDs", () => {
    const tools = buildAllMcpTools()
    const updateTool = tools.find((tool) => tool.name === "app_model_price_rule_update")
    const listTool = tools.find((tool) => tool.name === "app_model_price_rule_list")
    const ruleIdProperty = updateTool?.inputSchema.properties.ruleId as { description?: string } | undefined

    const listDescription = listTool?.description.toLowerCase() ?? ""
    const ruleIdDescription = ruleIdProperty?.description?.toLowerCase() ?? ""

    expect(listDescription).toContain("opaque rule id")
    expect(ruleIdDescription).toContain("opaque model price rule id")
    expect(ruleIdDescription).toContain("not a model name")
    expect(ruleIdDescription).toContain("not modelpattern")
  })

  it("keeps the clean MCP name comparison synchronized with the registry", () => {
    const guide = readRepoFile("../docs/reference/mcp-tool-name-migration.md")
    const documentedPairs = [...guide.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|$/gm)]
      .map((match) => [match[1], match[2]] as const)

    expect(documentedPairs).toEqual(retiredMcpToolNamePairs())
    expect(documentedPairs).toHaveLength(146)
  })

  it("routes every registered capability to its owning domain dispatcher", async () => {
    const dispatchers = {
      app: vi.fn(async () => ({ ok: true as const })),
      extend: vi.fn(async () => ({ ok: true as const })),
      automation: vi.fn(async () => ({ ok: true as const })),
      content: vi.fn(async () => ({ ok: true as const })),
      database: vi.fn(async () => ({ ok: true as const })),
      drive: vi.fn(async () => ({ ok: true as const })),
      model_price: vi.fn(async () => ({ ok: true as const })),
      repository: vi.fn(async () => ({ ok: true as const })),
      skill_repository: vi.fn(async () => ({ ok: true as const })),
      workflow: vi.fn(async () => ({ ok: true as const })),
    }
    const router = createSynapseActionRouter({
      appDispatch: dispatchers.app,
      extendDispatch: dispatchers.extend,
      automationDispatch: dispatchers.automation,
      contentDispatch: dispatchers.content,
      databaseDispatch: dispatchers.database,
      driveDispatch: dispatchers.drive,
      modelPriceDispatch: dispatchers.model_price,
      repositoryDispatch: dispatchers.repository,
      skillRepositoryDispatch: dispatchers.skill_repository,
      workflowDispatch: dispatchers.workflow,
    })

    for (const action of allCapabilityIds()) {
      await expect(router.dispatch(action, {}, { source: "api" })).resolves.toEqual({ ok: true })
      const domain = getActionDomainId(action)
      expect(domain).not.toBeNull()
      expect(dispatchers[domain as keyof typeof dispatchers])
        .toHaveBeenLastCalledWith(action, {}, { source: "api" })
    }
  })

  it("does not ship or document the retired Synapse CLI surface", () => {
    const docsMatrix = readRepoFile("../docs/reference/capability-naming-matrix.md")

    expect(existsSync(new URL("database/cli", repoRoot))).toBe(false)
    expect(existsSync(new URL("electron/database/cli-installer.ts", repoRoot))).toBe(false)
    expect(docsMatrix).not.toMatch(/\bCLI command\b|CLI 命令|synapse database|synapse scheduler|synapse content/u)
  })

  it("does not ship the retired stdio MCP bridge", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts?: Record<string, string>
      build?: { extraResources?: Array<{ from?: string }> }
    }

    expect(existsSync(new URL("database/mcp/index.ts", repoRoot))).toBe(false)
    expect(existsSync(new URL("database/shared/resolve-user-data.ts", repoRoot))).toBe(false)
    expect(packageJson.scripts?.["build:database"]).toBeUndefined()
    expect(packageJson.build?.extraResources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "dist-database" }),
    ]))
  })

  it("uses only canonical app MCP tool names in the built-in Synapse skill docs", () => {
    const docs = readMarkdownFiles(
      new URL("app-capabilities/synapse-skill/skill-package/", repoRoot),
    )
    const docsText = docs.map((file) => file.content).join("\n")
    const documentedRetiredToolNames = retiredMcpToolNames()
      .filter((toolName) => docsText.includes(`\`${toolName}\``))

    expect(documentedRetiredToolNames).toEqual([])
  })

  it("teaches the two-tool surface in every skill domain doc", () => {
    const docs = readMarkdownFiles(
      new URL("app-capabilities/synapse-skill/skill-package/", repoRoot),
    )
    // skill-authoring/ covers local Skill file authoring and calls no Synapse
    // MCP tools, so it carries no reaching-Synapse guidance.
    const routingDocs = docs.filter((file) => (
      /(?:^|\/)(?:index|api-reference)\.md$/.test(file.path)
      && !file.path.startsWith("skill-authoring/")
    ))

    expect(routingDocs).toHaveLength(25)
    for (const doc of routingDocs) {
      expect(doc.content, doc.path).toContain("Reaching Synapse tools")
      expect(doc.content, doc.path).toContain("publishes only two tools")
    }
  })

  it("keeps the Drive Skill's large-file read and full-rebuild verification paths explicit", () => {
    const guide = readRepoFile("app-capabilities/synapse-skill/skill-package/drive/index.md")
    const reading = guide.split("## Reading A Saved Document\n", 2)[1]?.split("## Editing An Existing Document", 1)[0]
    const editing = guide.split("## Editing An Existing Document\n", 2)[1]?.split("## Default Flow", 1)[0]

    expect(reading).toContain("`app_drive_file_content_inspect` first")
    expect(reading).toContain("For a file over 64 KiB")
    expect(reading).toContain("`app_drive_file_version_download_create` with the inspected `versionId`")
    expect(reading).toContain("If the fixed-version download is unavailable or permission is denied")
    expect(editing).toContain("upload with that version as `expectedVersionId`")
    expect(editing).toContain("After upload, inspect again")
    expect(editing).toContain("compare its bytes or hash with the local result")
    expect(editing).toContain("A version list alone confirms a new version exists, not that its content matches")
  })

  it("documents the Agent conversation deep link without a shell or content-reading fallback", () => {
    const skill = readRepoFile("app-capabilities/synapse-skill/skill-package/SKILL.md")
    const appGuide = readRepoFile("app-capabilities/synapse-skill/skill-package/app/index.md")
    const appApi = readRepoFile("app-capabilities/synapse-skill/skill-package/app/api-reference.md")

    expect(skill).toContain("Synapse Agent conversation deep links")
    expect(appGuide).toContain("`app_agent_group_list`")
    expect(appGuide).toContain("`app_agent_conversation_create`")
    expect(appGuide).toContain("sameGroupAs")
    expect(appGuide).toContain("本地对话")
    expect(appApi).toContain("## `app_agent_conversation_create`")
    expect(appGuide).toContain("`app_agent_conversation_open`")
    expect(appGuide).toContain("synapse://threads/<thread-id>")
    expect(appGuide).toContain("former `synapse://app/agent/open` route")
    expect(appGuide).toContain("Do not fetch the link")
    expect(appGuide).toContain("Do not fetch the link, browse it, pass it to a shell command")
    expect(appApi).toContain("Output is exactly `{ opened: true }`")
    expect(appApi).toContain("No title, session key, message, transcript")
  })

  it("documents JSON Repair direct-call and Workflow boundaries with the implementation", () => {
    const skill = readRepoFile("app-capabilities/synapse-skill/skill-package/SKILL.md")
    const appGuide = readRepoFile("app-capabilities/synapse-skill/skill-package/app/index.md")
    const appApi = readRepoFile("app-capabilities/synapse-skill/skill-package/app/api-reference.md")
    const workflowGuide = readRepoFile("app-capabilities/synapse-skill/skill-package/workflow/index.md")
    const workflowApi = readRepoFile("app-capabilities/synapse-skill/skill-package/workflow/api-reference.md")

    expect(skill).toContain("JSON repair")
    expect(appGuide).toContain("`app_json_repair_text_repair`")
    expect(appGuide).toContain("only when the user explicitly needs JSON repair")
    expect(appGuide).toContain("Do not pre-clean")
    expect(appGuide).toContain("Do not parse and re-serialize")
    expect(appGuide).toContain("Do not retry automatically")
    expect(appGuide).toContain("do not restrict a Workflow author")
    expect(appApi).toContain("best-effort")
    expect(appApi).toContain("remains untrusted")
    expect(appApi).toContain("checked against a Schema")
    expect(workflowGuide).toContain("**json_repair_text_repair**")
    expect(workflowGuide).toContain("`app.json_repair.text.repair@1.0.0`")
    expect(workflowApi).toContain("### json_repair_text_repair")
  })

  it("marks historical superpowers docs before mentioning retired Synapse CLI entrypoints", () => {
    const superpowersDocs = [
      ...readMarkdownFiles(new URL("../docs/superpowers/specs/", repoRoot), "specs"),
      ...readMarkdownFiles(new URL("../docs/superpowers/plans/", repoRoot), "plans"),
    ].filter((file) => !file.path.includes("2026-05-25-api-mcp-cli-retirement-doc-cleanup"))
    const retiredSynapseCliPattern = /\bCLI command\b|CLI 命令|synapse database|synapse scheduler|synapse content/u
    const supersededNote = "Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired"

    const offenders = superpowersDocs
      .filter((file) => retiredSynapseCliPattern.test(file.content) && !file.content.includes(supersededNote))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })
})
