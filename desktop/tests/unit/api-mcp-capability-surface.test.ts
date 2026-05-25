import { existsSync, readFileSync } from "node:fs"
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

  it("routes every registered API action to its owning domain dispatcher", async () => {
    const dispatchers = {
      content: vi.fn(async () => ({ ok: true as const })),
      database: vi.fn(async () => ({ ok: true as const })),
      scheduler: vi.fn(async () => ({ ok: true as const })),
      workflow: vi.fn(async () => ({ ok: true as const })),
    }
    const router = createSynapseActionRouter({
      contentDispatch: dispatchers.content,
      databaseDispatch: dispatchers.database,
      schedulerDispatch: dispatchers.scheduler,
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
})
