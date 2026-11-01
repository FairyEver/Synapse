import "@/styles/globals.css"
import "./styles/web.css"
import "@/lib/browser-compat"
import { StrictMode } from "react"
import { mountGameRoot } from "./runtime/mount"
import { Toast } from "@heroui/react"
import { GameHallApp } from "./GameHallApp"
import { useAccount, installGameSessionListeners, revalidateGameSession } from "./runtime/account"
import { Button } from "@heroui/react"
import { Skeleton } from "@heroui/react"
function Application() {
  const { state } = useAccount()
  if (state.status === "loading") return <Skeleton className="h-full w-full" />
  if (state.status === "error") return <div className="flex h-full items-center justify-center gap-3" role="alert">{state.message}<Button onPress={() => void revalidateGameSession()}>重试</Button></div>
  if (state.status !== "authenticated") return null
  return <GameHallApp key={state.profile.user.id} />
}
const stopSessionListeners = installGameSessionListeners()
import.meta.hot?.dispose(stopSessionListeners)
void revalidateGameSession()
mountGameRoot(document.getElementById("root")!,<StrictMode><Application /><Toast.Provider /></StrictMode>)
