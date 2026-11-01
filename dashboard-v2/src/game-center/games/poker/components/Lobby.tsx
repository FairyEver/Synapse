import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { LobbyView } from "./LobbyView"
import { useEffect, useRef, useState } from "react"
import { PokerAIConnectDialog } from "./PokerAIConnectDialog"
import { useAccount } from "@/game-center/runtime/account"
import { toast } from "@heroui/react"
import { Button } from "@heroui/react"
import { CreateRoomDialog } from "./CreateRoomDialog"
import { Modal } from "@heroui/react"
import { gameApi } from "../../../lib/api"
import { useGameQuery, useGameMutation } from "../../../hooks/useGameQuery"
import { usePokerRoomDraft } from "../hooks/usePokerRoomDraft"
import { useHallOverview } from "../../../hooks/useHallOverview"
export function Lobby({ onRoom }: { onRoom: (code: string) => void }) {
  const [offset, setOffset] = useState(0),
    [createOpen, setCreateOpen] = useState(false),
    [connect, setConnect] = useState<string | null>(null),
    [closing, setClosing] = useState<string | null>(null)
  const dialogGeneration = useRef(0)
  const creation = useRef<{ key: string; id: string } | null>(null)
  const { state: account } = useAccount(),
    userId = account.status === "authenticated" ? account.profile.user.id : null
  const nickname = account.status === "authenticated" ? account.profile.user.nickname?.trim() || account.profile.user.handle : "用户"
  const { draft, changeDraft, loadDraft, createParams } = usePokerRoomDraft(userId, nickname)
  useEffect(() => {
    creation.current = null
    dialogGeneration.current++
    setCreateOpen(false)
    setConnect(null)
  }, [userId])
  const openCreate = async () => {
    dialogGeneration.current++
    if (await loadDraft()) setCreateOpen(true)
  }
  const lobby = useGameQuery(
      () => gameApi().poker.lobby.list({ offset, limit: 50, mode: "all" }),
      `poker:lobby:all:${offset}`,
      5000,
    ),
    hall = useHallOverview(),
    mutation = useGameMutation()
  const create = async () => {
    const generation = dialogGeneration.current
    const params = createParams(),
      key = JSON.stringify(params)
    const result = await mutation.run(async () => {
      if (creation.current?.key !== key) creation.current = { key, id: crypto.randomUUID() }
      const intent = creation.current
      const room = await gameApi().poker.room.create({ ...params, creationId: intent.id })
      return { room, intent }
    })
    if (result && creation.current === result.intent) {
      creation.current = null
      if (dialogGeneration.current === generation) {
        setCreateOpen(false)
        onRoom(result.room.roomCode)
      }
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
  return (
    <>
      <LobbyView
        rooms={lobby.data?.items ?? null}
        feedback={lobby.error ? <GameQueryFeedback query={lobby} /> : null}
        sessions={(hall.data?.sessions ?? []).filter((s) => s.game === "poker")}
        userId={userId}
        onRoom={onRoom}
        onCreate={() => void openCreate()}
        onConnect={setConnect}
        onClose={setClosing}
        pagination={
          offset > 0 || lobby.data?.nextOffset != null ? (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                isDisabled={offset === 0}
                onPress={() => setOffset(Math.max(0, offset - 50))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                isDisabled={lobby.data?.nextOffset == null}
                onPress={() => setOffset(lobby.data?.nextOffset ?? offset)}
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
          dialogGeneration.current++
          setCreateOpen(open)
        }}
        value={draft}
        onChange={changeDraft}
        onCreate={() => void create()}
        busy={mutation.busy}
      />
      <Modal.Backdrop
        isOpen={!!closing}
        onOpenChange={(open) => {
          if (!open && !mutation.busy) setClosing(null)
        }}
      >
        <Modal.Container><Modal.Dialog><Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>解散房间 #{closing}？</Modal.Heading>
            <p className="text-sm text-muted">{lobby.data?.items.find((r) => r.roomCode === closing)?.mode === "practice" ? "仅你与机器人参与时立即解散，有其他玩家时本手结束后解散；不兑换大厅点数。" : "本手结束后退还所有玩家的剩余筹码。"}</p>
          </Modal.Header>
          <Modal.Footer>
            <Button
              type="button"
              variant="danger"
              isDisabled={mutation.busy}
              onPress={() => void closeRoom()}
            >
              解散房间
            </Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container>
      </Modal.Backdrop>
      {connect && <PokerAIConnectDialog key={`${userId}:${connect}`} open onOpenChange={open => { if (!open) setConnect(null) }} roomCode={connect} onChanged={lobby.refresh} />}
    </>
  )
}
