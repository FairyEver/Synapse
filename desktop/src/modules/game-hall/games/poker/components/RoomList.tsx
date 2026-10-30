import { ChevronRight, Spade, Users } from "lucide-react"
import type { PokerRoomView } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { amount } from "../lib/view"
const statusLabels: Record<string, string> = {
  running: "进行中",
  waiting: "等待中",
  paused: "已暂停",
  closed: "已结束",
}
export function RoomList({
  rooms,
  myRoomCodes,
  userId,
  onRoom,
  onConnect,
  onClose,
}: {
  rooms: PokerRoomView[]
  myRoomCodes: readonly string[]
  userId: string | null
  onRoom: (code: string) => void
  onConnect: (code: string) => void
  onClose: (code: string) => void
}) {
  return (
    <ul className="game-room-list divide-y rounded-lg border">
      {rooms.map((room) => {
        const canConnect = room.players < room.maxSeats && !myRoomCodes.includes(room.roomCode)
        return (
          <li
            key={room.roomCode}
            className="flex flex-wrap items-center gap-x-2 px-2 first:rounded-t-lg last:rounded-b-lg"
          >
            <button
              type="button"
              className="game-room-row group grid min-w-0 flex-1 items-center gap-4 rounded-md px-3 py-4 text-left"
              onClick={() => onRoom(room.roomCode)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Spade className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0">
                  <span
                    className="block truncate font-medium"
                    title={room.name || `房间 #${room.roomCode}`}
                  >
                    {room.name || `房间 #${room.roomCode}`}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {room.name && `#${room.roomCode} · `}
                    {statusLabels[room.status] ?? room.status}
                    <span className="game-room-compact">
                      {room.players} / {room.maxSeats} 人 · 盲注 {room.smallBlind} / {room.bigBlind}
                    </span>
                  </span>
                </span>
              </span>
              <span className="game-room-players items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                <Users className="size-3.5" aria-hidden="true" />
                {room.players} / {room.maxSeats}
              </span>
              <span className="game-room-blinds text-right text-sm tabular-nums text-muted-foreground">
                {room.smallBlind} / {room.bigBlind}
                <span className="ml-1 text-xs">盲注</span>
              </span>
              <span className="text-right text-sm tabular-nums">
                {amount(room.buyIn)}
                <span className="ml-1 text-xs text-muted-foreground">带入</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </button>
            <span className="flex items-center gap-2 py-2 pr-2">
              {canConnect && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="game-row-action"
                  onClick={() => onConnect(room.roomCode)}
                >
                  接入 AI
                </Button>
              )}
              {room.ownerUserId === userId && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="game-row-action"
                  onClick={() => onClose(room.roomCode)}
                >
                  解散
                </Button>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
