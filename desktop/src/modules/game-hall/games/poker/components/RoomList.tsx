import "../styles/lobby.css"
import { ArrowUpRight, Spade } from "lucide-react"
import type { PokerRoomView } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { amount } from "../lib/view"
const statusLabels: Record<string, string> = {
  running: "进行中",
  waiting: "等待中",
  paused: "已暂停",
  closed: "已结束",
}
/** Only visualizes occupancy counts, not actual seat positions or hidden game state. */
function RoomArtwork({ players, maxSeats }: { players: number; maxSeats: number }) {
  return (
    <span className="gc-room-art">
      <svg viewBox="0 0 300 130" aria-hidden="true">
        <ellipse className="gc-room-rail" cx="150" cy="65" rx="102" ry="40" />
        <ellipse className="gc-room-felt" cx="150" cy="65" rx="95" ry="33" />
        {Array.from({ length: maxSeats }, (_, i) => {
          const angle = (2 * Math.PI * i) / maxSeats - Math.PI / 2
          return (
            <circle
              key={i}
              cx={150 + 123 * Math.cos(angle)}
              cy={65 + 53 * Math.sin(angle)}
              r="6"
              data-occupied={i < players}
            />
          )
        })}
      </svg>
      <span className="gc-room-occupancy">
        <Spade aria-hidden="true" />
        <b>
          {players} <small>/ {maxSeats} 人</small>
        </b>
      </span>
    </span>
  )
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
    <ul className="gc-room-grid">
      {rooms.map((room) => {
        const mine = myRoomCodes.includes(room.roomCode),
          canConnect = room.players < room.maxSeats && !mine
        return (
          <li key={room.roomCode} className="gc-room" data-mine={mine}>
            <button type="button" className="gc-room-open" onClick={() => onRoom(room.roomCode)}>
              <span className="gc-room-heading">
                <strong title={room.name || `房间 #${room.roomCode}`}>
                  {room.name || `房间 #${room.roomCode}`}
                </strong>
                <span className="gc-room-state" data-running={room.status === "running"}>
                  {statusLabels[room.status] ?? room.status}
                </span>
              </span>
              <span className="gc-room-code">
                #{room.roomCode}
                {mine && " · 我的牌桌"}
              </span>
              <RoomArtwork players={room.players} maxSeats={room.maxSeats} />
              <span className="gc-room-stakes">
                <span>
                  <small>带入</small>
                  <b>{amount(room.buyIn)}</b>
                </span>
                <span>
                  <small>盲注</small>
                  <b>
                    {room.smallBlind} / {room.bigBlind}
                  </b>
                </span>
                <ArrowUpRight aria-hidden="true" />
              </span>
            </button>
            <div className="gc-room-actions">
              <span>
                {mine ? "已在桌" : room.players >= room.maxSeats ? "满员 · 可观看" : "可接入 AI"}
              </span>
              <div>
                {canConnect && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gc-row-action"
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
                    className="gc-row-action"
                    onClick={() => onClose(room.roomCode)}
                  >
                    解散
                  </Button>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
