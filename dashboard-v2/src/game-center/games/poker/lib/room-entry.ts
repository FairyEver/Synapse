import type { PokerTableView } from "@synapse/shared/game-contracts"
import { toast } from "@heroui/react"
import { gamePath } from "../../../runtime/routes"

export function waitingForPlayers(table: PokerTableView) {
  if (table.status === "closed" || table.status === "running" || table.handId || table.awaitingReady) return null
  const seats = table.seats.filter(seat => !seat.isHistorical && seat.status !== "left" && !seat.leavePending)
  const eligible = seats.filter(seat => seat.status !== "sitting_out" && seat.stack > 0)
  if (eligible.length >= 2 && eligible.some(seat => seat.participantKind !== "bot")) return "等待开局"
  if (seats.some(seat => seat.status === "sitting_out") && seats.length >= 2) return "等待暂离玩家回座"
  if (seats.length >= 2 && seats.some(seat => seat.stack <= 0)) return "等待有筹码的玩家"
  const missing = Math.max(eligible.some(seat => seat.participantKind !== "bot") ? 0 : 1, 2 - eligible.length)
  return `等待其他玩家 · 还需 ${missing} 人`
}

export async function copyPokerInvitation(roomCode: string) {
  try {
    const url = new URL(gamePath({entry:"/poker",roomCode,tab:"rooms"}), window.location.origin).href
    await navigator.clipboard.writeText(url)
    toast.success("房间链接已复制")
  } catch {
    toast.danger("复制失败，请重试邀请")
  }
}
