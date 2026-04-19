import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"

type ActiveRepositorySwitchContextValue = {
  isSwitchingRepository: boolean
  switchingRepositoryUuid: string | null
  switchActiveRepository: (repositoryUuid: string) => Promise<boolean>
}

const ActiveRepositorySwitchContext = createContext<ActiveRepositorySwitchContextValue | null>(null)
const logger = createRendererLogger("app.active-repository-switch")

function ActiveRepositorySwitchProvider({ children }: { children: ReactNode }) {
  const { config, updateConfig } = useAppConfig()
  const { promise } = useAppNotifications()
  const [switchingRepositoryUuid, setSwitchingRepositoryUuid] = useState<string | null>(null)

  const switchActiveRepository = useCallback(
    async (repositoryUuid: string) => {
      if (config.activeRepoUuid === repositoryUuid) {
        return true
      }

      if (!config.repositories.some((repository) => repository.uuid === repositoryUuid)) {
        logger.warn("Attempted to switch to an unknown repository.", {
          repositoryUuid,
        })
        return false
      }

      setSwitchingRepositoryUuid(repositoryUuid)

      try {
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
    [config.activeRepoUuid, config.repositories, promise, updateConfig],
  )

  const value = useMemo<ActiveRepositorySwitchContextValue>(
    () => ({
      isSwitchingRepository: switchingRepositoryUuid !== null,
      switchingRepositoryUuid,
      switchActiveRepository,
    }),
    [switchActiveRepository, switchingRepositoryUuid],
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
