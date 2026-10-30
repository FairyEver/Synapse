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
import { Skeleton } from "@/components/ui/skeleton"
import { gameApi } from "../../../lib/api"
import { useGameQuery, useGameMutation } from "../../../hooks/useGameQuery"
import { useHallOverview } from "../../../hooks/useHallOverview"
import { MySessions } from "../../../components/MySessions"
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
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <MySessions
        sessions={(hall.data?.sessions ?? []).filter((s) => s.game === "poker")}
        onOpen={(s) => s.roomCode && onRoom(s.roomCode)}
      />
      <div className="flex items-center justify-between">
        <h2 className="font-medium">房间</h2>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          创建房间
        </Button>
      </div>
      {!lobby.data ? (
        <Skeleton className="h-40 w-full" />
      ) : lobby.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无房间</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {lobby.data.items.map((room) => (
            <div key={room.roomCode} className="flex items-center gap-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left hover:bg-muted"
                onClick={() => onRoom(room.roomCode)}
              >
                <span className="truncate">
                  #{room.roomCode} {room.name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {room.players}/{room.maxSeats} · 1/2 · 带入 {room.buyIn.toLocaleString()} ·{" "}
                  {room.status === "running" ? "进行中" : "等待中"}
                </span>
                <span>进入</span>
              </button>
              {room.players < room.maxSeats &&
                !hall.data?.sessions.some(
                  (s) => s.roomCode === room.roomCode && s.game === "poker",
                ) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mr-3"
                    onClick={() => setConnect(room.roomCode)}
                  >
                    接入 AI
                  </Button>
                )}
              {room.ownerUserId === userId && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mr-3"
                  onClick={() => setClosing(room.roomCode)}
                >
                  解散
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
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
    </div>
  )
}
