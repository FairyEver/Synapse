import { useAccount } from "@/game-center/runtime/account"
import { useEffect, useState } from "react"
import { Button } from "@/game-center/ui/button"
import { GameQueryFeedback } from "../../components/GameQueryFeedback"
import { ScrollArea } from "@/game-center/ui/scroll-area"
import { Skeleton } from "@/game-center/ui/skeleton"
import { SystemAppWindowShell } from "@/game-center/runtime/page-shell"
import { SystemAppTopBarActionButton } from "@/game-center/runtime/page-shell"
import { useGameMutation } from "../../hooks/useGameQuery"
import { gameApi } from "../../lib/api"
import { Lobby } from "./components/Lobby"
import { Table } from "./components/Table"
import { HandRecord } from "./components/HandRecord"
import { AgentProfiles } from "./components/AgentProfiles"
import { usePokerRoom } from "./hooks/usePokerRoom"
import { usePokerEvents } from "./hooks/usePokerEvents"
import { PracticeBots, PracticeBotAddButton } from "./components/PracticeBots"
import { usePracticeBots } from "./hooks/usePracticeBots"
const tabs = [
  { id: "rooms", label: "房间" },
  { id: "records", label: "牌局记录" },
  { id: "agents", label: "选手档案" },
]
function Room({ code, onBack }: { code: string; onBack: () => void }) {
  const { state: account } = useAccount()
  const identityKey = account.status === "authenticated" ? account.profile.user.id : undefined
  const room = usePokerRoom(code),
    mutation = useGameMutation()
  const events = usePokerEvents(code, room.perspective, !!room.table, identityKey)
  const bots = usePracticeBots(room.table, room.refresh)
  const nudge = (seatNo: number) => {
    void mutation.run(() => gameApi().poker.seat.nudge({ roomCode: code, seatNo }))
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <GameQueryFeedback query={room} />
      <div className="min-h-0 flex-1">
        {room.table ? (
          <Table
            identityKey={identityKey}
            table={room.table}
            perspective={room.table.mySeatNo === null ? "public" : room.perspective}
            onPerspective={room.setPerspective}
            onNudge={nudge}
            onRefresh={room.refresh}
            events={events.events}
            animate={events.animate}
            actions={<PracticeBotAddButton controls={bots} />}
            extras={bots.canManage ? <PracticeBots controls={bots} /> : null}
            onBack={onBack}
          />
        ) : room.error ? (
          <Button className="m-4" variant="outline" onClick={onBack}>
            返回房间
          </Button>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
    </div>
  )
}
export function PokerApp({
  roomCode,
  onOpenRoom,
  onBack,
  tab: routeTab,
  onTabChange,
}: {
  roomCode: string | null
  onOpenRoom: (code: string | null) => void
  onBack: () => void
  tab?: "rooms" | "records" | "agents"
  onTabChange?: (tab: "rooms" | "records" | "agents") => void
}) {
  const [localTab, setTab] = useState("rooms")
  const tab = routeTab ?? localTab
  useEffect(() => {
    if (roomCode) setTab("rooms")
  }, [roomCode])
  return (
    <SystemAppWindowShell
      immersive={!!roomCode}
      left={<span className="text-sm font-medium">德州扑克</span>}
      tabs={tabs}
      value={tab}
      onValueChange={(value) => {
        setTab(value)
        if (onTabChange) onTabChange(value as "rooms" | "records" | "agents")
        else onOpenRoom(null)
      }}
      actions={<SystemAppTopBarActionButton onClick={onBack}>返回大厅</SystemAppTopBarActionButton>}
    >
      <div className="game-hall h-full min-h-0 bg-background text-foreground">
        {tab === "rooms" && roomCode ? (
          <Room key={roomCode} code={roomCode} onBack={() => onOpenRoom(null)} />
        ) : (
          <ScrollArea className={tab === "rooms" ? "game-center h-full" : "h-full"}>
            {tab === "rooms" ? (
              <Lobby onRoom={onOpenRoom} />
            ) : tab === "records" ? (
              <HandRecord />
            ) : (
              <AgentProfiles />
            )}
          </ScrollArea>
        )}
      </div>
    </SystemAppWindowShell>
  )
}
