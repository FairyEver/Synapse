import "../styles/lobby.css"
import { ArrowUpRight } from "lucide-react"
import type { PokerRoomView } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "./Card"
import { amount } from "../lib/view"
const statusLabels: Record<string, string> = {
  running: "进行中",
  waiting: "等待中",
  paused: "已暂停",
  closed: "已结束",
}
/** Occupancy counts only: no real seat positions or hand information. */
function RoomArtwork({ players, maxSeats }: { players: number; maxSeats: number }) {
  return (
    <span className="gc-room-art">
      <span className="gc-room-deck" data-card-size="sm" aria-hidden="true">
        <Card faceUp={false} />
        <Card faceUp={false} />
      </span>
      <span className="gc-room-capacity">
        <span className="gc-room-occupancy">
          <b>
            {players} <small>/ {maxSeats} 人</small>
          </b>
          <span>在桌</span>
        </span>
        <span className="gc-room-seat-meter" aria-hidden="true">
          {Array.from({ length: maxSeats }, (_, i) => (
            <span key={i} data-occupied={i < players} />
          ))}
        </span>
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
                <span className="flex min-w-0 items-center gap-2">
                  <strong title={room.name || `房间 #${room.roomCode}`}>
                    {room.name || `房间 #${room.roomCode}`}
                  </strong>
                  <Badge variant="outline">{room.mode === "practice" ? "陪练房" : "点数房"}</Badge>
                </span>
                <span className="gc-room-state" data-running={room.status === "running"}>
                  {statusLabels[room.status] ?? room.status}
                </span>
              </span>
              <span className="gc-room-code">
                #{room.roomCode}
                {room.rules?.variant === "short32" ? " · 短牌 32 张" : " · 标准 52 张"}
                {mine && " · 我的牌桌"}
              </span>
              <RoomArtwork players={room.players} maxSeats={room.maxSeats} />
              <span className="gc-room-stakes">
                <span>
                  <small>{room.mode === "practice" ? "初始筹码" : "带入"}</small>
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
