import type { ReactNode } from "react"
import { Plus, Spade } from "lucide-react"
import type { GameSessionView, PokerRoomView } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { MySessions } from "../../../components/MySessions"
import { RoomList } from "./RoomList"
import "../../../styles/hall.css"
export function LobbyView({
  rooms,
  sessions,
  userId,
  onRoom,
  onCreate,
  onConnect,
  onClose,
  pagination,
}: {
  rooms: PokerRoomView[] | null
  sessions: GameSessionView[]
  userId: string | null
  onRoom: (code: string) => void
  onCreate: () => void
  onConnect: (code: string) => void
  onClose: (code: string) => void
  pagination?: ReactNode
}) {
  return (
    <main className="game-center gc-page">
      <header className="gc-masthead">
        <div className="gc-heading">
          <Spade aria-hidden="true" />
          <h1>德州牌桌</h1>
          <span className="gc-mode">无限注</span>
        </div>
        <Button type="button" className="gc-primary-action" onClick={onCreate}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          创建房间
        </Button>
      </header>
      {sessions.length > 0 && (
        <MySessions sessions={sessions} onOpen={(s) => s.roomCode && onRoom(s.roomCode)} />
      )}
      <section className="gc-rooms-section">
        <div className="gc-section-heading">
          <h2>房间</h2>
          {rooms && <span className="gc-meta">本页 {rooms.length} 间</span>}
        </div>
        {!rooms ? (
          <Skeleton className="h-64 w-full" />
        ) : rooms.length === 0 ? (
          <p className="gc-empty">
            <Spade aria-hidden="true" />
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
    </main>
  )
}
