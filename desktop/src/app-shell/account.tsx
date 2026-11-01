import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAccountProfile, SynapseAccountState } from "@/types/account"

type AccountPendingAction = "refresh" | "logout" | "login" | "cancelLogin"

type AccountContextValue = {
  state: SynapseAccountState
  isLoading: boolean
  pendingAction: AccountPendingAction | null
  startLogin: () => Promise<SynapseAccountState>
  cancelLogin: () => Promise<SynapseAccountState>
  refresh: () => Promise<SynapseAccountState>
  logout: () => Promise<SynapseAccountState>
}
type AccountActionRunner = () => Promise<SynapseAccountState>

const logger = createRendererLogger("account")
const AccountContext = createContext<AccountContextValue | null>(null)

function profileFromState(state: SynapseAccountState): SynapseAccountProfile | undefined {
  return "profile" in state ? state.profile : undefined
}

function createActionErrorState(currentState: SynapseAccountState): SynapseAccountState {
  return {
    status: "error",
    message: "账号操作失败。",
    profile: profileFromState(currentState),
  }
}

function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SynapseAccountState>({ status: "unauthenticated" })
  const [isLoading, setIsLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<AccountPendingAction | null>(null)
  const stateRef = useRef(state)
  const profileSyncInFlightRef = useRef(false)
  stateRef.current = state

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge?.account) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    void bridge.account.state.get()
      .then((nextState) => {
        if (!cancelled) setState(nextState)
      })
      .catch((error) => {
        logger.error("Failed to read account state.", error)
        if (!cancelled) setState(createActionErrorState(stateRef.current))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    const unsubscribe = bridge.account.state.onChanged((event) => {
      setState(event.state)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge?.account) return

    let cancelled = false
    const syncVisibleAccount = () => {
      const current = stateRef.current
      if (
        document.visibilityState !== "visible"
        || current.status !== "authenticated"
        || current.connectivity !== "online"
        || pendingAction !== null
        || profileSyncInFlightRef.current
      ) return

      profileSyncInFlightRef.current = true
      void bridge.account.refresh()
        .then((nextState) => {
          if (
            !cancelled
            && nextState.status === "authenticated"
            && stateRef.current.status === "authenticated"
            && nextState.profile.user.id === stateRef.current.profile.user.id
          ) {
            setState(nextState)
          }
        })
        .catch((error) => {
          logger.warn("Failed to refresh account profile after window focus.", { error })
        })
        .finally(() => {
          profileSyncInFlightRef.current = false
        })
    }

    window.addEventListener("focus", syncVisibleAccount)
    document.addEventListener("visibilitychange", syncVisibleAccount)
    return () => {
      cancelled = true
      window.removeEventListener("focus", syncVisibleAccount)
      document.removeEventListener("visibilitychange", syncVisibleAccount)
    }
  }, [pendingAction])

  const runAccountAction = useCallback(async (
    action: AccountPendingAction,
    runner: AccountActionRunner,
  ): Promise<SynapseAccountState> => {
    setPendingAction(action)
    try {
      const nextState = await runner()
      setState(nextState)
      return nextState
    } catch (error) {
      logger.error("Account action failed.", error)
      const nextState = createActionErrorState(stateRef.current)
      setState(nextState)
      return nextState
    } finally {
      setPendingAction(null)
    }
  }, [])

  const startLogin = useCallback(async () => {
    const bridge = getSynapseBridge()
    if (!bridge?.account) {
      const nextState = createActionErrorState(stateRef.current)
      setState(nextState)
      return nextState
    }
    return runAccountAction("login", bridge.account.login.start)
  }, [runAccountAction])

  const refresh = useCallback(async () => {
    const bridge = getSynapseBridge()
    if (!bridge?.account) {
      const nextState = createActionErrorState(stateRef.current)
      setState(nextState)
      return nextState
    }
    return runAccountAction("refresh", bridge.account.refresh)
  }, [runAccountAction])

  const cancelLogin = useCallback(async () => {
    const bridge = getSynapseBridge()
    if (!bridge?.account) {
      const nextState = createActionErrorState(stateRef.current)
      setState(nextState)
      return nextState
    }
    return runAccountAction("cancelLogin", bridge.account.cancelLogin)
  }, [runAccountAction])

  const logout = useCallback(async () => {
    const bridge = getSynapseBridge()
    if (!bridge?.account) {
      const nextState = createActionErrorState(stateRef.current)
      setState(nextState)
      return nextState
    }
    return runAccountAction("logout", bridge.account.logout)
  }, [runAccountAction])

  const value = useMemo<AccountContextValue>(
    () => ({
      cancelLogin,
      isLoading,
      logout,
      pendingAction,
      refresh,
      startLogin,
      state,
    }),
    [cancelLogin, isLoading, logout, pendingAction, refresh, startLogin, state],
  )

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  )
}

function useAccount(): AccountContextValue {
  const context = useContext(AccountContext)
  if (!context) {
    throw new Error("useAccount must be used within AccountProvider.")
  }
  return context
}

export { AccountProvider, useAccount }
