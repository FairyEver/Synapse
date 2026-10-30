import { useEffect, useState } from "react"
import type { GameSessionView } from "@synapse/shared/game-contracts"
import { useAccount } from "@/app-shell/account"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { useHallOverview } from "./hooks/useHallOverview"
import { useGameMutation } from "./hooks/useGameQuery"
import { gameApi } from "./lib/api"
import { HallHome } from "./components/HallHome"
import { GAME_RENDERERS } from "./game-registry"

const previews = Object.fromEntries(
  Object.entries(GAME_RENDERERS).map(([entry, value]) => [entry, value.Preview]),
)
const icons = Object.fromEntries(
  Object.entries(GAME_RENDERERS).map(([entry, value]) => [entry, value.Icon]),
)
function resolveTarget(path: string) {
  const entry = Object.keys(GAME_RENDERERS).find((entry) => path.startsWith(entry + "/"))
  return entry ? { entry, roomCode: path.slice(entry.length + 1) } : null
}
export function GameHallApp({
  openRequest,
}: { openRequest?: import("../apps/types").AppViewOpenRequest | null } = {}) {
  const hall = useHallOverview(),
    account = useAccount(),
    mutation = useGameMutation()
  const [route, setRoute] = useState<{ entry: string; roomCode: string | null } | null>(
    openRequest ? resolveTarget(openRequest.path) : null,
  )
  useEffect(() => {
    if (openRequest) setRoute(resolveTarget(openRequest.path))
  }, [openRequest])
  const enter = (entry: string) => setRoute({ entry, roomCode: null })
  const session = (s: GameSessionView) => {
    const game = hall.data?.games.find((g) => g.id === s.game)
    if (game) setRoute({ entry: game.entry, roomCode: s.roomCode })
  }
  const grant = () => {
    void mutation.run(async () => {
      await gameApi().hall.account({ claimGrant: true })
      await hall.refresh()
    })
  }
  if (!hall.authenticated)
    return (
      <SystemAppWindowShell>
        <div className="flex items-center gap-3 p-6 text-sm">
          <span>登录后进入游戏大厅</span>
          <Button onClick={() => void account.startLogin()}>登录</Button>
        </div>
      </SystemAppWindowShell>
    )
  const Selected = route ? GAME_RENDERERS[route.entry]?.Page : null
  if (Selected && route)
    return (
      <Selected
        key={account.state.status === "authenticated" ? account.state.profile.user.id : ""}
        roomCode={route.roomCode}
        onOpenRoom={(roomCode) => setRoute({ ...route, roomCode })}
        onBack={() => setRoute(null)}
      />
    )
  return (
    <SystemAppWindowShell left={<span className="text-sm font-medium">游戏大厅</span>}>
      <ScrollArea className="game-hall h-full bg-background text-foreground">
        <HallHome
          overview={hall.data}
          onEnter={enter}
          onSession={session}
          previews={previews}
          icons={icons}
          onGrant={grant}
        />
      </ScrollArea>
    </SystemAppWindowShell>
  )
}
