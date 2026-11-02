import { Button } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { useHallOverview } from "../../../hooks/useHallOverview"
import { isPokerCardMode } from "../lib/card-mode"
import { amount } from "../lib/view"

export function PokerJoinSummary({ table }: { table: PokerTableView }) {
  const cards = isPokerCardMode(table) ? " · 卡牌" : ""
  const hall = useHallOverview(table.mode === "points")
  if (table.mode === "practice") return <p className="text-sm text-muted">陪练房 · 不影响大厅点数{(table.ruleOptions?.roll ?? table.rules?.ruleOptions?.roll) && " · Roll"}{cards}</p>
  if (table.mode !== "points") return null
  return <div className="flex flex-wrap items-center gap-2 text-sm text-muted"><span>点数房 · 带入 {amount(table.buyIn)} 点{(table.ruleOptions?.roll ?? table.rules?.ruleOptions?.roll) && " · Roll"}{cards}</span>{hall.data ? <span>可用 {amount(hall.data.points.available)} 点</span> : hall.error ? <><span role="alert">可用点数读取失败</span><Button variant="tertiary" onPress={() => void hall.refresh()}>重试读取点数</Button></> : <span role="status">正在读取可用点数…</span>}</div>
}
