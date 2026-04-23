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
  adoptExistingIdentityUserId,
  generateNewIdentity,
  readLocalIdentityState,
} from "@/app-shell/identity"
import { createRendererLogger } from "@/app-shell/logging"
import {
  useActiveRepository,
  useRepositoryState,
  useRepositoryOperation,
} from "@/app-shell/use-repository-manager"
import {
  listRepoProfiles,
  updateRepoDisplayName,
} from "@/app-shell/user-profile"
import type {
  SynapseLocalIdentityState,
  SynapseRepoProfileState,
  SynapseUserProfile,
} from "@/types/identity"

type IdentityContextValue = {
  currentRepoProfileState: SynapseRepoProfileState | null
  error: string | null
  isReady: boolean
  localIdentityState: SynapseLocalIdentityState | null
  repoProfileMap: ReadonlyMap<string, SynapseUserProfile>
  adoptExistingUserId: (userId: string, repoId: string) => Promise<SynapseLocalIdentityState>
  generateNewId: () => Promise<SynapseLocalIdentityState>
  refreshIdentity: () => Promise<SynapseLocalIdentityState>
  refreshRepoProfileState: () => Promise<void>
  updateCurrentRepoDisplayName: (displayName: string) => Promise<SynapseUserProfile>
}

const IdentityContext = createContext<IdentityContextValue | null>(null)
const logger = createRendererLogger("app.identity")
const EMPTY_PROFILE_MAP = new Map<string, SynapseUserProfile>()

function IdentityProvider({ children }: { children: ReactNode }) {
  const activeRepository = useActiveRepository()
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const activeRepositoryOperation = useRepositoryOperation(activeRepository?.uuid ?? "")
  const [localIdentityState, setLocalIdentityState] = useState<SynapseLocalIdentityState | null>(null)
  const [currentRepoProfileState, setCurrentRepoProfileState] = useState<SynapseRepoProfileState | null>(null)
  const [repoProfileMap, setRepoProfileMap] =
    useState<ReadonlyMap<string, SynapseUserProfile>>(EMPTY_PROFILE_MAP)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  const refreshIdentity = useCallback(async () => {
    const nextState = await readLocalIdentityState()

    setLocalIdentityState(nextState)
    setError(null)
    setIsReady(true)

    return nextState
  }, [])

  const refreshRepoProfileState = useCallback(async () => {
    if (
      !activeRepository
      || activeRepositoryState?.status !== "ready"
      || localIdentityState?.status !== "ready"
    ) {
      setCurrentRepoProfileState(null)
      setRepoProfileMap(EMPTY_PROFILE_MAP)
      return
    }

    const nextRepoProfileMap = await listRepoProfiles(activeRepository.uuid)
    const nextProfile = nextRepoProfileMap.get(localIdentityState.identity.userId)
    const nextRepoProfileState: SynapseRepoProfileState =
      nextProfile && nextProfile.displayName.trim().length > 0
        ? {
            status: "ready",
            profile: nextProfile,
          }
        : {
            status: "needs-onboarding",
            repoId: activeRepository.uuid,
            userId: localIdentityState.identity.userId,
          }

    setCurrentRepoProfileState(nextRepoProfileState)
    setRepoProfileMap(nextRepoProfileMap)
    setError(null)
  }, [
    activeRepository,
    activeRepositoryState?.status,
    localIdentityState,
  ])

  const applyIdentityUpdate = useCallback(
    async (
      action: () => Promise<SynapseLocalIdentityState>,
      errorMessage: string,
    ) => {
      try {
        const nextState = await action()

        setLocalIdentityState(nextState)
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

  useEffect(() => {
    if (!isReady) {
      return
    }

    void refreshRepoProfileState().catch((loadError: unknown) => {
      logger.error("Failed to refresh repository profile state.", loadError)
      setError(loadError instanceof Error ? loadError.message : "加载仓库身份失败。")
    })
  }, [
    activeRepository?.uuid,
    activeRepositoryOperation?.completedAt,
    activeRepositoryState?.status,
    isReady,
    localIdentityState?.status,
    refreshRepoProfileState,
  ])

  const updateCurrentRepoDisplayName = useCallback(
    async (displayName: string) => {
      if (!activeRepository) {
        throw new Error("当前还没有激活的本地目录。")
      }

      const nextProfile = await updateRepoDisplayName(activeRepository.uuid, displayName)

      await refreshRepoProfileState()
      return nextProfile
    },
    [activeRepository, refreshRepoProfileState],
  )

  const value = useMemo<IdentityContextValue>(
    () => ({
      currentRepoProfileState,
      error,
      isReady,
      localIdentityState,
      repoProfileMap,
      adoptExistingUserId: (userId, repoId) =>
        applyIdentityUpdate(
          () => adoptExistingIdentityUserId(userId, repoId),
          "接续身份失败。",
        ).then(async (nextState) => {
          await refreshRepoProfileState()
          return nextState
        }),
      generateNewId: () =>
        applyIdentityUpdate(() => generateNewIdentity(), "生成新身份失败。"),
      refreshIdentity,
      refreshRepoProfileState,
      updateCurrentRepoDisplayName,
    }),
    [
      applyIdentityUpdate,
      currentRepoProfileState,
      error,
      isReady,
      localIdentityState,
      refreshIdentity,
      refreshRepoProfileState,
      repoProfileMap,
      updateCurrentRepoDisplayName,
    ],
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

function useLocalIdentity() {
  const {
    adoptExistingUserId,
    error,
    generateNewId,
    isReady,
    localIdentityState,
    refreshIdentity,
  } = useIdentity()

  return {
    adoptExistingUserId,
    error,
    generateNewId,
    isReady,
    localIdentityState,
    refreshIdentity,
  }
}

function useCurrentRepoProfile() {
  const {
    currentRepoProfileState,
    refreshRepoProfileState,
    updateCurrentRepoDisplayName,
  } = useIdentity()

  return {
    currentRepoProfileState,
    refreshRepoProfileState,
    updateCurrentRepoDisplayName,
  }
}

function useRepoProfileMap(): ReadonlyMap<string, SynapseUserProfile> {
  return useIdentity().repoProfileMap
}

export {
  IdentityProvider,
  useCurrentRepoProfile,
  useIdentity,
  useLocalIdentity,
  useRepoProfileMap,
}
