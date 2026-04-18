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
import {
  generateNewIdentity,
  readIdentityState,
  replaceIdentityUserId,
  updateIdentityDisplayName,
} from "@/app-shell/identity"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseIdentityState } from "@/types/identity"

type IdentityContextValue = {
  error: string | null
  identityState: SynapseIdentityState | null
  isReady: boolean
  generateNewId: () => Promise<SynapseIdentityState>
  refreshIdentity: () => Promise<SynapseIdentityState>
  replaceUserId: (userId: string) => Promise<SynapseIdentityState>
  updateDisplayName: (displayName: string) => Promise<SynapseIdentityState>
}

const IdentityContext = createContext<IdentityContextValue | null>(null)
const logger = createRendererLogger("app.identity")

function IdentityProvider({ children }: { children: ReactNode }) {
  const [identityState, setIdentityState] = useState<SynapseIdentityState | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  const refreshIdentity = useCallback(async () => {
    const nextState = await readIdentityState()

    setIdentityState(nextState)
    setError(null)
    setIsReady(true)

    return nextState
  }, [])

  const applyIdentityUpdate = useCallback(
    async (
      action: () => Promise<SynapseIdentityState>,
      errorMessage: string,
    ) => {
      try {
        const nextState = await action()

        setIdentityState(nextState)
        setError(null)
        setIsReady(true)

        return nextState
      } catch (updateError) {
        logger.error(errorMessage, updateError)
        setError(updateError instanceof Error ? updateError.message : errorMessage)
        throw updateError
      }
    },
    [],
  )

  useEffect(() => {
    if (hasLoadedRef.current) {
      return
    }

    hasLoadedRef.current = true

    void refreshIdentity().catch((loadError: unknown) => {
      logger.error("Failed to load identity state.", loadError)
      setError(loadError instanceof Error ? loadError.message : "加载身份失败。")
      setIsReady(true)
    })
  }, [refreshIdentity])

  const value = useMemo<IdentityContextValue>(
    () => ({
      error,
      identityState,
      isReady,
      generateNewId: () =>
        applyIdentityUpdate(() => generateNewIdentity(), "生成新身份失败。"),
      refreshIdentity,
      replaceUserId: (userId) =>
        applyIdentityUpdate(() => replaceIdentityUserId(userId), "恢复身份失败。"),
      updateDisplayName: (displayName) =>
        applyIdentityUpdate(() => updateIdentityDisplayName(displayName), "保存显示名称失败。"),
    }),
    [applyIdentityUpdate, error, identityState, isReady, refreshIdentity],
  )

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

function useIdentity(): IdentityContextValue {
  const context = useContext(IdentityContext)

  if (!context) {
    throw new Error("useIdentity must be used within IdentityProvider.")
  }

  return context
}

export { IdentityProvider, useIdentity }
