import { useCallback, useEffect, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { isAppNavigationBusy } from "@/app-shell/navigation-guard"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { MainNavigationInput, MainNavigationRequest } from "@/modules/apps/main-navigation"

const logger = createRendererLogger("main-navigation")

export function useMainNavigation(
  navigate: (destination: MainNavigationInput, apply: () => boolean) => Promise<boolean>,
) {
  const [pending, setPending] = useState<MainNavigationInput | null>(null)
  const current = useRef<{ id?: number; destination: MainNavigationInput } | null>(null)
  const sequence = useRef(0)
  const accountOwner = useRef<string | null | undefined>(undefined)
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const acknowledge = useCallback((id: number) => {
    void getSynapseBridge()?.apps?.acknowledgeMainNavigation(id).catch((error) => {
      logger.warn("Could not acknowledge main window navigation.", { error })
    })
  }, [])

  const complete = useCallback((destination: MainNavigationInput) => {
    if (current.current?.destination !== destination) return
    const { id } = current.current
    current.current = null
    setPending(null)
    if (id !== undefined) acknowledge(id)
  }, [acknowledge])

  const discard = useCallback(() => {
    sequence.current += 1
    if (current.current) complete(current.current.destination)
  }, [complete])

  const open = useCallback(async (destination: MainNavigationInput, request?: MainNavigationRequest) => {
    if (isAppNavigationBusy()) {
      if (request) acknowledge(request.id)
      return false
    }
    const token = ++sequence.current
    if (current.current) complete(current.current.destination)
    const bridge = getSynapseBridge()
    let committed = false
    try {
      if (request?.ownerId) {
        const state = await bridge?.account.state.get()
        if (state?.status !== "authenticated" || state.profile.user.id !== request.ownerId) return false
        if (accountOwner.current !== undefined && accountOwner.current !== request.ownerId) return false
        accountOwner.current = request.ownerId
      }
      if (token !== sequence.current) return false
      await navigateRef.current(destination, () => {
        if (token !== sequence.current) return false
        committed = true
        if (destination.appId !== "connectors") {
          current.current = { id: request?.id, destination }
          setPending(destination)
        }
        return true
      })
      return committed
    } catch (error) {
      logger.warn("Main window navigation failed.", { error, appId: destination.appId })
      return false
    } finally {
      if (request && (current.current?.id !== request.id || destination.appId === "connectors")) {
        acknowledge(request.id)
      }
    }
  }, [acknowledge, complete])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("window")) return
    const bridge = getSynapseBridge()
    if (!bridge?.apps?.onMainNavigationRequested) return
    let disposed = false
    let latest = 0
    const receive = (request: MainNavigationRequest) => {
      if (disposed || request.id <= latest) return
      latest = request.id
      void open(request.destination, request)
    }
    const unsubscribe = bridge.apps.onMainNavigationRequested(receive)
    void bridge.apps.getPendingMainNavigation().then((request) => {
      if (request) receive(request)
    }).catch((error) => {
      if (!disposed) logger.warn("Could not read pending main window navigation.", { error })
    })
    return () => {
      disposed = true
      sequence.current += 1
      unsubscribe()
    }
  }, [open])

  useEffect(() => getSynapseBridge()?.account?.state?.onChanged?.((event) => {
    const owner = event.state.status === "authenticated" ? event.state.profile.user.id : null
    if (accountOwner.current === undefined) {
      accountOwner.current = owner
      return
    }
    if (accountOwner.current !== owner) {
      sequence.current += 1
      if (current.current) complete(current.current.destination)
      accountOwner.current = owner
    }
  }), [complete])

  return { pending, open, complete, discard }
}
