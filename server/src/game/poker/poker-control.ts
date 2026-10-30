import { reject } from "./poker-error"

export type PokerCaller = "mcp" | "human"
type ControlledSeat = {
  controller?: string
  controlVersion?: number
  handoffPending?: boolean
  pauseReason?: string | null
}
export function assertController(seat: ControlledSeat, caller: PokerCaller, version?: number): void {
  const controller = seat.controller ?? "ai", current = seat.controlVersion ?? 0
  if (controller !== (caller === "mcp" ? "ai" : "human"))
    reject("POKER_CONTROL_RELEASED", "控制权已交出，请停止当前操作。")
  if (version !== current && !(caller === "mcp" && version === undefined && current === 0))
    reject("POKER_STALE_CONTROL", "控制权已变更，请重新读取牌桌。")
}
function assertVersion(seat: ControlledSeat, version: number) {
  if (!Number.isSafeInteger(version) || version !== (seat.controlVersion ?? 0))
    reject("POKER_STALE_CONTROL", "控制权已变更，请重新读取牌桌。")
}
export function changeControl(seat: ControlledSeat, action: "takeover" | "request_ai" | "cancel_ai", version: number) {
  assertVersion(seat, version)
  const controller = seat.controller ?? "ai"
  if (action !== "takeover" && controller !== "human")
    reject("POKER_CONTROL_RELEASED", "请先接管座位。")
  if (action === "takeover") return {
    controller: "human",
    controlVersion: version + 1,
    handoffPending: false,
    checkpoint: null,
    ...(seat.pauseReason === "context_maintenance" ? { sitPending: false, pauseReason: null } : {}),
  }
  return { controller, controlVersion: version + 1, handoffPending: action === "request_ai", checkpoint: null }
}
export function claimControl(seat: ControlledSeat, version: number) {
  assertVersion(seat, version)
  if (seat.controller !== "human" || !seat.handoffPending)
    reject("POKER_CONTROL_RELEASED", "没有待接受的AI交接。")
  return { controller: "ai", controlVersion: version + 1, handoffPending: false, checkpoint: null }
}
