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
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseRepositoryConfig,
  SynapseThemeMode,
} from "@/types/config"
import { createDefaultConfig, getActiveRepositoryConfig } from "@/lib/config"

type AppConfigContextValue = {
  config: SynapseConfig
  activeRepository: SynapseRepositoryConfig | null
  error: string | null
  isReady: boolean
  refreshConfig: () => Promise<SynapseConfig>
  updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
}

const AppConfigContext = createContext<AppConfigContextValue | null>(null)
const logger = createRendererLogger("app.config")
const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)"

async function readConfigFromBridge(): Promise<SynapseConfig> {
  return requireSynapseBridge().config.get()
}

async function updateConfigThroughBridge(patch: SynapseConfigPatch): Promise<SynapseConfig> {
  return requireSynapseBridge().config.update(patch)
}

function resolveDarkMode(themeMode: SynapseThemeMode, mediaQueryList: MediaQueryList | null): boolean {
  if (themeMode === "dark") {
    return true
  }

  if (themeMode === "light") {
    return false
  }

  return mediaQueryList?.matches ?? false
}

function applyThemeMode(themeMode: SynapseThemeMode, mediaQueryList: MediaQueryList | null): void {
  const shouldUseDarkMode = resolveDarkMode(themeMode, mediaQueryList)

  document.documentElement.classList.toggle("dark", shouldUseDarkMode)
  document.documentElement.style.colorScheme = shouldUseDarkMode ? "dark" : "light"
}

function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SynapseConfig>(() => createDefaultConfig())
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  const refreshConfig = useCallback(async () => {
    logger.info("Refreshing app config.")
    const nextConfig = await readConfigFromBridge()

    setConfig(nextConfig)
    setError(null)
    setIsReady(true)

    logger.info("App config loaded.", {
      activeRepoUuid: nextConfig.activeRepoUuid,
      repositoryCount: nextConfig.repositories.length,
    })

    return nextConfig
  }, [])

  const updateConfig = useCallback(
    async (patch: SynapseConfigPatch) => {
      logger.info("Updating app config from renderer.", patch)
      const nextConfig = await updateConfigThroughBridge(patch)

      setConfig(nextConfig)
      setError(null)
      setIsReady(true)

      logger.info("App config update applied in renderer.", {
        activeRepoUuid: nextConfig.activeRepoUuid,
        repositoryCount: nextConfig.repositories.length,
      })

      return nextConfig
    },
    [],
  )

  useEffect(() => {
    if (hasLoadedRef.current) {
      return
    }

    hasLoadedRef.current = true

    void refreshConfig().catch((loadError: unknown) => {
      logger.error("Failed to refresh app config.", loadError)
      setError(loadError instanceof Error ? loadError.message : "加载本地配置失败")
      setIsReady(true)
    })
  }, [refreshConfig])

  useEffect(() => {
    const mediaQueryList =
      typeof window.matchMedia === "function"
        ? window.matchMedia(DARK_MODE_MEDIA_QUERY)
        : null
    const syncThemeMode = () => {
      applyThemeMode(config.global.themeMode, mediaQueryList)
    }

    syncThemeMode()

    if (config.global.themeMode !== "system" || mediaQueryList === null) {
      return
    }

    mediaQueryList.addEventListener("change", syncThemeMode)

    return () => {
      mediaQueryList.removeEventListener("change", syncThemeMode)
    }
  }, [config.global.themeMode])

  const value = useMemo<AppConfigContextValue>(
    () => ({
      config,
      activeRepository: getActiveRepositoryConfig(config),
      error,
      isReady,
      refreshConfig,
      updateConfig,
    }),
    [config, error, isReady, refreshConfig, updateConfig],
  )

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}

function useAppConfig(): AppConfigContextValue {
  const context = useContext(AppConfigContext)

  if (!context) {
    throw new Error("useAppConfig must be used within AppConfigProvider.")
  }

  return context
}

export { AppConfigProvider, useAppConfig }
