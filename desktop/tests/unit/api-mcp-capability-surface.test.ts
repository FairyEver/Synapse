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

function allCapabilityIds(): CapabilityId[] {
  return CAPABILITY_DOMAINS.flatMap((domain) => domain.capabilities.map((capability) => capability.id)).sort()
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
  it("keeps every registered capability exposed as exactly one MCP tool", () => {
    const actionIds = allCapabilityIds()
    const toolNames = buildAllMcpTools().map((tool) => tool.name).sort()
    const mappedToolNames = Object.keys(MCP_TOOL_ACTIONS).sort()
    const mappedActionIds = Object.values(MCP_TOOL_ACTIONS).sort()
    const expectedToolNames = actionIds.map((action) => capabilityIdToMcpTool(action)).sort()

    expect(toolNames).toEqual(expectedToolNames)
    expect(mappedToolNames).toEqual(expectedToolNames)
    expect(mappedActionIds).toEqual(actionIds)
  })

  it("documents model price rule IDs as opaque rule IDs", () => {
    const tools = buildAllMcpTools()
    const updateTool = tools.find((tool) => tool.name === "model_price_rule_update")
    const listTool = tools.find((tool) => tool.name === "model_price_rule_list")
    const ruleIdProperty = updateTool?.inputSchema.properties.ruleId as { description?: string } | undefined

    const listDescription = listTool?.description.toLowerCase() ?? ""
    const ruleIdDescription = ruleIdProperty?.description?.toLowerCase() ?? ""

    expect(listDescription).toContain("opaque rule id")
    expect(ruleIdDescription).toContain("opaque model price rule id")
    expect(ruleIdDescription).toContain("not a model name")
    expect(ruleIdDescription).toContain("not modelpattern")
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
      variable: vi.fn(async () => ({ ok: true as const })),
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
      variableDispatch: dispatchers.variable,
      workflowDispatch: dispatchers.workflow,
    })

    for (const action of allCapabilityIds()) {
      await expect(router.dispatch(action, {}, { source: "api" })).resolves.toEqual({ ok: true })
      const domain = getActionDomainId(action)
      expect(domain).not.toBeNull()
      expect(dispatchers[domain as keyof typeof dispatchers]).toHaveBeenLastCalledWith(action, {}, { source: "api" })
    }
  })

  it("does not ship or document the retired Synapse CLI surface", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> }
    const docsMatrix = readRepoFile("../docs/reference/capability-naming-matrix.md")
    const websiteMatrix = readRepoFile("../website/developer/capability-naming-matrix.md")
    const websiteCapabilities = readRepoFile("../website/reference/synapse-mcp-capabilities.md")

    expect(existsSync(new URL("database/cli", repoRoot))).toBe(false)
    expect(existsSync(new URL("electron/database/cli-installer.ts", repoRoot))).toBe(false)
    expect(packageJson.scripts?.["build:database"]).not.toContain("dist-database/cli")
    expect(`${docsMatrix}\n${websiteMatrix}\n${websiteCapabilities}`).not.toMatch(/\bCLI command\b|CLI 命令|synapse database|synapse scheduler|synapse content/u)
  })

  it("marks historical superpowers docs before mentioning retired Synapse CLI entrypoints", () => {
    const superpowersDocs = [
      ...readMarkdownFiles(new URL("../docs/superpowers/specs/", repoRoot), "specs"),
      ...readMarkdownFiles(new URL("../docs/superpowers/plans/", repoRoot), "plans"),
    ].filter((file) => !file.path.includes("2026-05-25-api-mcp-cli-retirement-doc-cleanup"))
    const retiredSynapseCliPattern = /\bCLI command\b|CLI 命令|synapse database|synapse scheduler|synapse content/u
    const supersededNote = "Superseded note: Synapse-owned CLI capability entrypoints were retired"

    const offenders = superpowersDocs
      .filter((file) => retiredSynapseCliPattern.test(file.content) && !file.content.includes(supersededNote))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })
})
