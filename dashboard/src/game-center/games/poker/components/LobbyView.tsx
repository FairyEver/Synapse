import type { ReactNode } from "react"
import { Plus, Spade } from "lucide-react"
import type { GameSessionView, PokerRoomView } from "@synapse/shared/game-contracts"
import { Button } from "@heroui/react"
import { Skeleton } from "@heroui/react"
import { MySessions } from "../../../components/MySessions"
import { RoomList } from "./RoomList"
export function LobbyView({
  rooms,
  sessions,
  userId,
  onRoom,
  onCreate,
  onConnect,
  onClose,
  pagination,
  feedback,
}: {
  rooms: PokerRoomView[] | null
  sessions: GameSessionView[]
  userId: string | null
  onRoom: (code: string) => void
  onCreate: () => void
  onConnect: (code: string) => void
  onClose: (code: string) => void
  pagination?: ReactNode
  feedback?: ReactNode
}) {
  const isEmpty = rooms?.length === 0
  const createButton = (
    <Button type="button" size="lg" onPress={onCreate}>
      <Plus data-icon="inline-start" aria-hidden="true" />
      创建房间
    </Button>
  )
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-balance">房间</h1>
          {rooms && rooms.length > 0 && <span className="text-sm text-muted tabular-nums">本页 {rooms.length} 间</span>}
        </div>
        {!isEmpty && createButton}
      </header>
      {sessions.length > 0 && (
        <MySessions sessions={sessions} onOpen={(s) => s.roomCode && onRoom(s.roomCode)} />
      )}
      <section aria-label="房间列表" className="flex min-w-0 flex-1 flex-col gap-4">
        {feedback}
        {!rooms ? (
          !feedback && <Skeleton className="h-64 w-full" />
        ) : rooms.length === 0 ? (
          <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-4 py-12">
            <Spade className="size-8 text-muted" aria-hidden="true" />
            <p className="text-muted">暂无房间</p>
            {createButton}
          </div>
        ) : (
          <RoomList
            rooms={rooms}
            myRoomCodes={sessions.flatMap((s) => (s.roomCode ? [s.roomCode] : []))}
            userId={userId}
            onRoom={onRoom}
            onConnect={onConnect}
            onClose={onClose}
          />
        )}
      </section>
      {pagination}
    </div>
  )
}
