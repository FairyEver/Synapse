import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { LobbyView } from "./LobbyView"
import "../../../styles/hall.css"
import { useRef, useState } from "react"
import { pokerConnectInstruction } from "../lib/connect-instruction"
import { useAccount } from "@/app-shell/account"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CreateRoomDialog, type PokerRoomDraft } from "./CreateRoomDialog"
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
    [draft, setDraft] = useState<PokerRoomDraft>({
      name: "", mode: "points", variant: "standard52", blindPreset: "1/2", maxSeats: 6, buyIn: 1000,
    })
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
    const params = draft,
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
          setDraft((value) => ({ ...value, mode: "points" }))
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
      <CreateRoomDialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) creation.current = null
          setCreateOpen(open)
        }}
        value={draft}
        onChange={setDraft}
        onCreate={() => void create()}
        busy={mutation.busy}
      />
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
