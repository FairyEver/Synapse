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
import { setLocale } from "@/runtime/i18n"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseThemeMode,
} from "@/types/config"
import { createDefaultConfig } from "@/lib/config"

type AppConfigContextValue = {
  config: SynapseConfig
  error: string | null
  isReady: boolean
  refreshConfig: () => Promise<SynapseConfig>
  updateConfig: (patch: SynapseConfigPatch, reset?: boolean) => Promise<SynapseConfig>
  resetKey: number
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
  const [resetKey, setResetKey] = useState(0)
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
    async (patch: SynapseConfigPatch, reset = false) => {
      logger.info("Updating app config from renderer.", { patch, reset })
      const nextConfig = await updateConfigThroughBridge(patch)

      setConfig(nextConfig)
      setError(null)
      setIsReady(true)

      if (reset) {
        setResetKey((prev) => prev + 1)
      }

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

  useEffect(() => {
    void setLocale(config.global.locale).catch((localeError: unknown) => {
      logger.warn("Failed to apply locale.", {
        error: localeError instanceof Error ? localeError.message : String(localeError),
      })
    })
  }, [config.global.locale])

  const value = useMemo<AppConfigContextValue>(
    () => ({
      config,
      error,
      isReady,
      refreshConfig,
      updateConfig,
      resetKey,
    }),
    [config, error, isReady, refreshConfig, updateConfig, resetKey],
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
