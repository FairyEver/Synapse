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
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useRepositoryActions,
  useRepositoryList,
  useRepositoryManager,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
import { readRepoProfileState, updateRepoDisplayName } from "@/app-shell/user-profile"

type PendingSwitchOnboarding = {
  repositoryUuid: string
  repositoryName: string
  userId: string
}

type ActiveRepositorySwitchContextValue = {
  isSwitchingRepository: boolean
  switchingRepositoryUuid: string | null
  switchActiveRepository: (repositoryUuid: string) => Promise<boolean>

  isRepositorySwitchDialogOpen: boolean
  openRepositorySwitchDialog: () => void
  closeRepositorySwitchDialog: () => void

  pendingSwitchOnboarding: PendingSwitchOnboarding | null
  completePendingSwitchOnboarding: (displayName: string) => Promise<void>
  cancelPendingSwitchOnboarding: () => void
}

const ActiveRepositorySwitchContext = createContext<ActiveRepositorySwitchContextValue | null>(null)
const logger = createRendererLogger("app.active-repository-switch")

function ActiveRepositorySwitchProvider({ children }: { children: ReactNode }) {
  const { promise } = useAppNotifications()
  const manager = useRepositoryManager()
  const repositories = useRepositoryList()
  const activeRepository = useActiveRepository()
  const { clearActiveRepository, switchActiveRepository: switchRepository } = useRepositoryActions()
  const [switchingRepositoryUuid, setSwitchingRepositoryUuid] = useState<string | null>(null)
  const [isRepositorySwitchDialogOpen, setIsRepositorySwitchDialogOpen] = useState(false)
  const [pendingSwitchOnboarding, setPendingSwitchOnboarding] =
    useState<PendingSwitchOnboarding | null>(null)
  const [isValidatingOnStartup, setIsValidatingOnStartup] = useState(false)
  const pendingResolverRef = useRef<((didSwitch: boolean) => void) | null>(null)

  const activeRepoState = useRepositoryState(activeRepository?.uuid ?? "")

  useEffect(() => {
    if (!activeRepository || isValidatingOnStartup || activeRepoState?.status !== "ready") {
      return
    }

    setIsValidatingOnStartup(true)

    void (async () => {
      try {
        const result = await manager.validateDirectory(activeRepository.localPath)
        if (!result.isValid) {
          logger.warn("Active repository failed validation on startup.", {
            repositoryUuid: activeRepository.uuid,
            missingDirs: result.missingDirectories,
          })
          await clearActiveRepository()
        }
      } catch (error) {
        logger.error("Failed to validate repository on startup.", {
          error,
          repositoryUuid: activeRepository.uuid,
        })
      } finally {
        setIsValidatingOnStartup(false)
      }
    })()
  }, [activeRepoState?.status, activeRepository, clearActiveRepository, manager, isValidatingOnStartup])

  const runActiveRepositorySwitch = useCallback(
    async (repositoryUuid: string) => {
      await promise(
        () => switchRepository(repositoryUuid),
        {
          loading: "正在切换仓库...",
          success: () => "切换完成。",
          error: (error) => error instanceof Error ? error.message : "切换仓库失败。",
        },
      )
    },
    [promise, switchRepository],
  )

  const openRepositorySwitchDialog = useCallback(() => {
    setIsRepositorySwitchDialogOpen(true)
  }, [])

  const closeRepositorySwitchDialog = useCallback(() => {
    setIsRepositorySwitchDialogOpen(false)
  }, [])

  const resolvePendingSwitch = useCallback((didSwitch: boolean) => {
    const resolver = pendingResolverRef.current

    pendingResolverRef.current = null
    setPendingSwitchOnboarding(null)

    if (resolver) {
      resolver(didSwitch)
    }
  }, [])

  const cancelPendingSwitchOnboarding = useCallback(() => {
    resolvePendingSwitch(false)
  }, [resolvePendingSwitch])

  const completePendingSwitchOnboarding = useCallback(
    async (displayName: string) => {
      const target = pendingSwitchOnboarding

      if (!target) {
        return
      }

      const nextDisplayName = displayName.trim()

      if (!nextDisplayName) {
        throw new Error("显示名称不能为空。")
      }

      await updateRepoDisplayName(target.repositoryUuid, nextDisplayName)
      await runActiveRepositorySwitch(target.repositoryUuid)
      resolvePendingSwitch(true)
    },
    [pendingSwitchOnboarding, resolvePendingSwitch, runActiveRepositorySwitch],
  )

  const switchActiveRepository = useCallback(
    async (repositoryUuid: string) => {
      if (activeRepository?.uuid === repositoryUuid) {
        return true
      }

      const targetRepository = repositories.find(
        (repository) => repository.uuid === repositoryUuid,
      )

      if (!targetRepository) {
        logger.warn("Attempted to switch to an unknown repository.", {
          repositoryUuid,
        })
        return false
      }

      setSwitchingRepositoryUuid(repositoryUuid)

      try {
        // 先验证仓库目录结构是否合法
        const validationResult = await manager.validateDirectory(targetRepository.localPath)
        if (!validationResult.isValid) {
          throw new Error(validationResult.message)
        }

        let repoProfileState: Awaited<ReturnType<typeof readRepoProfileState>>

        try {
          repoProfileState = await readRepoProfileState(repositoryUuid)
        } catch (error) {
          logger.error("Failed to read repo profile state before switching.", {
            error,
            repositoryUuid,
          })
          throw error
        }

        if (repoProfileState.status === "needs-onboarding") {
          setPendingSwitchOnboarding({
            repositoryUuid,
            repositoryName: targetRepository.name,
            userId: repoProfileState.userId,
          })

          return await new Promise<boolean>((resolve) => {
            pendingResolverRef.current = resolve
          })
        }

        await runActiveRepositorySwitch(repositoryUuid)
        return true
      } catch (error) {
        logger.error("Failed to switch active repository.", {
          error,
          repositoryUuid,
        })
        throw error
      } finally {
        setSwitchingRepositoryUuid(null)
      }
    },
    [activeRepository?.uuid, repositories, runActiveRepositorySwitch, manager],
  )

  const value = useMemo<ActiveRepositorySwitchContextValue>(
    () => ({
      isSwitchingRepository: switchingRepositoryUuid !== null,
      switchingRepositoryUuid,
      switchActiveRepository,
      isRepositorySwitchDialogOpen,
      openRepositorySwitchDialog,
      closeRepositorySwitchDialog,
      pendingSwitchOnboarding,
      completePendingSwitchOnboarding,
      cancelPendingSwitchOnboarding,
    }),
    [
      cancelPendingSwitchOnboarding,
      closeRepositorySwitchDialog,
      completePendingSwitchOnboarding,
      isRepositorySwitchDialogOpen,
      openRepositorySwitchDialog,
      pendingSwitchOnboarding,
      switchActiveRepository,
      switchingRepositoryUuid,
    ],
  )

  return (
    <ActiveRepositorySwitchContext.Provider value={value}>
      {children}
    </ActiveRepositorySwitchContext.Provider>
  )
}

function useActiveRepositorySwitch(): ActiveRepositorySwitchContextValue {
  const context = useContext(ActiveRepositorySwitchContext)

  if (!context) {
    throw new Error("useActiveRepositorySwitch must be used within ActiveRepositorySwitchProvider.")
  }

  return context
}

export { ActiveRepositorySwitchProvider, useActiveRepositorySwitch }
