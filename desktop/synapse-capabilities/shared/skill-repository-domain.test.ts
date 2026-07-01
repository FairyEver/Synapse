import { describe, expect, it } from "vitest"
import {
  SKILL_REPOSITORY_DOMAIN,
  SKILL_REPOSITORY_MCP_TOOL_ACTIONS,
  buildSkillRepositoryTools,
} from "./skill-repository-domain"
import {
  CAPABILITY_DOMAINS,
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
  getMcpToolDomainId,
} from "./registry"
import { assertCanonicalCapabilityId } from "./naming"

const capabilityIds = [
  "app.skill_repository.item.list",
  "app.skill_repository.item.get",
  "app.skill_repository.item.import_local",
  "app.skill_repository.item.update_local",
  "app.skill_repository.item.open",
] as const

const toolNames = [
  "app_skill_repository_list",
  "app_skill_repository_get",
  "app_skill_repository_import_local",
  "app_skill_repository_update_local",
  "app_skill_repository_open",
] as const

describe("Skill Repository capability domain", () => {
  it("registers canonical capability ids and domain metadata", () => {
    for (const id of capabilityIds) {
      expect(() => assertCanonicalCapabilityId(id)).not.toThrow()
    }

    expect(() => assertCanonicalCapabilityId("app.skill_repository.item.importLocal")).toThrow()
    expect(SKILL_REPOSITORY_DOMAIN.id).toBe("skill_repository")
    expect(SKILL_REPOSITORY_DOMAIN.capabilities.map((capability) => capability.id)).toEqual(capabilityIds)
    expect(CAPABILITY_DOMAINS.map((domain) => domain.id)).toContain("skill_repository")
    expect(getActionDomainId("app.skill_repository.item.list")).toBe("skill_repository")
  })

  it("maps only primary MCP tool names to Skill Repository actions", () => {
    expect(SKILL_REPOSITORY_MCP_TOOL_ACTIONS).toEqual({
      app_skill_repository_list: "app.skill_repository.item.list",
      app_skill_repository_get: "app.skill_repository.item.get",
      app_skill_repository_import_local: "app.skill_repository.item.import_local",
      app_skill_repository_update_local: "app.skill_repository.item.update_local",
      app_skill_repository_open: "app.skill_repository.item.open",
    })

    for (const name of toolNames) {
      expect(MCP_TOOL_ACTIONS[name]).toBe(SKILL_REPOSITORY_MCP_TOOL_ACTIONS[name])
      expect(getMcpToolDomainId(name)).toBe("skill_repository")
    }

    expect(SKILL_REPOSITORY_MCP_TOOL_ACTIONS).not.toHaveProperty("skill_repository_list")
    expect(SKILL_REPOSITORY_MCP_TOOL_ACTIONS).not.toHaveProperty("app_skill_repository_item_list")
    expect(MCP_TOOL_ACTIONS).not.toHaveProperty("skill_repository_item_list")
  })

  it("builds exactly the primary Skill Repository MCP tools", () => {
    const tools = buildSkillRepositoryTools()
    expect(tools.map((tool) => tool.name)).toEqual(toolNames)

    const allSkillRepositoryTools = buildAllMcpTools()
      .filter((tool) => tool.name.includes("skill_repository"))
      .map((tool) => tool.name)
    expect(allSkillRepositoryTools).toEqual(toolNames)
  })

  it("defines required and optional tool schemas", () => {
    const tools = new Map(buildSkillRepositoryTools().map((tool) => [tool.name, tool]))

    expect(tools.get("app_skill_repository_list")?.inputSchema).toEqual({
      type: "object",
      properties: {},
    })
    expect(tools.get("app_skill_repository_get")?.inputSchema).toMatchObject({
      required: ["repositoryId"],
      properties: {
        repositoryId: expect.objectContaining({ type: "string" }),
      },
    })
    expect(tools.get("app_skill_repository_import_local")?.inputSchema).toMatchObject({
      required: ["sourceDirectoryPath"],
      properties: {
        sourceDirectoryPath: expect.objectContaining({ type: "string" }),
        name: expect.objectContaining({ type: "string" }),
        title: expect.objectContaining({ type: "string" }),
        description: expect.objectContaining({ type: "string" }),
        openInBrowser: expect.objectContaining({ type: "boolean" }),
      },
    })
    expect(tools.get("app_skill_repository_update_local")?.inputSchema).toMatchObject({
      required: ["sourceDirectoryPath", "repositoryId"],
    })
    expect(tools.get("app_skill_repository_open")?.inputSchema).toMatchObject({
      required: ["repositoryId"],
      properties: {
        repositoryId: expect.objectContaining({ type: "string" }),
        openInBrowser: expect.objectContaining({ type: "boolean" }),
      },
    })
  })

  it("warns Agents not to set username automatically when a handle is required", () => {
    const tools = new Map(buildSkillRepositoryTools().map((tool) => [tool.name, tool]))

    expect(tools.get("app_skill_repository_import_local")?.description).toContain("USER_HANDLE_REQUIRED")
    expect(tools.get("app_skill_repository_import_local")?.description).toContain("Do not set username automatically")
    expect(tools.get("app_skill_repository_update_local")?.description).toContain("USER_HANDLE_REQUIRED")
    expect(tools.get("app_skill_repository_update_local")?.description).toContain("Do not set username automatically")
  })
})
