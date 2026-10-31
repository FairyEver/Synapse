import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { useEffect, useRef, useState } from "react"
import { Button } from "@heroui/react"
import { Input } from "@heroui/react"
import { TextArea } from "@heroui/react"
import { Label } from "@heroui/react"
import { useGameQuery, useGameMutation } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { ModeFilter } from "./ModeFilter"
import type { GameFunding, PokerAgentView } from "@synapse/shared/game-contracts"
import { ListBox, Select, Table } from "@heroui/react"
import { useHallOverview } from "../../../hooks/useHallOverview"
import { amount } from "../lib/view"
import { PersonaVersions } from "./PersonaVersions"
export function AgentProfiles() {
  const [roomCode, setRoomCode] = useState("all"), [mode, setMode] = useState<GameFunding>("points")
  const hall = useHallOverview(),
    rooms = (hall.data?.sessions ?? []).filter((s) => s.game === "poker" && s.roomCode && (s.funding ?? "points") === mode)
  useEffect(() => {
    if (
      hall.data &&
      roomCode !== "all" &&
      !hall.data.sessions.some(
        (session) => session.game === "poker" && session.roomCode === roomCode,
      )
    )
      setRoomCode("all")
  }, [hall.data, roomCode])
  const agents = useGameQuery(() => gameApi().poker.agent.list(), "poker:agents"),
    stats = useGameQuery(
      () => gameApi().poker.stats.get(roomCode === "all" ? (mode === "points" ? {} : { mode }) : { roomCode }),
      `poker:stats:${mode}:${roomCode}`,
    )
  const recent = useGameQuery(() => gameApi().poker.hand.history({ limit: 5, mode }), `poker:recent:${mode}`)
  const [editing, setEditing] = useState<Partial<PokerAgentView>>({
      model: "",
      persona: "",
    }),
    mutation = useGameMutation()
  const draftGeneration = useRef(0)
  const creationId = useRef<string | null>(null)
  const confirmedSaves = useRef(new Map<string, PokerAgentView>())
  const selectionBaseline = useRef(editing)
  useEffect(() => {
    if (agents.loading || agents.error || !agents.data) return
    for (const agent of agents.data) confirmedSaves.current.delete(agent.id)
    const baseline = selectionBaseline.current,
      refreshed = agents.data.find((agent) => agent.id === baseline.id)
    if (!refreshed || refreshed === baseline) return
    selectionBaseline.current = refreshed
    setEditing((current) => {
      if (current.id !== refreshed.id) return current
      return current === baseline
        ? refreshed
        : { ...refreshed, model: current.model, persona: current.persona }
    })
  }, [agents.data, agents.error, agents.loading])
  const selectDraft = (draft: Partial<PokerAgentView>) => {
    const selected = draft.id ? confirmedSaves.current.get(draft.id) ?? draft : draft
    draftGeneration.current++
    creationId.current = null
    selectionBaseline.current = selected
    setEditing(selected)
  }
  const save = async () => {
    const submitted = editing,
      generation = draftGeneration.current
    const result = await mutation.run(() =>
      gameApi().poker.agent.upsert({
        ...(editing.id
          ? { id: editing.id }
          : { creationId: (creationId.current ??= crypto.randomUUID()) }),
        model: editing.model ?? "",
        persona: editing.persona ?? "",
      }),
    )
    if (result) {
      confirmedSaves.current.set(result.id, result)
      const sameDraft = draftGeneration.current === generation,
        baseline = selectionBaseline.current
      if (sameDraft || baseline.id === result.id) selectionBaseline.current = result
      setEditing((current) => {
        if (sameDraft)
          return current === submitted
            ? result
            : { ...result, model: current.model, persona: current.persona }
        if (current.id !== result.id) return current
        return current === baseline
          ? result
          : { ...result, model: current.model, persona: current.persona }
      })
      await agents.refresh()
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <GameQueryFeedback query={agents} />
      <div className="flex flex-wrap items-center gap-2">
        {agents.data?.map((agent) => (
          <Button
            type="button"
            key={agent.id}
            variant={editing.id === agent.id ? "secondary" : "ghost"}
            onPress={() => selectDraft(agent)}
          >
            {agent.model || "未声明模型"}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onPress={() => selectDraft({ model: "", persona: "" })}
        >
          新建选手
        </Button>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="poker-model">模型名称（可选）</Label>
            <Input
              id="poker-model"
              value={editing.model ?? ""}
              maxLength={24}
              onChange={(event) => setEditing({ ...editing, model: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="poker-persona">风格提示词</Label>
            <TextArea
              id="poker-persona"
              className="min-h-52"
              value={editing.persona ?? ""}
              maxLength={20000}
              onChange={(event) => setEditing({ ...editing, persona: event.target.value })}
            />
            <p className="text-xs text-muted">只有你自己能看到</p>
          </div>
          <Button type="submit" isDisabled={mutation.busy}>
            保存选手
          </Button>
        </form>
        <div className="space-y-6">
          <ModeFilter value={mode} label="战绩类型" onChange={(value) => { setMode(value); setRoomCode("all") }} />
          <GameQueryFeedback query={stats} />
          {stats.data && (
            <dl className="grid grid-cols-2 gap-4">
              {[
                ["自愿入池", `${Math.round(stats.data.vpip * 100)}%`],
                ["翻前加注", `${Math.round(stats.data.pfr * 100)}%`],
                ["进攻系数", stats.data.aggression.toFixed(2)],
                ["胜率", `${Math.round(stats.data.winRate * 100)}%`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="mt-1 font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {rooms.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-medium">同桌对比</h3>
              <Select aria-label="对比牌桌" selectedKey={roomCode} onSelectionChange={key => setRoomCode(String(key))}>
                <Select.Trigger>
                  <Select.Value />
                <Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>
                  <ListBox.Item id="all" textValue="选择牌桌">选择牌桌</ListBox.Item>
                  {rooms.map((room) => (
                    <ListBox.Item key={room.roomCode} id={room.roomCode!} textValue={`#${room.roomCode}`}>
                      #{room.roomCode}
                    </ListBox.Item>
                  ))}
                </ListBox></Select.Popover>
              </Select>
              {stats.data?.comparison && (
                <div className="overflow-auto">
                  <Table><Table.ScrollContainer><Table.Content aria-label="同桌对比">
                    <Table.Header>

                        <Table.Column isRowHeader>选手</Table.Column>
                        {["入池", "翻前加注", "进攻", "胜率"].map((label) => (
                          <Table.Column key={label} className="text-right">
                            {label}
                          </Table.Column>
                        ))}
                      </Table.Header>
                    <Table.Body>
                      {stats.data.comparison.map((player) => (
                        <Table.Row key={player.seatNo} id={player.seatNo}>
                          <Table.Cell>
                            {player.displayName}
                            {player.isMe && "（我）"}
                          </Table.Cell>
                          <Table.Cell className="text-right tabular-nums">
                            {Math.round(player.vpip * 100)}%
                          </Table.Cell>
                          <Table.Cell className="text-right tabular-nums">
                            {Math.round(player.pfr * 100)}%
                          </Table.Cell>
                          <Table.Cell className="text-right tabular-nums">
                            {player.aggression.toFixed(2)}
                          </Table.Cell>
                          <Table.Cell className="text-right tabular-nums">
                            {Math.round(player.winRate * 100)}%
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content></Table.ScrollContainer></Table>
                </div>
              )}
            </section>
          )}
          <GameQueryFeedback query={recent} />
          {recent.data && (
            <section className="space-y-3">
              <h3 className="font-medium">最近手牌</h3>
              {recent.data.items.length === 0 ? (
                <p className="text-sm text-muted">暂无牌局记录</p>
              ) : (
                <ul className="divide-y">
                  {recent.data.items.map((hand) => (
                    <li key={hand.handId} className="flex justify-between gap-3 py-2 text-sm">
                      <span>
                        #{hand.roomCode} · 第 {hand.handNo} 手
                      </span>
                      <span className="tabular-nums">
                        {hand.delta > 0 ? "+" : ""}
                        {amount(hand.delta)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {editing.id && (
            <PersonaVersions key={`${editing.id}:${editing.versionSeq}`} agentId={editing.id} />
          )}
        </div>
      </div>
    </div>
  )
}
