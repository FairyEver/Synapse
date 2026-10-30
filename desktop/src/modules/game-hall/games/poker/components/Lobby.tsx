import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { LobbyView } from "./LobbyView"
import "../../../styles/hall.css"
import { useRef, useState } from "react"
import type { GameFunding, PokerVariant, PokerBlindPreset } from "@synapse/shared/game-contracts"
import { pokerConnectInstruction } from "../lib/connect-instruction"
import { useAccount } from "@/app-shell/account"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { gameApi } from "../../../lib/api"
import { useGameQuery, useGameMutation } from "../../../hooks/useGameQuery"
import { useHallOverview } from "../../../hooks/useHallOverview"
export function Lobby({ onRoom }: { onRoom: (code: string) => void }) {
  const [offset, setOffset] = useState(0),
    [createOpen, setCreateOpen] = useState(false),
    [connect, setConnect] = useState<string | null>(null),
    [closing, setClosing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [maxSeats, setMaxSeats] = useState("6"),
    [buyIn, setBuyIn] = useState("1000"),
    [createMode, setCreateMode] = useState<GameFunding>("points"),
    [variant, setVariant] = useState<PokerVariant>("standard52"),
    [blindPreset, setBlindPreset] = useState<PokerBlindPreset>("1/2")
  const creation = useRef<{ key: string; id: string } | null>(null)
  const { state: account } = useAccount(),
    userId = account.status === "authenticated" ? account.profile.user.id : null
  const lobby = useGameQuery(
      () => gameApi().poker.lobby.list({ offset, limit: 50, mode: "all" }),
      `poker:lobby:all:${offset}`,
      5000,
    ),
    hall = useHallOverview(),
    mutation = useGameMutation()
  const create = async () => {
    const params = { name, maxSeats: Number(maxSeats), buyIn: Number(buyIn), mode: createMode, variant, blindPreset },
      key = JSON.stringify(params)
    const result = await mutation.run(async () => {
      if (creation.current?.key !== key) creation.current = { key, id: crypto.randomUUID() }
      const intent = creation.current
      const room = await gameApi().poker.room.create({ ...params, creationId: intent.id })
      return { room, intent }
    })
    if (result && creation.current === result.intent) {
      setCreateOpen(false)
      onRoom(result.room.roomCode)
    }
  }
  const closeRoom = async () => {
    if (!closing) return
    const result = await mutation.run(() => gameApi().poker.room.close({ roomCode: closing }))
    if (result) {
      if (result.pending) toast("本手结束后解散房间")
      setClosing(null)
      await lobby.refresh()
    }
  }
  const copy = async () => {
    if (!connect) return
    const roomCode = connect
    const result = await mutation.run(async () => {
      const table = await gameApi().poker.table.state({roomCode, perspective:"public"})
      if (table.mySeatNo === null && !table.handoffPending) {
        if (table.controlVersion == null) throw new Error("请更新客户端后接入 AI")
        await gameApi().poker.control.set({roomCode, controlVersion:table.controlVersion, action:"request_ai"})
      }
      try {
        await navigator.clipboard.writeText(pokerConnectInstruction(roomCode))
      } catch {
        throw new Error("复制失败，请重试")
      }
      return true
    })
    if (result) toast("接入指令已复制")
  }
  return (
    <>
      <LobbyView
        rooms={lobby.data?.items ?? null}
        feedback={lobby.error ? <GameQueryFeedback query={lobby} /> : null}
        sessions={(hall.data?.sessions ?? []).filter((s) => s.game === "poker")}
        userId={userId}
        onRoom={onRoom}
        onCreate={() => {
          creation.current = null
          setCreateMode("points")
          setCreateOpen(true)
        }}
        onConnect={setConnect}
        onClose={setClosing}
        pagination={
          offset > 0 || lobby.data?.nextOffset != null ? (
            <div className="gc-pagination">
              <Button
                type="button"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={lobby.data?.nextOffset == null}
                onClick={() => setOffset(lobby.data?.nextOffset ?? offset)}
              >
                下一页
              </Button>
            </div>
          ) : null
        }
      />
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) creation.current = null
          setCreateOpen(open)
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>创建房间</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="poker-room-mode">房间类型</Label>
              <Select value={createMode} onValueChange={(value) => setCreateMode(value as GameFunding)}>
                <SelectTrigger id="poker-room-mode"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="points">点数房</SelectItem><SelectItem value="practice">陪练房</SelectItem></SelectContent>
              </Select>
              {createMode === "practice" && <p className="text-sm text-muted-foreground">不影响大厅点数</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="poker-variant">牌局规则</Label>
              <Select value={variant} onValueChange={v => setVariant(v as PokerVariant)}>
                <SelectTrigger id="poker-variant"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="standard52">标准 52 张</SelectItem><SelectItem value="short32">短牌 32 张 · 7 至 A</SelectItem></SelectContent>
              </Select>
              {variant === "short32" && <p className="text-sm text-muted-foreground">同花大于葫芦，A789T 是最小顺子</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="poker-blinds">盲注</Label>
              <Select value={blindPreset} onValueChange={v => setBlindPreset(v as PokerBlindPreset)}>
                <SelectTrigger id="poker-blinds"><SelectValue /></SelectTrigger>
                <SelectContent>{["1/2", "2/4", "5/10", "10/20"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="poker-room-name">房间名称</Label>
              <Input
                id="poker-room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={48}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="poker-seats">座位数</Label>
              <Select value={maxSeats} onValueChange={setMaxSeats}>
                <SelectTrigger id="poker-seats">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 9 }, (_, i) => (
                    <SelectItem key={i + 2} value={String(i + 2)}>
                      {i + 2} 人
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="poker-buyin">{createMode === "practice" ? "初始筹码" : "带入点数"}</Label>
              <Select value={buyIn} onValueChange={setBuyIn}>
                <SelectTrigger id="poker-buyin">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[500, 1000, 2000, 5000].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n.toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={mutation.busy}>
              创建
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!closing}
        onOpenChange={(open) => {
          if (!open && !mutation.busy) setClosing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>解散房间 #{closing}？</DialogTitle>
            <DialogDescription>{lobby.data?.items.find((r) => r.roomCode === closing)?.mode === "practice" ? "本手结束后解散，不兑换大厅点数。" : "本手结束后退还所有玩家的剩余筹码。"}</DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="destructive"
            disabled={mutation.busy}
            onClick={() => void closeRoom()}
          >
            解散房间
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!connect}
        onOpenChange={(open) => {
          if (!open) setConnect(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>接入 AI · #{connect}</DialogTitle>
            <DialogDescription>将指令发到你的 AI 会话</DialogDescription>
          </DialogHeader>
          <p className="text-sm">{connect && pokerConnectInstruction(connect)}</p>
          <Button type="button" disabled={mutation.busy} onClick={() => void copy()}>
            复制接入指令
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
