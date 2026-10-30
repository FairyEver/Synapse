import { z } from "zod"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
import { GAME_PRIVATE_UI_OPERATIONS } from "../shared/capability"
import { GameHallService, GameCloudError } from "./service"
export function createGameDispatcher(deps: {
  service: GameHallService
  permissionGuard: PermissionGuard
  auditSink: AuditSink
}) {
  return {
    async dispatch(
      operation: string,
      input: Record<string, unknown>,
      context: DispatchContext,
    ): Promise<DispatchResult> {
      const definition =
        GAME_TOOLS.find((t) => t.id === operation) ??
        (context.source === "api"
          ? GAME_PRIVATE_UI_OPERATIONS.find((t) => t.id === operation)
          : undefined)
      if (!definition) return { ok: false, code: "GAME_UNKNOWN_OPERATION", error: "未知游戏操作。" }
      const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp" }
      const metadata = { operation, source: context.source ?? "api" }
      try {
        if (
          operation === "app.game.poker.action.act" &&
          context.source !== "mcp-http" &&
          context.source !== "mcp-stdio" &&
          context.actor?.kind !== "agent"
        )
          throw new GameCloudError("POKER_ILLEGAL_ACTION", "只有接入的Agent可出牌。")
        const ui = context.source === "api"
        const schemaInput =
          ui && operation === "app.game.poker.table.state" ? { roomCode: input.roomCode } : input
        const params = z
          .fromJSONSchema(definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
          .parse(schemaInput) as Record<string, unknown>
        const allowed = await checkCapabilityPermission({
          permissionGuard: deps.permissionGuard,
          auditSink: deps.auditSink,
          action: "network.connect",
          actor,
          resource: "synapse-game",
          context: metadata,
        })
        if (!allowed?.allowed)
          throw new GameCloudError("GAME_PERMISSION_DENIED", "游戏网络权限未获允许。")
        const data = ui
          ? await deps.service.callFromUi(operation, {
              ...params,
              ...(input.perspective ? { perspective: input.perspective } : {}),
            })
          : await deps.service.call(operation, params, context.abortSignal)
        deps.auditSink.record({
          action: "network.connect",
          actor,
          resource: "synapse-game",
          outcome: "allowed",
          metadata,
        })
        return { ok: true, data }
      } catch (error) {
        deps.auditSink.record({
          action: "network.connect",
          actor,
          resource: "synapse-game",
          outcome: "failed",
          metadata: { ...metadata, errorName: error instanceof Error ? error.name : "Unknown" },
        })
        return {
          ok: false,
          code: error instanceof GameCloudError ? error.code : "GAME_REQUEST_FAILED",
          error: error instanceof Error ? error.message : "游戏请求失败。",
          ...(error instanceof GameCloudError ? { data: error.details } : {}),
        }
      }
    },
  }
}
