import { describe, expect, it } from "vitest"
import {
  buildAllMcpTools,
  CAPABILITY_DOMAINS,
  MCP_TOOL_ACTIONS,
  getActionDomainId,
} from "../../../../synapse-capabilities/shared/registry"
import { isCanonicalCapabilityId } from "../../../../synapse-capabilities/shared/naming"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import { searchSynapseTools } from "../../../../electron/services/agent-runtime/synapse-tool-router"
import { buildGameTools } from "../capability"
describe("游戏工具目录", () => {
  it.each(["打牌", "德州", "入座", "提醒", "暂离"])("中文检索%s能找到扑克工具", async (query) => {
    const result = await searchSynapseTools({ query, domain: "game", limit: 5 })
    expect(result.tools.some((t) => t.name.startsWith("app_game_poker_"))).toBe(true)
  })
  it("实际全局数量和私有UI例外与能力表一致", () => {
    expect(CAPABILITY_DOMAINS.flatMap(d => d.capabilities)).toHaveLength(369)
    expect(Object.keys(MCP_TOOL_ACTIONS)).toHaveLength(365)
    expect(buildAllMcpTools()).toHaveLength(365)
    expect(getActionDomainId("app.game.poker.control.set")).toBeNull()
    expect(getActionDomainId("app.game.poker.room.close")).toBeNull()
  })
  it("26个工具全部注册到game域并保持规范名称与schema", () => {
    const tools = buildGameTools()
    expect(tools).toHaveLength(26)
    for (const definition of GAME_TOOLS) {
      expect(isCanonicalCapabilityId(definition.id)).toBe(true)
      expect(getActionDomainId(definition.id)).toBe("game")
      expect(buildAllMcpTools().find((t) => t.name === definition.name)).toMatchObject({
        inputSchema: definition.inputSchema,
      })
    }
  })
})
