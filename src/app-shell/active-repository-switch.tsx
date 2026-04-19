import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
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
  const { config, updateConfig } = useAppConfig()
  const { promise } = useAppNotifications()
  const [switchingRepositoryUuid, setSwitchingRepositoryUuid] = useState<string | null>(null)
  const [isRepositorySwitchDialogOpen, setIsRepositorySwitchDialogOpen] = useState(false)
  const [pendingSwitchOnboarding, setPendingSwitchOnboarding] =
    useState<PendingSwitchOnboarding | null>(null)
  const pendingResolverRef = useRef<((didSwitch: boolean) => void) | null>(null)

  const runActiveRepoUpdateWithReload = useCallback(
    async (repositoryUuid: string) => {
      await promise(
        () => updateConfig({ activeRepoUuid: repositoryUuid }),
        {
          loading: "正在切换并刷新...",
          success: () => {
            window.location.reload()
            return null
          },
          error: (error) => error instanceof Error ? error.message : "切换仓库失败。",
        },
      )
    },
    [promise, updateConfig],
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
      await runActiveRepoUpdateWithReload(target.repositoryUuid)

      // reload 会接管后续流程，这里为健壮性 resolve(true)
      resolvePendingSwitch(true)
    },
    [pendingSwitchOnboarding, resolvePendingSwitch, runActiveRepoUpdateWithReload],
  )

  const switchActiveRepository = useCallback(
    async (repositoryUuid: string) => {
      if (config.activeRepoUuid === repositoryUuid) {
        return true
      }

      const targetRepository = config.repositories.find(
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

        await runActiveRepoUpdateWithReload(repositoryUuid)
        return true
      } catch (error) {
        logger.error("Failed to switch active repository.", {
          error,
          repositoryUuid,
        })
        return false
      } finally {
        setSwitchingRepositoryUuid(null)
      }
    },
    [config.activeRepoUuid, config.repositories, runActiveRepoUpdateWithReload],
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
