import { useState } from "react"
import { Button, Label, NumberField, Radio, RadioGroup } from "@heroui/react"
import { ArrowLeft } from "lucide-react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { currentRoomSeats, usePracticePreparation } from "../hooks/usePracticePreparation"
import { amount } from "../lib/view"

export function PracticePreparation({ table, onRefresh, onBack }: { table: PokerTableView; onRefresh: () => void | Promise<void>; onBack: () => void }) {
  const seats = currentRoomSeats(table)
  const bots = seats.filter(seat => seat.participantKind === "bot")
  const capacity = table.maxSeats - seats.length + bots.length - 1
  const [count, setCount] = useState(Math.max(bots.length, Math.min(3, capacity)))
  const [participation, setParticipation] = useState<"human" | "ai">("human")
  const controls = usePracticePreparation(table.roomCode, onRefresh)
  const total = Math.max(bots.length, count)
  const valid = Number.isInteger(total) && total >= 1 && total <= capacity
  return <div className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground">
    <header className="flex items-center gap-3 bg-surface p-3"><Button variant="tertiary" onPress={onBack}><ArrowLeft aria-hidden="true" />返回房间</Button><strong className="text-sm">#{table.roomCode} · 陪练</strong></header>
    <section aria-label="陪练配置" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <form className="mx-auto flex max-w-lg flex-col gap-6 py-4" onSubmit={event => { event.preventDefault(); if (valid) void controls.prepare(total, participation) }}>
        <div className="space-y-2"><h1 className="text-xl font-semibold">陪练准备</h1><p className="text-sm text-muted">{table.variant === "short32" ? "短牌 32 张" : "标准 52 张"} · 盲注 {table.smallBlind ?? 1}/{table.bigBlind ?? 2} · 初始筹码 {amount(table.buyIn)}</p></div>
        <NumberField name="bots" value={total} onChange={setCount} minValue={Math.max(1, bots.length)} maxValue={Math.max(1, capacity)} isDisabled={controls.busy || capacity < 1}>
          <Label>机器人数量</Label><NumberField.Group><NumberField.DecrementButton aria-label="减少机器人" /><NumberField.Input className="w-full" /><NumberField.IncrementButton aria-label="增加机器人" /></NumberField.Group>
        </NumberField>
        <RadioGroup value={participation} onChange={value => setParticipation(value as "human" | "ai")} isDisabled={controls.busy}>
          <Label>我的参与方式</Label><div className="flex flex-wrap gap-4"><Radio value="human"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>本人操作</Radio.Content></Radio><Radio value="ai"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>外部 AI</Radio.Content></Radio></div>
        </RadioGroup>
        <p className="text-sm text-muted">你和 {Number.isFinite(total) ? total : "—"} 个机器人 · 不影响大厅点数</p>
        {controls.busy && <p role="status" className="text-sm">正在准备 · 已添加 {controls.added ?? bots.length}/{total}</p>}
        {controls.error && <p role="alert" className="text-sm text-danger">{controls.error} · 已添加 {controls.added ?? bots.length} 个机器人</p>}
        {capacity < 1 && <p role="alert" className="text-sm text-danger">座位不足，请返回房间列表</p>}
        <Button type="submit" isDisabled={controls.busy || !valid}>{controls.busy ? "准备中…" : participation === "human" ? "入座并开始陪练" : "配置并接入 AI"}</Button>
      </form>
    </section>
  </div>
}
