import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { useHumanControls, type PokerIntent } from "../hooks/useHumanControls"
import { amount, remaining } from "../lib/view"
export function HumanControls({ table, perspective, onRefresh, identityKey }: { table: PokerTableView; perspective: "owner" | "public"; onRefresh: () => void | Promise<void>; identityKey?: string }) {
  const { busy, error, to, setTo, uncertain, mine, controller, version, handoff,
    act, retry, control, join, sit, leave, copy, requestAIJoin } = useHumanControls(table, onRefresh, identityKey)
  const legal = table.legalActions ?? [], numeric = Number(to)
  const validAmount = Number.isSafeInteger(numeric) && numeric >= (table.minRaiseTo ?? Infinity) && numeric <= (table.maxRaiseTo ?? -1)
  const acting = perspective === "owner" && controller === "human" && table.actionOnSeat === table.mySeatNo && table.status === "running" && !!table.handId && version != null
  const disabled = busy || uncertain
  return <div className="poker-human-controls" aria-label="本人牌桌操作">
    <div className="poker-control-state" role="status">{table.status === "closed" ? "房间已解散" : !mine ? handoff ? "等待 AI 入座" : "旁观中" : mine.status === "waiting" ? "已入座 · 下一手加入" : handoff ? "等待 AI 接入 · 本人仍可出牌" : controller === "human" ? "本人操作" : "AI 操作"}{mine && table.actionOnSeat === mine.seatNo && table.deadlineMs != null && <span> · {remaining(table.deadlineMs)}</span>}</div>
    {error && <p role="alert">{error}{uncertain && "，请重试确认结果"}</p>}
    {uncertain && <Button disabled={busy} onClick={retry}>重试出牌</Button>}
    {acting && <>
      {(legal.includes("bet") || legal.includes("raise")) && <div className="poker-bet-input"><Label htmlFor="poker-bet-to">{legal.includes("raise") ? "加注到" : "下注到"}</Label><Input id="poker-bet-to" type="number" inputMode="numeric" min={table.minRaiseTo} max={table.maxRaiseTo} step={1} value={to} disabled={disabled} onChange={e => setTo(e.target.value)} /><Slider aria-label="下注金额" min={table.minRaiseTo ?? 0} max={table.maxRaiseTo ?? 0} step={1} value={[Number.isFinite(numeric) ? Math.min(table.maxRaiseTo ?? 0, Math.max(table.minRaiseTo ?? 0,numeric)) : table.minRaiseTo ?? 0]} disabled={disabled} onValueChange={v => setTo(String(v[0]))} /></div>}
      <div className="poker-action-buttons">{(["fold", "check", "call", "bet", "raise", "allin"] as PokerIntent["action"][]).filter(a => legal.includes(a)).map(action => <Button key={action} disabled={disabled || (["bet","raise"].includes(action) && !validAmount)} variant={action === "fold" ? "outline" : "default"} onClick={() => act(action)}>{({fold:"弃牌",check:"过牌",call:`跟注 ${amount(table.toCall ?? 0)}`,bet:"下注",raise:"加注",allin:"全下"})[action]}</Button>)}</div>
    </>}
    <div className="poker-seat-controls">
      {!mine && table.status !== "closed" && <><Button disabled={busy || table.seats.length >= table.maxSeats} onClick={join}>本人入座</Button>{handoff ? <><Button variant="outline" onClick={() => void copy()}>复制 AI 接入指令</Button><Button variant="outline" disabled={busy} onClick={() => control("cancel_ai")}>取消 AI 接入</Button></> : <Button variant="outline" disabled={busy || version == null} onClick={requestAIJoin}>接入 AI</Button>}</>}
      {mine && table.status !== "closed" && <>
        {controller !== "human" ? <Button disabled={disabled || version == null} onClick={() => control("takeover")}>本人接管</Button> : handoff ? <Button variant="outline" disabled={disabled} onClick={() => control("cancel_ai")}>取消 AI 接管</Button> : <Button variant="outline" disabled={disabled || version == null} onClick={() => control("request_ai")}>交给 AI</Button>}
        {handoff && <Button variant="outline" onClick={() => void copy()}>复制 AI 接入指令</Button>}
        <Button variant="ghost" disabled={disabled || version == null || controller !== "human"} onClick={sit}>{mine.status === "sitting_out" ? "回到牌桌" : "暂离"}</Button>
        <Button variant="ghost" disabled={disabled || version == null || controller !== "human"} onClick={leave}>离桌</Button>
      </>}
    </div>
  </div>
}
