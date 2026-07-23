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

function allCapabilityIds(): CapabilityId[] {
  return CAPABILITY_DOMAINS.flatMap((domain) => domain.capabilities.map((capability) => capability.id)).sort()
}

function conventionalPrimaryCapabilityIds(): CapabilityId[] {
  return CAPABILITY_DOMAINS
    .filter((domain) => domain.id !== "skill_repository")
    .flatMap((domain) => domain.capabilities.map((capability) => capability.id))
    .sort()
}

function retiredMcpToolNamePairs(): Array<readonly [retiredName: string, currentName: string]> {
  return buildAllMcpTools().flatMap(({ name }) => {
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
  it("keeps every registered capability exposed with only canonical MCP tool names", () => {
    const actionIds = allCapabilityIds()
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
    expect(toolNames).toHaveLength(203)
    expect(toolNames.every((toolName) => toolName.startsWith("app_"))).toBe(true)
    expect(toolNames.filter((toolName) => retiredToolNames.has(toolName))).toEqual([])
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
    expect(documentedPairs).toHaveLength(139)
  })

  it("routes every registered API action to its owning domain dispatcher", async () => {
    const dispatchers = {
      app: vi.fn(async () => ({ ok: true as const })),
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
    const packageJson = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> }
    const docsMatrix = readRepoFile("../docs/reference/capability-naming-matrix.md")
    const websiteMatrix = readRepoFile("../website/developer/capability-naming-matrix.md")
    const websiteCapabilities = readRepoFile("../website/reference/synapse-mcp-capabilities.md")

    expect(existsSync(new URL("database/cli", repoRoot))).toBe(false)
    expect(existsSync(new URL("electron/database/cli-installer.ts", repoRoot))).toBe(false)
    expect(`${docsMatrix}\n${websiteMatrix}\n${websiteCapabilities}`).not.toMatch(/\bCLI command\b|CLI 命令|synapse database|synapse scheduler|synapse content/u)
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
