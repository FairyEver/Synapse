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
  stateRef.current = state

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge?.account) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    void bridge.account.getState()
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

    const unsubscribe = bridge.account.onStateChanged((event) => {
      setState(event.state)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

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
    return runAccountAction("login", bridge.account.startLogin)
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
