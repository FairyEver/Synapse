import { useEffect, useState } from "react"
import type { GameSessionView } from "@synapse/shared/game-contracts"
import { useAccount } from "./runtime/account"
import { Button } from "@heroui/react"
import { SystemAppWindowShell } from "./runtime/page-shell"
import { parseGamePath, gamePath, type GameRoute } from "./runtime/routes"
import { useHallOverview } from "./hooks/useHallOverview"
import { useGameMutation } from "./hooks/useGameQuery"
import { gameApi } from "./lib/api"
import { GameQueryFeedback } from "./components/GameQueryFeedback"
import { HallHome } from "./components/HallHome"
import { GAME_RENDERERS } from "./game-registry"

const previews = Object.fromEntries(Object.entries(GAME_RENDERERS).map(([entry, value]) => [entry, value.Preview]))
const icons = Object.fromEntries(Object.entries(GAME_RENDERERS).map(([entry, value]) => [entry, value.Icon]))
const artwork = Object.fromEntries(Object.entries(GAME_RENDERERS).map(([entry, value]) => [entry, value.Artwork]))
type OpenRequest = { requestId: string; path: string }
function initialRoute(request?: OpenRequest | null) {
  return parseGamePath(request ? `/game${request.path === "/" ? "/" : request.path}` : window.location.pathname)
}
export function GameHallApp({ openRequest }: { openRequest?: OpenRequest | null } = {}) {
  const hall = useHallOverview(), account = useAccount(), mutation = useGameMutation()
  const [route, setRoute] = useState(() => initialRoute(openRequest))
  useEffect(() => { if (openRequest) setRoute(initialRoute(openRequest)) }, [openRequest])
  useEffect(() => {
    const back = () => setRoute(parseGamePath(window.location.pathname))
    window.addEventListener("popstate", back)
    return () => window.removeEventListener("popstate", back)
  }, [])
  const navigate = (next: GameRoute) => {
    if (gamePath(next) !== window.location.pathname) window.history.pushState(null, "", gamePath(next))
    setRoute(next)
  }
  const enter = (entry: string) => navigate({ entry, roomCode: null, tab: "rooms" })
  const session = (s: GameSessionView) => {
    const game = hall.data?.games.find(g => g.id === s.game)
    if (game) navigate({ entry: game.entry, roomCode: s.roomCode, tab: "rooms" })
  }
  const grant = () => { void mutation.run(async () => { await gameApi().hall.account({ claimGrant: true }); await hall.refresh() }) }
  if (!hall.authenticated) return <SystemAppWindowShell><div className="flex items-center gap-3 p-6 text-sm"><span>登录后进入游戏</span><Button onPress={() => void account.startLogin()}>登录</Button></div></SystemAppWindowShell>
  if (!route) return <SystemAppWindowShell><div className="flex items-center gap-3 p-6" role="alert">页面不存在<Button onPress={() => navigate({ entry:null, roomCode:null, tab:"rooms" })}>返回大厅</Button></div></SystemAppWindowShell>
  const Selected = route.entry ? GAME_RENDERERS[route.entry]?.Page : null
  if (Selected) return <Selected key={account.state.status === "authenticated" ? account.state.profile.user.id : ""}
    roomCode={route.roomCode} tab={route.tab}
    onTabChange={tab => navigate({ ...route, roomCode:null, tab })}
    onOpenRoom={roomCode => navigate({ ...route, roomCode, tab:"rooms" })}
    onBack={() => navigate({ entry:null, roomCode:null, tab:"rooms" })} />
  return <SystemAppWindowShell left={<span className="text-sm font-medium">游戏</span>}>
    <div className="game-hall game-center h-full min-h-0 overflow-y-auto overscroll-contain">
      <GameQueryFeedback query={hall} />
      {(hall.data || !hall.error) && <HallHome overview={hall.data} onEnter={enter} onSession={session} previews={previews} icons={icons} artwork={artwork} onGrant={grant} />}
    </div>
  </SystemAppWindowShell>
}
