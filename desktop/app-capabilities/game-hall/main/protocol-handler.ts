import { randomUUID } from "node:crypto"
import { GAME_OPEN_HANDLER } from "../shared/manifest"
import {
  SYSTEM_APP_WINDOW_SERVICE_ID,
  type createDefaultSystemAppWindowService,
} from "../../../electron/services/system-app-window-service"
export function createGameProtocolHandlers(registry: { get<T>(id: string): T }) {
  return {
    async [GAME_OPEN_HANDLER](params: Record<string, unknown>) {
      const path =
        typeof params.entry === "string" && typeof params.roomCode === "string"
          ? `${params.entry}/${params.roomCode}`
          : "/"
      await registry
        .get<ReturnType<typeof createDefaultSystemAppWindowService>>(SYSTEM_APP_WINDOW_SERVICE_ID)
        .open("game-hall", { viewOpenRequest: { requestId: randomUUID(), path } })
    },
  }
}
