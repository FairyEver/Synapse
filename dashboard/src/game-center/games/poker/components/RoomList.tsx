import { Button, Card as SystemCard, Chip, Table } from "@heroui/react"
import type { PokerRoomView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { amount } from "../lib/view"

import "../../../styles/responsive-lists.css"

const statusLabels: Record<string, string> = { running: "进行中", waiting: "等待中", paused: "已暂停", closed: "已结束" }
export function RoomList({ rooms, myRoomCodes, userId, onRoom, onConnect, onClose }: {
  rooms: PokerRoomView[]
  myRoomCodes: readonly string[]
  userId: string | null
  onRoom: (code: string) => void
  onConnect: (code: string) => void
  onClose: (code: string) => void
}) {
  const rows = rooms.map(room => {
    const pending = room.myControl?.handoffPending, ai = room.myControl?.controller === "ai"
    const mine = room.myControl?.seatNo != null || myRoomCodes.includes(room.roomCode)
    const canConnect = pending || ai || room.players < room.maxSeats && !mine
    return {
      room,
      name: room.name || `房间 #${room.roomCode}`,
      description: `#${room.roomCode} · ${room.rules?.variant === "short32" ? "短牌 32 张" : "标准 52 张"}${room.rules?.ruleOptions?.roll ? " · Roll" : ""}`,
      type: room.mode === "practice" ? "陪练房" : "点数房",
      funding: room.mode === "practice" ? "初始筹码" : "带入点数",
      availability: pending ? "等待你的 AI 接入" : ai ? "你的 AI 已接管" : mine ? "已在桌" : room.players >= room.maxSeats ? "满员 · 可观看" : "可加入",
      hasActions: canConnect || room.ownerUserId === userId,
      actions: <>{canConnect && <Button size="sm" variant="tertiary" onPress={() => onConnect(room.roomCode)}>{pending ? "查看接入 / 取消" : ai ? "查看 AI 控制" : "接入 AI"}</Button>}{room.ownerUserId === userId && <Button size="sm" variant="danger-soft" onPress={() => onClose(room.roomCode)}>解散</Button>}</>,
    }
  })
  return <div className="game-responsive-list"><div className="game-wide-list"><Table><Table.ScrollContainer><Table.Content aria-label="房间列表" className="game-room-table min-w-3xl">
    <Table.Header><Table.Column isRowHeader>房间</Table.Column><Table.Column>类型</Table.Column><Table.Column>状态</Table.Column><Table.Column>人数</Table.Column><Table.Column>带入 / 盲注</Table.Column><Table.Column>操作</Table.Column></Table.Header>
    <Table.Body>
      {rows.map(({room, name, description, type, funding, availability, actions}) => {
        return <Table.Row key={room.roomCode} id={room.roomCode}>
          <Table.Cell><div className="flex items-center gap-3"><span className="flex gap-1" data-card-size="xs" aria-hidden="true"><Card faceUp={false} /><Card faceUp={false} /></span><div>
            <Button variant="ghost" size="sm" className="h-auto max-w-xs whitespace-normal wrap-anywhere text-left" onPress={() => onRoom(room.roomCode)}>{name}</Button>
            <p className="text-xs text-muted">{description}</p>
          </div></div></Table.Cell>
          <Table.Cell><Chip size="sm">{type}</Chip></Table.Cell>
          <Table.Cell><Chip size="sm" color={room.status === "running" ? "success" : "default"}>{statusLabels[room.status] ?? room.status}</Chip><p className="mt-1 text-xs text-muted">{availability}</p></Table.Cell>
          <Table.Cell><span className="tabular-nums">{room.players} / {room.maxSeats} 人</span></Table.Cell>
          <Table.Cell><p className="text-xs text-muted">{funding}</p><p className="tabular-nums">{amount(room.buyIn)}</p><p className="text-xs text-muted tabular-nums">{room.smallBlind} / {room.bigBlind}</p></Table.Cell>
          <Table.Cell><div className="flex items-center gap-2">{actions}</div></Table.Cell>
        </Table.Row>
      })}
    </Table.Body>
  </Table.Content></Table.ScrollContainer></Table></div>
    <ul className="game-compact-list space-y-4" aria-label="房间列表">
      {rows.map(({room, name, description, type, funding, availability, hasActions, actions}) => <li key={room.roomCode}>
        <SystemCard>
          <SystemCard.Header>
            <Button fullWidth variant="ghost" className="h-auto justify-start whitespace-normal wrap-anywhere text-left" onPress={() => onRoom(room.roomCode)}>{name}</Button>
            <SystemCard.Description className="text-xs">{description}</SystemCard.Description>
          </SystemCard.Header>
          <SystemCard.Content className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2"><Chip size="sm">{type}</Chip><Chip size="sm" color={room.status === "running" ? "success" : "default"}>{statusLabels[room.status] ?? room.status}</Chip><span className="text-xs text-muted">{availability}</span></div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted">人数</dt><dd className="tabular-nums">{room.players} / {room.maxSeats} 人</dd></div>
              <div><dt className="text-xs text-muted">{funding}</dt><dd className="tabular-nums">{amount(room.buyIn)}</dd></div>
              <div><dt className="text-xs text-muted">盲注</dt><dd className="text-xs tabular-nums">{room.smallBlind} / {room.bigBlind}</dd></div>
            </dl>
          </SystemCard.Content>
          {hasActions && <SystemCard.Footer className="flex-wrap gap-2">{actions}</SystemCard.Footer>}
        </SystemCard>
      </li>)}
    </ul>
  </div>
}
