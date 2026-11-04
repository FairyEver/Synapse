import { expect, it } from "vitest"
import { buildSkillHubTools, SKILL_HUB_MCP_TOOL_ACTIONS } from "../capability"

it("exposes exactly ten Hub tools as strict ordinary object inputs", () => {
  const tools = buildSkillHubTools()
  expect(tools).toHaveLength(10)
  for (const { name, inputSchema } of tools) {
    expect(inputSchema).toMatchObject({ type: "object", additionalProperties: false })
    expect(SKILL_HUB_MCP_TOOL_ACTIONS[name]).toBeTruthy()
    for (const field of ["visibility", "teamIds", "ownerId", "token"]) expect(inputSchema.properties).not.toHaveProperty(field)
  }
  expect(tools.find((tool) => tool.name === "app_skill_hub_team_list")?.description).toContain("nextCursor")
})
