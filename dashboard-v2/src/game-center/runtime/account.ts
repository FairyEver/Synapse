import { abortable } from "./abortable"
import { useSyncExternalStore } from "react"
import { dashboardApi, type DashboardMe } from "@/lib/api"
import { ApiError } from "@/lib/api-client"
import { buildDashboardSignInUrl } from "@/lib/dashboard-redirect"
import { subscribeUserSessionChange } from "@/lib/user-session-events"

type State =
  | { status: "loading" | "unauthenticated" | "error"; message?: string }
  | { status: "authenticated"; connectivity: "online" | "offline"; profile: DashboardMe }
let state: State = { status: "loading" }
const listeners = new Set<() => void>()
const identityListeners = new Set<() => void>()
let generation = 0
let pending: { promise: Promise<void>; controller: AbortController } | null = null
function cancelPending() {
  pending?.controller.abort(new DOMException("登录会话已变更。", "AbortError"))
  pending = null
}
const identity = () => state.status === "authenticated" ? state.profile.user.id : null
function publish(next: State) {
  const previous = identity()
  state = next
  if (previous !== identity()) { generation++; for (const listener of identityListeners) listener() }
  for (const listener of listeners) listener()
}
export function getGameIdentity() { return identity() }
export function onGameIdentityChange(listener: () => void) { identityListeners.add(listener); return () => { identityListeners.delete(listener) } }
export function startGameLogin() { window.location.assign(buildDashboardSignInUrl(window.location)) }
export function invalidateGameSession() {
  generation++
  cancelPending()
  publish({ status: "unauthenticated" })
  for (const listener of identityListeners) listener()
  startGameLogin()
}
export function revalidateGameSession(): Promise<void> {
  if (pending) return pending.promise
  const epoch = generation, controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("登录会话读取超时。", "AbortError")), 30_000)
  const entry = { controller, promise: Promise.resolve() }
  pending = entry
  entry.promise = (async () => {
    try {
      const session = await abortable(controller.signal, () => dashboardApi.getSession({ signal: controller.signal }))
      const profile = await abortable(controller.signal, () => dashboardApi.getMe({ signal: controller.signal }))
      if (epoch !== generation) return
      if (session.userId && session.userId !== profile.user.id) { invalidateGameSession(); return }
      publish({ status: "authenticated", connectivity: "online", profile })
    } catch (error) {
      if (epoch !== generation) return
      if (error instanceof ApiError && error.status === 401) { invalidateGameSession(); return }
      publish(state.status === "authenticated" ? { ...state, connectivity: "offline" } : { status: "error", message: "无法连接，请重试。" })
    }
  })().finally(() => { clearTimeout(timer); if (pending === entry) pending = null })
  return entry.promise
}
let previousListeners: (() => void) | undefined
export function installGameSessionListeners() {
  previousListeners?.()
  const focus = () => { void revalidateGameSession() }
  const change = () => {
    generation++
    cancelPending()
    publish({ status: "loading" })
    for (const listener of identityListeners) listener()
    void revalidateGameSession()
  }
  const unsubscribe = subscribeUserSessionChange(change)
  window.addEventListener("focus", focus)
  window.addEventListener("online", focus)
  const dispose = () => { unsubscribe(); window.removeEventListener("focus", focus); window.removeEventListener("online", focus) }
  previousListeners = dispose
  return dispose
}
export function useAccount() {
  const snapshot = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state)
  return { state: snapshot, startLogin: startGameLogin }
}
