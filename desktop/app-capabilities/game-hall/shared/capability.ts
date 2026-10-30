import {
  POKER_PRIVATE_UI_OPERATIONS,
  POKER_UI_OPERATIONS,
} from "../games/poker/shared/ui-operations"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import type {
  CapabilityDomainDefinition,
  McpToolDefinition,
} from "../../../synapse-capabilities/shared/types"
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"
export const GAME_SERVICE_ID = "app.game.hall.cloud"
export const GAME_DOMAIN: CapabilityDomainDefinition = {
  id: "game",
  capabilities: GAME_TOOLS.map((t) => ({
    id: t.id as CapabilityId,
    title: t.name,
    description: t.description,
    mutates: t.mutates,
  })),
}
export const GAME_MCP_TOOL_ACTIONS = Object.fromEntries(GAME_TOOLS.map((t) => [t.name, t.id]))
export const GAME_PRIVATE_UI_OPERATIONS = POKER_PRIVATE_UI_OPERATIONS
export const GAME_UI_OPERATIONS = [
  ...GAME_TOOLS.filter((t) => t.id.startsWith("app.game.hall.")),
  ...POKER_UI_OPERATIONS,
]
export function buildGameTools(): McpToolDefinition[] {
  return GAME_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { ...t.inputSchema, type: "object" },
  }))
}
