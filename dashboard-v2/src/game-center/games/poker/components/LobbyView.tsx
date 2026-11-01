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
  return (
    <div className="space-y-8 p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Spade className="size-6 shrink-0" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">德州牌桌</h1>
          <span className="text-sm text-muted">无限注</span>
        </div>
        <Button type="button" onPress={onCreate}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          创建房间
        </Button>
      </header>
      {sessions.length > 0 && (
        <MySessions sessions={sessions} onOpen={(s) => s.roomCode && onRoom(s.roomCode)} />
      )}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2>房间</h2>
          {rooms && <span className="text-sm text-muted">本页 {rooms.length} 间</span>}
        </div>
        {feedback}
        {!rooms ? (
          !feedback && <Skeleton className="h-64 w-full" />
        ) : rooms.length === 0 ? (
          <p className="flex min-h-40 items-center justify-center gap-3 text-muted">
            <Spade className="size-5 shrink-0" aria-hidden="true" />
            暂无房间
          </p>
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
