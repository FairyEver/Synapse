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
import { LoaderCircle } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { sanitizeConfigPatchForLog } from "@/lib/config-log-redaction"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
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
  const [isRetrying, setIsRetrying] = useState(false)
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
      logger.info("Updating app config from renderer.", { patch: sanitizeConfigPatchForLog(patch), reset })
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

  const loadInitialConfig = useCallback(async () => {
    setError(null)
    setIsReady(false)
    setIsRetrying(true)
    try {
      await refreshConfig()
    } catch (loadError) {
      logger.error("Failed to refresh app config.", loadError)
      setError(loadError instanceof Error ? loadError.message : "加载本地配置失败")
      setIsReady(false)
    } finally {
      setIsRetrying(false)
    }
  }, [refreshConfig])

  useEffect(() => {
    if (hasLoadedRef.current) {
      return
    }

    hasLoadedRef.current = true

    void loadInitialConfig()
  }, [loadInitialConfig])

  useEffect(() => {
    const unsubscribe = getSynapseBridge()?.settings.repository?.onUpdated?.((event) => {
      if (event.operation !== "variables") {
        return
      }
      void refreshConfig().catch((refreshError) => {
        logger.error("Failed to refresh app config after variable update.", refreshError)
      })
    })

    return () => {
      unsubscribe?.()
    }
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
      error,
      isReady,
      refreshConfig,
      updateConfig,
      resetKey,
    }),
    [config, error, isReady, refreshConfig, updateConfig, resetKey],
  )

  if (!isReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
        <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-6">
          {error ? (
            <>
              <div className="flex flex-col gap-2">
                <h1 className="text-lg font-medium text-foreground">无法读取配置</h1>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" disabled={isRetrying} onClick={() => void loadInitialConfig()}>
                  {isRetrying ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  重试
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取配置
            </div>
          )}
        </div>
      </main>
    )
  }

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
