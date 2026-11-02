import { Button, Card, Chip, Table } from "@heroui/react"
import { ArrowUpRight } from "lucide-react"
import type { GameSessionView } from "@synapse/shared/game-contracts"
import "../styles/responsive-lists.css"
import { formatGameCountdown } from "../lib/format"

export function MySessions({ sessions, onOpen }: { sessions: GameSessionView[]; onOpen: (session: GameSessionView) => void }) {
  return <section aria-label="正在进行" className="game-responsive-list space-y-4">
    <h2 className="text-lg font-semibold">正在进行</h2>
    <div className="game-wide-list"><Table><Table.ScrollContainer><Table.Content aria-label="正在进行的游戏" className="game-session-table">
      <Table.Header><Table.Column isRowHeader>游戏</Table.Column><Table.Column>房间</Table.Column><Table.Column>状态</Table.Column><Table.Column>剩余时间</Table.Column><Table.Column>操作</Table.Column></Table.Header>
      <Table.Body renderEmptyState={() => "暂无进行中的游戏"}>
        {sessions.map(session => <Table.Row key={`${session.game}:${session.roomCode}`} id={`${session.game}:${session.roomCode}`}>
          <Table.Cell>{session.gameName}{session.funding === "practice" && " · 陪练"}</Table.Cell>
          <Table.Cell>#{session.roomCode}{session.seatNo !== null && ` · 座位 ${session.seatNo + 1}`}</Table.Cell>
          <Table.Cell><Chip color={session.needsAction ? "accent" : "default"}>{session.needsAction ? "轮到你" : "进行中"}</Chip></Table.Cell>
          <Table.Cell>{session.needsAction && session.deadlineMs !== null ? formatGameCountdown(session.deadlineMs) : "—"}</Table.Cell>
          <Table.Cell><Button variant="tertiary" onPress={() => onOpen(session)}>继续游戏 #{session.roomCode}<ArrowUpRight className="size-4" /></Button></Table.Cell>
        </Table.Row>)}
      </Table.Body>
    </Table.Content></Table.ScrollContainer></Table></div>
    <ul className="game-compact-list space-y-4" aria-label="正在进行的游戏">
      {sessions.length === 0 && <li className="text-sm text-muted">暂无进行中的游戏</li>}
      {sessions.map(session => <li key={`${session.game}:${session.roomCode}`}>
        <Card>
          <Card.Header className="flex-row flex-wrap items-center justify-between gap-2">
            <Card.Title className="text-sm">{session.gameName}{session.funding === "practice" && " · 陪练"}</Card.Title>
            <Chip color={session.needsAction ? "accent" : "default"}>{session.needsAction ? "轮到你" : "进行中"}</Chip>
          </Card.Header>
          <Card.Content className="flex flex-row flex-wrap justify-between gap-2 text-sm">
            <span>#{session.roomCode}{session.seatNo !== null && ` · 座位 ${session.seatNo + 1}`}</span>
            <span className="tabular-nums" aria-label="剩余时间">{session.needsAction && session.deadlineMs !== null ? formatGameCountdown(session.deadlineMs) : "—"}</span>
          </Card.Content>
          <Card.Footer><Button fullWidth variant="tertiary" onPress={() => onOpen(session)}>继续游戏 #{session.roomCode}<ArrowUpRight aria-hidden="true" /></Button></Card.Footer>
        </Card>
      </li>)}
    </ul>
  </section>
}
