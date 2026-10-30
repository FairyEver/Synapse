import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { useGameMutation } from "../../hooks/useGameQuery"
import { gameApi } from "../../lib/api"
import { Lobby } from "./components/Lobby"
import { Table } from "./components/Table"
import { HandRecord } from "./components/HandRecord"
import { AgentProfiles } from "./components/AgentProfiles"
import { usePokerRoom } from "./hooks/usePokerRoom"
const tabs = [
  { id: "rooms", label: "房间" },
  { id: "records", label: "牌局记录" },
  { id: "agents", label: "选手档案" },
]
function Room({ code, onBack }: { code: string; onBack: () => void }) {
  const room = usePokerRoom(code),
    mutation = useGameMutation()
  const nudge = (seatNo: number) => {
    void mutation.run(() => gameApi().poker.seat.nudge({ roomCode: code, seatNo }))
  }
  return room.table ? (
    <Table
      table={room.table}
      perspective={room.table.mySeatNo === null ? "public" : room.perspective}
      onPerspective={room.setPerspective}
      onNudge={nudge}
      onBack={onBack}
    />
  ) : (
    <Skeleton className="h-full w-full" />
  )
}
export function PokerApp({
  roomCode,
  onOpenRoom,
  onBack,
}: {
  roomCode: string | null
  onOpenRoom: (code: string | null) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState("rooms")
  return (
    <SystemAppWindowShell
      left={<span className="text-sm font-medium">德州扑克</span>}
      tabs={tabs}
      value={tab}
      onValueChange={(value) => {
        setTab(value)
        onOpenRoom(null)
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
