import { Button, Chip, Table } from "@heroui/react"
import type { PokerRoomView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { amount } from "../lib/view"

const statusLabels: Record<string, string> = { running: "进行中", waiting: "等待中", paused: "已暂停", closed: "已结束" }
export function RoomList({ rooms, myRoomCodes, userId, onRoom, onConnect, onClose }: {
  rooms: PokerRoomView[]
  myRoomCodes: readonly string[]
  userId: string | null
  onRoom: (code: string) => void
  onConnect: (code: string) => void
  onClose: (code: string) => void
}) {
  return <Table><Table.ScrollContainer><Table.Content aria-label="房间列表" className="min-w-3xl">
    <Table.Header><Table.Column isRowHeader>房间</Table.Column><Table.Column>类型</Table.Column><Table.Column>状态</Table.Column><Table.Column>人数</Table.Column><Table.Column>带入 / 盲注</Table.Column><Table.Column>操作</Table.Column></Table.Header>
    <Table.Body>
      {rooms.map(room => {
        const mine = myRoomCodes.includes(room.roomCode), canConnect = room.players < room.maxSeats && !mine
        return <Table.Row key={room.roomCode} id={room.roomCode}>
          <Table.Cell><div className="flex items-center gap-3"><span className="flex gap-1" data-card-size="xs" aria-hidden="true"><Card faceUp={false} /><Card faceUp={false} /></span><div>
            <Button variant="ghost" size="sm" onPress={() => onRoom(room.roomCode)}>{room.name || `房间 #${room.roomCode}`}</Button>
            <p className="text-xs text-muted">#{room.roomCode} · {room.rules?.variant === "short32" ? "短牌 32 张" : "标准 52 张"}</p>
          </div></div></Table.Cell>
          <Table.Cell><Chip size="sm">{room.mode === "practice" ? "陪练房" : "点数房"}</Chip></Table.Cell>
          <Table.Cell><Chip size="sm" color={room.status === "running" ? "success" : "default"}>{statusLabels[room.status] ?? room.status}</Chip><p className="mt-1 text-xs text-muted">{mine ? "已在桌" : room.players >= room.maxSeats ? "满员 · 可观看" : "可接入 AI"}</p></Table.Cell>
          <Table.Cell><span className="tabular-nums">{room.players} / {room.maxSeats} 人</span></Table.Cell>
          <Table.Cell><p className="text-xs text-muted">{room.mode === "practice" ? "初始筹码" : "带入点数"}</p><p className="tabular-nums">{amount(room.buyIn)}</p><p className="text-xs text-muted tabular-nums">{room.smallBlind} / {room.bigBlind}</p></Table.Cell>
          <Table.Cell><div className="flex items-center gap-2">{canConnect && <Button size="sm" variant="tertiary" onPress={() => onConnect(room.roomCode)}>接入 AI</Button>}{room.ownerUserId === userId && <Button size="sm" variant="danger-soft" onPress={() => onClose(room.roomCode)}>解散</Button>}</div></Table.Cell>
        </Table.Row>
      })}
    </Table.Body>
  </Table.Content></Table.ScrollContainer></Table>
}
