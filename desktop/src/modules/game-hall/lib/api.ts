import { getSynapseBridge } from "@/lib/electron-bridge"
import type { GameBridge } from "../../../../app-capabilities/game-hall/shared/bridge"
export function gameApi(): GameBridge {
  const game = getSynapseBridge()?.game
  if (!game) throw new Error("游戏大厅不可用，请更新客户端。")
  return game
}
