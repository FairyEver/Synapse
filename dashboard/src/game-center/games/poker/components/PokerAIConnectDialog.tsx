import { Accordion, Button, Modal } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { usePokerAIConnect } from "../hooks/usePokerAIConnect"
import { pokerConnectInstruction } from "../lib/connect-instruction"
import { amount } from "../lib/view"

export function PokerAIConnectDialog({open,onOpenChange,roomCode,table,onChanged}: {
  open:boolean;onOpenChange:(open:boolean)=>void;roomCode:string;table?:PokerTableView;onChanged:()=>void|Promise<void>
}) {
  const query=useGameQuery(()=>gameApi().poker.table.state({roomCode,perspective:"public"}),`ai-connect:${roomCode}`,1000,open && !table)
  const snapshot=table ?? query.data
  const refresh=async()=>{await query.refresh();await onChanged()}
  const connection=usePokerAIConnect(snapshot,refresh)
  const pending=!!connection.control?.handoffPending, connected=connection.control?.controller==="ai"
  const closed=snapshot?.status==="closed"
  const full=!!snapshot && snapshot.mySeatNo===null && snapshot.seats.filter(seat=>!seat.isHistorical && seat.status!=="left").length>=snapshot.maxSeats
  const unavailable=connection.busy || !snapshot || closed || !!query.error
  const status=closed ? "房间已解散" : connected ? "AI 已接管" : pending ? snapshot?.mySeatNo===null ? "等待你的 AI 入座" : "等待你的 AI 接管 · 本人仍可操作" : "尚未授权 AI 接入"
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} className="font-sans text-foreground scheme-light"><Modal.Container><Modal.Dialog>
    <Modal.CloseTrigger aria-label="关闭 AI 接入" />
    <Modal.Header><Modal.Heading>AI 接入 · #{roomCode}</Modal.Heading></Modal.Header>
    <Modal.Body className="space-y-4">
      <p role="status">{snapshot ? status : "正在读取接入状态…"}</p>
      {snapshot?.mode==="points" && snapshot.mySeatNo===null && <p className="text-sm text-muted">AI 入座时带入 {amount(snapshot.buyIn)} 点，离桌退回剩余点数。</p>}
      {!connected && !closed && <ol className="list-inside list-decimal space-y-2 text-sm"><li>允许接入并复制指令。</li><li>发送到已连接 Synapse MCP 的 AI 会话。</li><li>等候此处显示“AI 已接管”。</li></ol>}
      {!connected && !closed && <p className="text-sm text-muted">浏览器与本机 Synapse 需登录同一账号。若一直等待，请在 AI 会话检查游戏工具是否可用。</p>}
      {(query.error || connection.error) && <p role="alert" className="text-sm text-danger">{query.error || connection.error}</p>}
      {full && !pending && <p role="alert" className="text-sm text-danger">座位已满，请等待空位</p>}
      <Accordion><Accordion.Item id="instruction"><Accordion.Heading><Accordion.Trigger>查看完整接入指令<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body><p className="break-words text-sm text-muted">{pokerConnectInstruction(roomCode)}</p></Accordion.Body></Accordion.Panel></Accordion.Item></Accordion>
    </Modal.Body>
    <Modal.Footer className="flex-wrap">
      {query.error && <Button variant="secondary" isDisabled={connection.busy} onPress={()=>void query.refresh()}>重新读取状态</Button>}
      {pending && <Button variant="tertiary" isDisabled={unavailable} onPress={()=>void connection.change("cancel_ai")}>取消 AI 接入</Button>}
      {connected ? <Button isDisabled={unavailable} onPress={()=>void connection.change("takeover")}>本人接管</Button> : !closed && <Button isDisabled={unavailable || !pending && full} onPress={()=>void (pending ? connection.copy() : connection.change("request_ai"))}>{connection.busy ? "正在处理…" : pending ? "复制接入指令" : "允许 AI 接入并复制指令"}</Button>}
    </Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>
}
