import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useGameQuery, useGameMutation } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import type { PokerAgentView } from "@synapse/shared/game-contracts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useHallOverview } from "../../../hooks/useHallOverview"
import { amount } from "../lib/view"
import { PersonaVersions } from "./PersonaVersions"
export function AgentProfiles() {
  const [roomCode, setRoomCode] = useState("all")
  const hall = useHallOverview(),
    rooms = (hall.data?.sessions ?? []).filter((s) => s.game === "poker" && s.roomCode)
  const agents = useGameQuery(() => gameApi().poker.agent.list(), "poker:agents"),
    stats = useGameQuery(
      () => gameApi().poker.stats.get(roomCode === "all" ? {} : { roomCode }),
      `poker:stats:${roomCode}`,
    )
  const recent = useGameQuery(() => gameApi().poker.hand.history({ limit: 5 }), "poker:recent")
  const [editing, setEditing] = useState<Partial<PokerAgentView>>({
      model: "",
      persona: "",
    }),
    mutation = useGameMutation()
  const save = async () => {
    const result = await mutation.run(() =>
      gameApi().poker.agent.upsert({
        id: editing.id,
        model: editing.model ?? "",
        persona: editing.persona ?? "",
      }),
    )
    if (result) {
      setEditing(result)
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
            onClick={() => setEditing(agent)}
          >
            {agent.model || "未声明模型"}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing({ model: "", persona: "" })}
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
            <Textarea
              id="poker-persona"
              className="min-h-52"
              value={editing.persona ?? ""}
              maxLength={20000}
              onChange={(event) => setEditing({ ...editing, persona: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">只有你自己能看到</p>
          </div>
          <Button type="submit" disabled={mutation.busy}>
            保存选手
          </Button>
        </form>
        <div className="space-y-6">
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
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {rooms.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-medium">同桌对比</h3>
              <Select value={roomCode} onValueChange={setRoomCode}>
                <SelectTrigger aria-label="对比牌桌">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">选择牌桌</SelectItem>
                  {rooms.map((room) => (
                    <SelectItem key={room.roomCode} value={room.roomCode!}>
                      #{room.roomCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {stats.data?.comparison && (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 text-left font-normal">选手</th>
                        {["入池", "翻前加注", "进攻", "胜率"].map((label) => (
                          <th key={label} className="p-2 text-right font-normal">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.data.comparison.map((player) => (
                        <tr key={player.seatNo} className="border-b">
                          <th className="py-2 text-left font-normal">
                            {player.displayName}
                            {player.isMe && "（我）"}
                          </th>
                          <td className="p-2 text-right tabular-nums">
                            {Math.round(player.vpip * 100)}%
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {Math.round(player.pfr * 100)}%
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {player.aggression.toFixed(2)}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {Math.round(player.winRate * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          <GameQueryFeedback query={recent} />
          {recent.data && (
            <section className="space-y-3">
              <h3 className="font-medium">最近手牌</h3>
              {recent.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无牌局记录</p>
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
