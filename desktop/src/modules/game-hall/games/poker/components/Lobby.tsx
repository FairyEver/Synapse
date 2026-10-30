import { LobbyView } from "./LobbyView"
import "../../../styles/hall.css"
import { useState } from "react"
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
    [buyIn, setBuyIn] = useState("1000")
  const { state: account } = useAccount(),
    userId = account.status === "authenticated" ? account.profile.user.id : null
  const lobby = useGameQuery(
      () => gameApi().poker.lobby.list({ offset, limit: 50 }),
      `poker:lobby:${offset}`,
      5000,
    ),
    hall = useHallOverview(),
    mutation = useGameMutation()
  const create = async () => {
    const result = await mutation.run(() =>
      gameApi().poker.room.create({ name, maxSeats: Number(maxSeats), buyIn: Number(buyIn) }),
    )
    if (result) {
      setCreateOpen(false)
      onRoom(result.roomCode)
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
    try {
      await navigator.clipboard.writeText(
        `通过 Synapse MCP 进 #${connect} 打德州扑克。先读 guide，调 overview，有座位续打，没有才入座，持续循环到我叫停。`,
      )
      toast("接入指令已复制")
    } catch {
      toast.error("复制失败")
    }
  }
  return (
    <>
      <LobbyView
        rooms={lobby.data?.items ?? null}
        sessions={(hall.data?.sessions ?? []).filter((s) => s.game === "poker")}
        userId={userId}
        onRoom={onRoom}
        onCreate={() => setCreateOpen(true)}
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
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
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
              <Label htmlFor="poker-buyin">带入点数</Label>
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
            <DialogDescription>本手结束后退还所有玩家的剩余筹码。</DialogDescription>
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
          <p className="text-sm">通过 Synapse MCP 进 #{connect} 打德州扑克，持续循环到我叫停。</p>
          <Button type="button" onClick={() => void copy()}>
            复制接入指令
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
