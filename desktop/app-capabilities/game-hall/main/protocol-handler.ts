import { GAME_OPEN_HANDLER } from "../shared/manifest"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../electron/generated/deployment-config.generated"
import { createAccountExternalUrlOpener } from "../../../electron/bootstrap/account-external-opener"
import type { PermissionGuard, AuditSink } from "../../../electron/runtime/security"

/** Retained for historical notifications; game rendering only exists on the Web. */
export function createGameProtocolHandlers(registry: { get<T>(id: string): T }) {
  return {
    async [GAME_OPEN_HANDLER](params: Record<string, unknown>) {
      const room = params.entry === "/poker" && typeof params.roomCode === "string" && /^\d{4,6}$/.test(params.roomCode)
      if ((params.entry != null || params.roomCode != null) && !room) throw new Error("游戏地址无效。")
      const path = room ? `/game/poker/${params.roomCode}` : "/game/"
      const open = createAccountExternalUrlOpener({
        permissionGuard: registry.get<PermissionGuard>("core.permission-guard"),
        auditSink: registry.get<AuditSink>("core.audit-sink"),
        source: GAME_OPEN_HANDLER,
        omitUrlDetails: true,
      })
      await open(new URL(path, SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).toString())
    },
  }
}
